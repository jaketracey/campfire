#!/bin/bash
# =============================================================================
# Campfire Deployment Helper - Deploy Service to ECS
# =============================================================================
# Deploys a single service to ECS with force-new-deployment
#
# Usage: ./deploy-service.sh <service> <environment> [image_tag]
#
# Arguments:
#   service     - gateway, orchestrator, web, marketing, or workers
#   environment - dev, staging, or prod
#   image_tag   - Optional: specific image tag to deploy (default: latest)
#
# Examples:
#   ./deploy-service.sh gateway dev
#   ./deploy-service.sh web staging abc1234
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Color Output
# -----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1" >&2
}

# -----------------------------------------------------------------------------
# Usage
# -----------------------------------------------------------------------------
usage() {
    echo "Usage: $0 <service> <environment> [image_tag]"
    echo ""
    echo "Arguments:"
    echo "  service     - gateway, orchestrator, web, marketing, or workers"
    echo "  environment - dev, staging, or prod"
    echo "  image_tag   - Optional: specific image tag (default: latest)"
    echo ""
    echo "Examples:"
    echo "  $0 gateway dev"
    echo "  $0 web staging"
    echo "  $0 orchestrator prod abc1234"
    exit 1
}

# -----------------------------------------------------------------------------
# Validate Arguments
# -----------------------------------------------------------------------------
if [[ $# -lt 2 ]]; then
    log_error "Missing required arguments"
    usage
fi

SERVICE="$1"
ENVIRONMENT="$2"
IMAGE_TAG="${3:-latest}"

VALID_SERVICES=("gateway" "orchestrator" "web" "marketing" "workers")
VALID_ENVIRONMENTS=("dev" "staging" "prod")

if [[ ! " ${VALID_SERVICES[*]} " =~ " ${SERVICE} " ]]; then
    log_error "Invalid service: ${SERVICE}"
    log_error "Valid services: ${VALID_SERVICES[*]}"
    exit 1
fi

if [[ ! " ${VALID_ENVIRONMENTS[*]} " =~ " ${ENVIRONMENT} " ]]; then
    log_error "Invalid environment: ${ENVIRONMENT}"
    log_error "Valid environments: ${VALID_ENVIRONMENTS[*]}"
    exit 1
fi

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
PROJECT_NAME="campfire"
RESOURCE_PREFIX="${PROJECT_NAME}-${ENVIRONMENT}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECS_CLUSTER="${RESOURCE_PREFIX}-cluster"
ECS_SERVICE="${RESOURCE_PREFIX}-${SERVICE}"
TASK_FAMILY="${RESOURCE_PREFIX}-${SERVICE}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_REPO="${RESOURCE_PREFIX}/${SERVICE}"
FULL_IMAGE="${ECR_REGISTRY}/${ECR_REPO}:${IMAGE_TAG}"

log_info "Deployment Configuration:"
echo "  Environment:  ${ENVIRONMENT}"
echo "  Service:      ${SERVICE}"
echo "  Cluster:      ${ECS_CLUSTER}"
echo "  ECS Service:  ${ECS_SERVICE}"
echo "  Image Tag:    ${IMAGE_TAG}"
echo "  Full Image:   ${FULL_IMAGE}"
echo ""

# -----------------------------------------------------------------------------
# Verify Image Exists
# -----------------------------------------------------------------------------
log_info "Verifying image exists in ECR..."

if ! aws ecr describe-images \
    --repository-name "${ECR_REPO}" \
    --image-ids imageTag="${IMAGE_TAG}" \
    --region "${AWS_REGION}" > /dev/null 2>&1; then
    log_error "Image not found: ${FULL_IMAGE}"
    log_error "Please run build-and-push.sh first"
    exit 1
fi

log_success "Image verified: ${FULL_IMAGE}"

# -----------------------------------------------------------------------------
# Get Current Deployment Status
# -----------------------------------------------------------------------------
log_info "Getting current service status..."

CURRENT_STATUS=$(aws ecs describe-services \
    --cluster "${ECS_CLUSTER}" \
    --services "${ECS_SERVICE}" \
    --query 'services[0].{status: status, runningCount: runningCount, desiredCount: desiredCount, taskDefinition: taskDefinition}' \
    --output json 2>/dev/null || echo "{}")

if [[ "${CURRENT_STATUS}" == "{}" ]] || [[ $(echo "${CURRENT_STATUS}" | jq -r '.status') == "null" ]]; then
    log_error "Service not found: ${ECS_SERVICE}"
    log_error "Please ensure the service exists in cluster: ${ECS_CLUSTER}"
    exit 1
fi

CURRENT_TASK_DEF=$(echo "${CURRENT_STATUS}" | jq -r '.taskDefinition')
CURRENT_RUNNING=$(echo "${CURRENT_STATUS}" | jq -r '.runningCount')
DESIRED_COUNT=$(echo "${CURRENT_STATUS}" | jq -r '.desiredCount')

echo "  Current Status:"
echo "    Running Tasks:   ${CURRENT_RUNNING}/${DESIRED_COUNT}"
echo "    Task Definition: ${CURRENT_TASK_DEF}"
echo ""

# -----------------------------------------------------------------------------
# Update Task Definition with New Image
# -----------------------------------------------------------------------------
log_info "Creating new task definition with image: ${IMAGE_TAG}..."

# Get current task definition
TASK_DEF_JSON=$(aws ecs describe-task-definition \
    --task-definition "${TASK_FAMILY}" \
    --query 'taskDefinition' \
    --output json)

# Update the image in the container definition
NEW_TASK_DEF=$(echo "${TASK_DEF_JSON}" | jq \
    --arg IMAGE "${FULL_IMAGE}" \
    '.containerDefinitions[0].image = $IMAGE |
    del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)')

# Register new task definition
NEW_TASK_DEF_ARN=$(aws ecs register-task-definition \
    --cli-input-json "${NEW_TASK_DEF}" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

log_success "New task definition registered: ${NEW_TASK_DEF_ARN}"

# -----------------------------------------------------------------------------
# Deploy to ECS
# -----------------------------------------------------------------------------
log_info "Updating ECS service with new task definition..."

aws ecs update-service \
    --cluster "${ECS_CLUSTER}" \
    --service "${ECS_SERVICE}" \
    --task-definition "${NEW_TASK_DEF_ARN}" \
    --force-new-deployment \
    --query 'service.{serviceName: serviceName, taskDefinition: taskDefinition, desiredCount: desiredCount}' \
    --output table

log_success "Deployment initiated"

# -----------------------------------------------------------------------------
# Wait for Deployment to Stabilize
# -----------------------------------------------------------------------------
log_info "Waiting for deployment to stabilize..."
echo "  This may take several minutes..."

DEPLOY_START_TIME=$(date +%s)
MAX_WAIT_TIME=600  # 10 minutes
POLL_INTERVAL=15

while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - DEPLOY_START_TIME))

    if [[ ${ELAPSED} -gt ${MAX_WAIT_TIME} ]]; then
        log_error "Deployment timed out after ${MAX_WAIT_TIME} seconds"
        log_error "Check the service events and logs for issues"
        exit 1
    fi

    # Get deployment status
    DEPLOYMENTS=$(aws ecs describe-services \
        --cluster "${ECS_CLUSTER}" \
        --services "${ECS_SERVICE}" \
        --query 'services[0].deployments' \
        --output json)

    PRIMARY_DEPLOYMENT=$(echo "${DEPLOYMENTS}" | jq -r '.[] | select(.status == "PRIMARY")')
    RUNNING=$(echo "${PRIMARY_DEPLOYMENT}" | jq -r '.runningCount')
    DESIRED=$(echo "${PRIMARY_DEPLOYMENT}" | jq -r '.desiredCount')
    PENDING=$(echo "${PRIMARY_DEPLOYMENT}" | jq -r '.pendingCount')
    ROLLOUT_STATE=$(echo "${PRIMARY_DEPLOYMENT}" | jq -r '.rolloutState')

    echo -e "  [${ELAPSED}s] Running: ${RUNNING}/${DESIRED}, Pending: ${PENDING}, State: ${ROLLOUT_STATE}"

    if [[ "${ROLLOUT_STATE}" == "COMPLETED" ]]; then
        break
    elif [[ "${ROLLOUT_STATE}" == "FAILED" ]]; then
        log_error "Deployment failed!"

        # Get failure reason
        FAILURE_REASON=$(echo "${PRIMARY_DEPLOYMENT}" | jq -r '.rolloutStateReason // "Unknown"')
        log_error "Reason: ${FAILURE_REASON}"

        # Show recent events
        log_info "Recent service events:"
        aws ecs describe-services \
            --cluster "${ECS_CLUSTER}" \
            --services "${ECS_SERVICE}" \
            --query 'services[0].events[:5]' \
            --output table
        exit 1
    fi

    sleep ${POLL_INTERVAL}
done

DEPLOY_END_TIME=$(date +%s)
DEPLOY_DURATION=$((DEPLOY_END_TIME - DEPLOY_START_TIME))

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo -e "${CYAN}Deployment Summary${NC}"
echo "============================================================================="
echo "Service:        ${ECS_SERVICE}"
echo "Environment:    ${ENVIRONMENT}"
echo "Image:          ${FULL_IMAGE}"
echo "Task Definition: ${NEW_TASK_DEF_ARN}"
echo "Duration:       ${DEPLOY_DURATION} seconds"
echo ""
log_success "Deployment completed successfully!"
echo ""
echo "Useful commands:"
echo "  View logs:       ./tail-logs.sh ${SERVICE} ${ENVIRONMENT}"
echo "  Health check:    ./health-check.sh ${ENVIRONMENT}"
echo "  Rollback:        ./rollback-service.sh ${SERVICE} ${ENVIRONMENT} <previous-tag>"
echo "============================================================================="
