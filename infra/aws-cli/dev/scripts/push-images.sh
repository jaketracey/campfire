#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Push Docker Images to ECR
# =============================================================================
# Builds and pushes Docker images for all services to ECR
#
# Usage: ./scripts/push-images.sh [service_name] [tag]
#
# Examples:
#   ./scripts/push-images.sh                    # Push all services with 'latest' tag
#   ./scripts/push-images.sh gateway            # Push only gateway with 'latest' tag
#   ./scripts/push-images.sh gateway v1.0.0     # Push gateway with specific tag
#   ./scripts/push-images.sh all dev-$(date +%Y%m%d)  # Push all with date tag
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../00-config.sh"

check_aws_cli

SERVICE="${1:-all}"
TAG="${2:-latest}"

# Get AWS Account ID and ECR registry
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Project root directory (assuming standard monorepo structure)
PROJECT_ROOT="${SCRIPT_DIR}/../../../../"

log "ECR Registry: ${ECR_REGISTRY}"
log "Tag: ${TAG}"

# -----------------------------------------------------------------------------
# Login to ECR
# -----------------------------------------------------------------------------
log "Logging into ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${ECR_REGISTRY}"

# -----------------------------------------------------------------------------
# Build and Push Function
# -----------------------------------------------------------------------------
build_and_push() {
    local service_name="$1"
    local ecr_repo="$2"
    local dockerfile_path="$3"
    local build_context="$4"

    log "Building ${service_name}..."

    # Check if Dockerfile exists
    if [[ ! -f "${dockerfile_path}" ]]; then
        log "WARNING: Dockerfile not found at ${dockerfile_path}, skipping ${service_name}"
        return 0
    fi

    # Build the image
    docker build \
        -f "${dockerfile_path}" \
        -t "${service_name}:${TAG}" \
        --build-arg NODE_ENV=production \
        "${build_context}"

    # Tag for ECR
    docker tag "${service_name}:${TAG}" "${ECR_REGISTRY}/${ecr_repo}:${TAG}"

    # Also tag as latest if not already latest
    if [[ "${TAG}" != "latest" ]]; then
        docker tag "${service_name}:${TAG}" "${ECR_REGISTRY}/${ecr_repo}:latest"
    fi

    log "Pushing ${service_name} to ECR..."
    docker push "${ECR_REGISTRY}/${ecr_repo}:${TAG}"

    if [[ "${TAG}" != "latest" ]]; then
        docker push "${ECR_REGISTRY}/${ecr_repo}:latest"
    fi

    log "${service_name} pushed successfully"
}

# -----------------------------------------------------------------------------
# Build and Push Services
# -----------------------------------------------------------------------------

if [[ "${SERVICE}" == "all" || "${SERVICE}" == "gateway" ]]; then
    build_and_push "gateway" "${ECR_GATEWAY_REPO}" \
        "${PROJECT_ROOT}/infra/docker/Dockerfile.gateway" \
        "${PROJECT_ROOT}"
fi

if [[ "${SERVICE}" == "all" || "${SERVICE}" == "orchestrator" ]]; then
    build_and_push "orchestrator" "${ECR_ORCHESTRATOR_REPO}" \
        "${PROJECT_ROOT}/infra/docker/Dockerfile.orchestrator" \
        "${PROJECT_ROOT}"
fi

if [[ "${SERVICE}" == "all" || "${SERVICE}" == "web" ]]; then
    build_and_push "web" "${ECR_WEB_REPO}" \
        "${PROJECT_ROOT}/infra/docker/Dockerfile.web" \
        "${PROJECT_ROOT}"
fi

if [[ "${SERVICE}" == "all" || "${SERVICE}" == "workers" ]]; then
    build_and_push "workers" "${ECR_WORKERS_REPO}" \
        "${PROJECT_ROOT}/infra/docker/Dockerfile.workers" \
        "${PROJECT_ROOT}"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "Images Pushed Successfully"
echo "============================================================================="
echo "Registry: ${ECR_REGISTRY}"
echo "Tag: ${TAG}"
echo ""
echo "Images:"

if [[ "${SERVICE}" == "all" ]]; then
    echo "  - ${ECR_REGISTRY}/${ECR_GATEWAY_REPO}:${TAG}"
    echo "  - ${ECR_REGISTRY}/${ECR_ORCHESTRATOR_REPO}:${TAG}"
    echo "  - ${ECR_REGISTRY}/${ECR_WEB_REPO}:${TAG}"
    echo "  - ${ECR_REGISTRY}/${ECR_WORKERS_REPO}:${TAG}"
else
    echo "  - ${ECR_REGISTRY}/${RESOURCE_PREFIX}/${SERVICE}:${TAG}"
fi

echo ""
echo "To deploy the new images, run:"
echo "  ./10-deploy-services.sh"
echo ""
echo "Or force a new deployment:"
echo "  aws ecs update-service --cluster ${ECS_CLUSTER_NAME} --service ${RESOURCE_PREFIX}-${SERVICE} --force-new-deployment"
echo ""
echo "============================================================================="
