#!/bin/bash
# =============================================================================
# Campfire Deployment Helper - Tail CloudWatch Logs
# =============================================================================
# Tails CloudWatch logs for a specific service in real-time
#
# Usage: ./tail-logs.sh <service> <environment> [options]
#
# Arguments:
#   service     - gateway, orchestrator, web, or workers
#   environment - dev, staging, or prod
#
# Options:
#   --since <time>     - How far back to start (default: 10m)
#                        Examples: 5m, 1h, 2d
#   --filter <pattern> - Filter pattern for logs
#                        Examples: ERROR, "status=500", "userId"
#   --no-follow        - Don't follow logs (just show recent)
#
# Examples:
#   ./tail-logs.sh gateway dev
#   ./tail-logs.sh web staging --since 1h
#   ./tail-logs.sh orchestrator prod --filter ERROR
#   ./tail-logs.sh workers dev --filter "job failed" --since 30m
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
    echo "Usage: $0 <service> <environment> [options]"
    echo ""
    echo "Arguments:"
    echo "  service     - gateway, orchestrator, web, or workers"
    echo "  environment - dev, staging, or prod"
    echo ""
    echo "Options:"
    echo "  --since <time>     - How far back to start (default: 10m)"
    echo "                       Examples: 5m, 1h, 2d"
    echo "  --filter <pattern> - Filter pattern for logs"
    echo "                       Examples: ERROR, 'status=500'"
    echo "  --no-follow        - Don't follow logs (just show recent)"
    echo ""
    echo "Examples:"
    echo "  $0 gateway dev"
    echo "  $0 web staging --since 1h"
    echo "  $0 orchestrator prod --filter ERROR"
    echo "  $0 workers dev --filter 'job failed' --since 30m --no-follow"
    exit 1
}

# -----------------------------------------------------------------------------
# Parse Arguments
# -----------------------------------------------------------------------------
if [[ $# -lt 2 ]]; then
    log_error "Missing required arguments"
    usage
fi

SERVICE="$1"
ENVIRONMENT="$2"
shift 2

# Default options
SINCE="10m"
FILTER=""
FOLLOW=true

# Parse optional arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --since)
            SINCE="$2"
            shift 2
            ;;
        --filter)
            FILTER="$2"
            shift 2
            ;;
        --no-follow)
            FOLLOW=false
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

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
LOG_GROUP="/ecs/${RESOURCE_PREFIX}/${SERVICE}"

echo ""
echo -e "${CYAN}=============================================================================${NC}"
echo -e "${CYAN}                Tailing Logs - ${SERVICE} - ${ENVIRONMENT}${NC}"
echo -e "${CYAN}=============================================================================${NC}"
echo ""
echo "  Log Group: ${LOG_GROUP}"
echo "  Since:     ${SINCE}"
echo "  Filter:    ${FILTER:-'(none)'}"
echo "  Follow:    ${FOLLOW}"
echo ""

# -----------------------------------------------------------------------------
# Verify Log Group Exists
# -----------------------------------------------------------------------------
log_info "Verifying log group exists..."

if ! aws logs describe-log-groups \
    --log-group-name-prefix "${LOG_GROUP}" \
    --query "logGroups[?logGroupName=='${LOG_GROUP}'].logGroupName" \
    --output text \
    --region "${AWS_REGION}" | grep -q "${LOG_GROUP}"; then
    log_error "Log group not found: ${LOG_GROUP}"
    log_info "Available log groups for ${RESOURCE_PREFIX}:"
    aws logs describe-log-groups \
        --log-group-name-prefix "/ecs/${RESOURCE_PREFIX}" \
        --query 'logGroups[*].logGroupName' \
        --output table \
        --region "${AWS_REGION}"
    exit 1
fi

log_success "Log group found"
echo ""

# -----------------------------------------------------------------------------
# Build AWS Logs Command
# -----------------------------------------------------------------------------
CMD_ARGS=(
    "logs"
    "tail"
    "${LOG_GROUP}"
    "--since"
    "${SINCE}"
    "--region"
    "${AWS_REGION}"
    "--format"
    "short"
)

if ${FOLLOW}; then
    CMD_ARGS+=("--follow")
fi

if [[ -n "${FILTER}" ]]; then
    CMD_ARGS+=("--filter-pattern" "${FILTER}")
fi

# -----------------------------------------------------------------------------
# Tail Logs
# -----------------------------------------------------------------------------
echo "============================================================================="
echo "Starting log tail... (Ctrl+C to stop)"
echo "============================================================================="
echo ""

# Handle interrupt gracefully
trap 'echo ""; log_info "Log tail stopped"; exit 0' INT TERM

# Execute the command
aws "${CMD_ARGS[@]}"
