#!/bin/bash
# =============================================================================
# Campfire Deployment Helper - Build and Push Docker Images to ECR
# =============================================================================
# Builds Docker images and pushes them to Amazon ECR
#
# Usage: ./build-and-push.sh <service|all> <environment>
#
# Arguments:
#   service     - gateway, orchestrator, web, marketing, workers, or "all"
#   environment - dev, staging, or prod
#
# Examples:
#   ./build-and-push.sh gateway dev
#   ./build-and-push.sh all staging
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
    echo "Usage: $0 <service|all> <environment>"
    echo ""
    echo "Arguments:"
    echo "  service     - gateway, orchestrator, web, marketing, workers, or 'all'"
    echo "  environment - dev, staging, or prod"
    echo ""
    echo "Examples:"
    echo "  $0 gateway dev"
    echo "  $0 all staging"
    echo "  $0 web prod"
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

VALID_SERVICES=("gateway" "orchestrator" "web" "marketing" "workers" "all")
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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Get Git SHA for tagging
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_SHA=$(git rev-parse --short HEAD)
    GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
else
    GIT_SHA="unknown"
    GIT_BRANCH="unknown"
    log_warn "Not a git repository. Using 'unknown' for git SHA."
fi

BUILD_TIMESTAMP=$(date +%Y%m%d-%H%M%S)

log_info "Build Configuration:"
echo "  Project Root: ${PROJECT_ROOT}"
echo "  Environment:  ${ENVIRONMENT}"
echo "  Service:      ${SERVICE}"
echo "  Git SHA:      ${GIT_SHA}"
echo "  Git Branch:   ${GIT_BRANCH}"
echo "  AWS Region:   ${AWS_REGION}"
echo ""

# -----------------------------------------------------------------------------
# ECR Login
# -----------------------------------------------------------------------------
log_info "Logging into ECR..."

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${ECR_REGISTRY}"

log_success "ECR login successful"

# -----------------------------------------------------------------------------
# Build and Push Function
# -----------------------------------------------------------------------------
build_and_push_service() {
    local service_name="$1"
    local dockerfile="infra/docker/Dockerfile.${service_name}"
    local ecr_repo="${RESOURCE_PREFIX}/${service_name}"
    local full_repo="${ECR_REGISTRY}/${ecr_repo}"

    log_info "Building ${service_name}..."

    # Check if Dockerfile exists
    if [[ ! -f "${PROJECT_ROOT}/${dockerfile}" ]]; then
        log_error "Dockerfile not found: ${PROJECT_ROOT}/${dockerfile}"
        return 1
    fi

    # Build the image
    docker build \
        --file "${PROJECT_ROOT}/${dockerfile}" \
        --tag "${service_name}:${GIT_SHA}" \
        --tag "${service_name}:latest" \
        --build-arg BUILD_ENV="${ENVIRONMENT}" \
        --build-arg GIT_SHA="${GIT_SHA}" \
        --build-arg BUILD_TIMESTAMP="${BUILD_TIMESTAMP}" \
        "${PROJECT_ROOT}"

    log_success "Built ${service_name}:${GIT_SHA}"

    # Tag for ECR
    docker tag "${service_name}:${GIT_SHA}" "${full_repo}:${GIT_SHA}"
    docker tag "${service_name}:latest" "${full_repo}:latest"
    docker tag "${service_name}:${GIT_SHA}" "${full_repo}:${ENVIRONMENT}-${GIT_SHA}"

    log_info "Pushing ${service_name} to ECR..."

    # Push all tags
    docker push "${full_repo}:${GIT_SHA}"
    docker push "${full_repo}:latest"
    docker push "${full_repo}:${ENVIRONMENT}-${GIT_SHA}"

    log_success "Pushed ${service_name} to ${full_repo}"
    echo "  Tags pushed:"
    echo "    - ${full_repo}:${GIT_SHA}"
    echo "    - ${full_repo}:latest"
    echo "    - ${full_repo}:${ENVIRONMENT}-${GIT_SHA}"
    echo ""
}

# -----------------------------------------------------------------------------
# Build Services
# -----------------------------------------------------------------------------
SERVICES_TO_BUILD=()

if [[ "${SERVICE}" == "all" ]]; then
    SERVICES_TO_BUILD=("gateway" "orchestrator" "web" "marketing" "workers")
else
    SERVICES_TO_BUILD=("${SERVICE}")
fi

log_info "Services to build: ${SERVICES_TO_BUILD[*]}"
echo ""

BUILD_START_TIME=$(date +%s)
FAILED_SERVICES=()

for svc in "${SERVICES_TO_BUILD[@]}"; do
    echo "============================================================================="
    if ! build_and_push_service "${svc}"; then
        FAILED_SERVICES+=("${svc}")
        log_error "Failed to build/push ${svc}"
    fi
done

BUILD_END_TIME=$(date +%s)
BUILD_DURATION=$((BUILD_END_TIME - BUILD_START_TIME))

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo -e "${CYAN}Build and Push Summary${NC}"
echo "============================================================================="
echo "Environment:    ${ENVIRONMENT}"
echo "Git SHA:        ${GIT_SHA}"
echo "ECR Registry:   ${ECR_REGISTRY}"
echo "Duration:       ${BUILD_DURATION} seconds"
echo ""

if [[ ${#FAILED_SERVICES[@]} -eq 0 ]]; then
    log_success "All services built and pushed successfully!"
    echo ""
    echo "Next steps:"
    echo "  Deploy a single service:"
    echo "    ./deploy-service.sh <service> ${ENVIRONMENT}"
    echo ""
    echo "  Deploy all services:"
    echo "    for svc in gateway orchestrator web marketing workers; do"
    echo "      ./deploy-service.sh \$svc ${ENVIRONMENT}"
    echo "    done"
else
    log_error "Some services failed to build/push:"
    for failed in "${FAILED_SERVICES[@]}"; do
        echo "  - ${failed}"
    done
    exit 1
fi
echo "============================================================================="
