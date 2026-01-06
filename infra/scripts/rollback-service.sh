#!/bin/bash
# =============================================================================
# Campfire Deployment Helper - Rollback Service
# =============================================================================
# Rolls back an ECS service to a previous image version
#
# Usage: ./rollback-service.sh <service> <environment> <target_tag>
#
# Arguments:
#   service     - gateway, orchestrator, web, or workers
#   environment - dev, staging, or prod
#   target_tag  - Image tag to rollback to (e.g., abc1234 or previous revision number)
#
# Examples:
#   ./rollback-service.sh gateway dev abc1234
#   ./rollback-service.sh web staging 5  # Rollback to task definition revision 5
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
MAGENTA='\033[0;35m'
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
    echo "Usage: $0 <service> <environment> <target_tag|revision>"
    echo ""
    echo "Arguments:"
    echo "  service     - gateway, orchestrator, web, or workers"
    echo "  environment - dev, staging, or prod"
    echo "  target_tag  - Image tag to rollback to, or task definition revision number"
    echo ""
    echo "Examples:"
    echo "  $0 gateway dev abc1234           # Rollback to specific image tag"
    echo "  $0 web staging 5                 # Rollback to task definition revision 5"
    echo ""
    echo "List available image tags:"
    echo "  aws ecr list-images --repository-name campfire-dev/gateway --query 'imageIds[*].imageTag'"
    echo ""
    echo "List recent task definition revisions:"
    echo "  aws ecs list-task-definitions --family-prefix campfire-dev-gateway --sort DESC --max-items 5"
    exit 1
}

# -----------------------------------------------------------------------------
# Validate Arguments
# -----------------------------------------------------------------------------
if [[ $# -lt 3 ]]; then
    log_error "Missing required arguments"
    usage
fi

SERVICE="$1"
ENVIRONMENT="$2"
TARGET="$3"

VALID_SERVICES=("gateway" "orchestrator" "web" "workers")
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

echo ""
echo -e "${MAGENTA}=============================================================================${NC}"
echo -e "${MAGENTA}                    ROLLBACK - ${SERVICE} - ${ENVIRONMENT}${NC}"
echo -e "${MAGENTA}=============================================================================${NC}"
echo ""

# -----------------------------------------------------------------------------
# Get Current Deployment Info
# -----------------------------------------------------------------------------
log_info "Getting current deployment information..."

CURRENT_SERVICE=$(aws ecs describe-services \
    --cluster "${ECS_CLUSTER}" \
    --services "${ECS_SERVICE}" \
    --query 'services[0]' \
    --output json 2>/dev/null || echo "{}")

if [[ "${CURRENT_SERVICE}" == "{}" ]]; then
    log_error "Service not found: ${ECS_SERVICE}"
    exit 1
fi

CURRENT_TASK_DEF_ARN=$(echo "${CURRENT_SERVICE}" | jq -r '.taskDefinition')
CURRENT_RUNNING=$(echo "${CURRENT_SERVICE}" | jq -r '.runningCount')
CURRENT_DESIRED=$(echo "${CURRENT_SERVICE}" | jq -r '.desiredCount')

# Get current image
CURRENT_IMAGE=$(aws ecs describe-task-definition \
    --task-definition "${CURRENT_TASK_DEF_ARN}" \
    --query 'taskDefinition.containerDefinitions[0].image' \
    --output text)

echo "  Current State:"
echo "    Running Tasks:    ${CURRENT_RUNNING}/${CURRENT_DESIRED}"
echo "    Task Definition:  ${CURRENT_TASK_DEF_ARN}"
echo "    Current Image:    ${CURRENT_IMAGE}"
echo ""

# -----------------------------------------------------------------------------
# Determine Target Task Definition
# -----------------------------------------------------------------------------
log_info "Determining rollback target..."

# Check if target is a revision number (all digits)
if [[ "${TARGET}" =~ ^[0-9]+$ ]]; then
    # Target is a task definition revision number
    TARGET_TASK_DEF="${TASK_FAMILY}:${TARGET}"

    # Verify it exists
    if ! aws ecs describe-task-definition \
        --task-definition "${TARGET_TASK_DEF}" > /dev/null 2>&1; then
        log_error "Task definition revision not found: ${TARGET_TASK_DEF}"
        log_info "Available revisions:"
        aws ecs list-task-definitions \
            --family-prefix "${TASK_FAMILY}" \
            --sort DESC \
            --max-items 10 \
            --query 'taskDefinitionArns' \
            --output table
        exit 1
    fi

    TARGET_TASK_DEF_ARN=$(aws ecs describe-task-definition \
        --task-definition "${TARGET_TASK_DEF}" \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)

    TARGET_IMAGE=$(aws ecs describe-task-definition \
        --task-definition "${TARGET_TASK_DEF}" \
        --query 'taskDefinition.containerDefinitions[0].image' \
        --output text)
else
    # Target is an image tag - create new task definition with that image
    TARGET_IMAGE="${ECR_REGISTRY}/${ECR_REPO}:${TARGET}"

    # Verify image exists in ECR
    if ! aws ecr describe-images \
        --repository-name "${ECR_REPO}" \
        --image-ids imageTag="${TARGET}" \
        --region "${AWS_REGION}" > /dev/null 2>&1; then
        log_error "Image tag not found in ECR: ${TARGET}"
        log_info "Available image tags:"
        aws ecr list-images \
            --repository-name "${ECR_REPO}" \
            --query 'imageIds[*].imageTag' \
            --output table 2>/dev/null || echo "  Unable to list images"
        exit 1
    fi

    log_info "Creating new task definition with image: ${TARGET}"

    # Get current task definition and update image
    TASK_DEF_JSON=$(aws ecs describe-task-definition \
        --task-definition "${TASK_FAMILY}" \
        --query 'taskDefinition' \
        --output json)

    NEW_TASK_DEF=$(echo "${TASK_DEF_JSON}" | jq \
        --arg IMAGE "${TARGET_IMAGE}" \
        '.containerDefinitions[0].image = $IMAGE |
        del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)')

    TARGET_TASK_DEF_ARN=$(aws ecs register-task-definition \
        --cli-input-json "${NEW_TASK_DEF}" \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)

    log_success "Created task definition: ${TARGET_TASK_DEF_ARN}"
fi

echo ""
echo "  Rollback Target:"
echo "    Task Definition:  ${TARGET_TASK_DEF_ARN}"
echo "    Target Image:     ${TARGET_IMAGE}"
echo ""

# -----------------------------------------------------------------------------
# Confirmation
# -----------------------------------------------------------------------------
echo -e "${YELLOW}WARNING: You are about to rollback ${SERVICE} in ${ENVIRONMENT}${NC}"
echo ""
echo "  From: ${CURRENT_IMAGE}"
echo "  To:   ${TARGET_IMAGE}"
echo ""
read -p "Type 'rollback' to confirm: " CONFIRM

if [[ "${CONFIRM}" != "rollback" ]]; then
    log_warn "Rollback cancelled"
    exit 0
fi

# -----------------------------------------------------------------------------
# Execute Rollback
# -----------------------------------------------------------------------------
echo ""
log_info "Executing rollback..."

aws ecs update-service \
    --cluster "${ECS_CLUSTER}" \
    --service "${ECS_SERVICE}" \
    --task-definition "${TARGET_TASK_DEF_ARN}" \
    --force-new-deployment \
    --query 'service.{serviceName: serviceName, taskDefinition: taskDefinition, desiredCount: desiredCount}' \
    --output table

log_success "Rollback initiated"

# -----------------------------------------------------------------------------
# Wait for Deployment
# -----------------------------------------------------------------------------
log_info "Waiting for rollback to complete..."

DEPLOY_START_TIME=$(date +%s)
MAX_WAIT_TIME=600
POLL_INTERVAL=15

while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - DEPLOY_START_TIME))

    if [[ ${ELAPSED} -gt ${MAX_WAIT_TIME} ]]; then
        log_error "Rollback timed out after ${MAX_WAIT_TIME} seconds"
        exit 1
    fi

    DEPLOYMENTS=$(aws ecs describe-services \
        --cluster "${ECS_CLUSTER}" \
        --services "${ECS_SERVICE}" \
        --query 'services[0].deployments' \
        --output json)

    PRIMARY=$(echo "${DEPLOYMENTS}" | jq -r '.[] | select(.status == "PRIMARY")')
    RUNNING=$(echo "${PRIMARY}" | jq -r '.runningCount')
    DESIRED=$(echo "${PRIMARY}" | jq -r '.desiredCount')
    PENDING=$(echo "${PRIMARY}" | jq -r '.pendingCount')
    ROLLOUT_STATE=$(echo "${PRIMARY}" | jq -r '.rolloutState')

    echo -e "  [${ELAPSED}s] Running: ${RUNNING}/${DESIRED}, Pending: ${PENDING}, State: ${ROLLOUT_STATE}"

    if [[ "${ROLLOUT_STATE}" == "COMPLETED" ]]; then
        break
    elif [[ "${ROLLOUT_STATE}" == "FAILED" ]]; then
        log_error "Rollback deployment failed!"
        FAILURE_REASON=$(echo "${PRIMARY}" | jq -r '.rolloutStateReason // "Unknown"')
        log_error "Reason: ${FAILURE_REASON}"
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
echo -e "${CYAN}Rollback Summary${NC}"
echo "============================================================================="
echo "Service:        ${ECS_SERVICE}"
echo "Environment:    ${ENVIRONMENT}"
echo "Previous Image: ${CURRENT_IMAGE}"
echo "Rolled Back To: ${TARGET_IMAGE}"
echo "Duration:       ${DEPLOY_DURATION} seconds"
echo ""
log_success "Rollback completed successfully!"
echo ""
echo "Verify the rollback:"
echo "  ./health-check.sh ${ENVIRONMENT}"
echo "  ./tail-logs.sh ${SERVICE} ${ENVIRONMENT}"
echo "============================================================================="
