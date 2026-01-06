#!/bin/bash
# =============================================================================
# Campfire Deployment Helper - Health Check
# =============================================================================
# Checks health of all services via ALB health endpoints
#
# Usage: ./health-check.sh <environment>
#
# Arguments:
#   environment - dev, staging, or prod
#
# Examples:
#   ./health-check.sh dev
#   ./health-check.sh staging
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
    echo "Usage: $0 <environment>"
    echo ""
    echo "Arguments:"
    echo "  environment - dev, staging, or prod"
    echo ""
    echo "Examples:"
    echo "  $0 dev"
    echo "  $0 staging"
    exit 1
}

# -----------------------------------------------------------------------------
# Validate Arguments
# -----------------------------------------------------------------------------
if [[ $# -lt 1 ]]; then
    log_error "Missing required arguments"
    usage
fi

ENVIRONMENT="$1"

VALID_ENVIRONMENTS=("dev" "staging" "prod")

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
ALB_NAME="${RESOURCE_PREFIX}-alb"

# Service health check paths
declare -A HEALTH_PATHS
HEALTH_PATHS=(
    ["gateway"]="/health:4000"
    ["orchestrator"]="/health:5000"
    ["web"]="/api/health:3000"
    ["workers"]="/health:8080"
)

echo ""
echo -e "${CYAN}=============================================================================${NC}"
echo -e "${CYAN}                Health Check - ${ENVIRONMENT}${NC}"
echo -e "${CYAN}=============================================================================${NC}"
echo ""

# -----------------------------------------------------------------------------
# Get ALB DNS
# -----------------------------------------------------------------------------
log_info "Getting ALB information..."

ALB_DNS=$(aws elbv2 describe-load-balancers \
    --names "${ALB_NAME}" \
    --query 'LoadBalancers[0].DNSName' \
    --output text \
    --region "${AWS_REGION}" 2>/dev/null || echo "")

if [[ -z "${ALB_DNS}" ]] || [[ "${ALB_DNS}" == "None" ]]; then
    log_warn "ALB not found: ${ALB_NAME}"
    log_info "Will check ECS service status only"
    ALB_DNS=""
else
    echo "  ALB DNS: ${ALB_DNS}"
fi

echo ""

# -----------------------------------------------------------------------------
# Check ECS Services
# -----------------------------------------------------------------------------
log_info "Checking ECS service status..."
echo ""

SERVICES=("gateway" "orchestrator" "web" "workers")
ALL_HEALTHY=true

printf "%-15s %-10s %-15s %-10s %-20s\n" "SERVICE" "STATUS" "RUNNING" "DESIRED" "HEALTH"
printf "%-15s %-10s %-15s %-10s %-20s\n" "-------" "------" "-------" "-------" "------"

for svc in "${SERVICES[@]}"; do
    SERVICE_NAME="${RESOURCE_PREFIX}-${svc}"

    # Get service info
    SERVICE_INFO=$(aws ecs describe-services \
        --cluster "${ECS_CLUSTER}" \
        --services "${SERVICE_NAME}" \
        --query 'services[0]' \
        --output json \
        --region "${AWS_REGION}" 2>/dev/null || echo "{}")

    if [[ "${SERVICE_INFO}" == "{}" ]] || [[ $(echo "${SERVICE_INFO}" | jq -r '.status') == "null" ]]; then
        printf "%-15s ${RED}%-10s${NC} %-15s %-10s %-20s\n" "${svc}" "NOT_FOUND" "-" "-" "-"
        ALL_HEALTHY=false
        continue
    fi

    STATUS=$(echo "${SERVICE_INFO}" | jq -r '.status')
    RUNNING=$(echo "${SERVICE_INFO}" | jq -r '.runningCount')
    DESIRED=$(echo "${SERVICE_INFO}" | jq -r '.desiredCount')

    # Determine health status
    if [[ "${STATUS}" == "ACTIVE" ]] && [[ "${RUNNING}" == "${DESIRED}" ]] && [[ "${RUNNING}" != "0" ]]; then
        HEALTH_STATUS="${GREEN}HEALTHY${NC}"
    elif [[ "${STATUS}" == "ACTIVE" ]] && [[ "${RUNNING}" != "${DESIRED}" ]]; then
        HEALTH_STATUS="${YELLOW}DEGRADED${NC}"
        ALL_HEALTHY=false
    else
        HEALTH_STATUS="${RED}UNHEALTHY${NC}"
        ALL_HEALTHY=false
    fi

    printf "%-15s %-10s %-15s %-10s ${HEALTH_STATUS}\n" "${svc}" "${STATUS}" "${RUNNING}" "${DESIRED}"
done

echo ""

# -----------------------------------------------------------------------------
# Check Target Group Health (if ALB exists)
# -----------------------------------------------------------------------------
if [[ -n "${ALB_DNS}" ]]; then
    log_info "Checking ALB target group health..."
    echo ""

    # Get target groups
    TARGET_GROUPS=$(aws elbv2 describe-target-groups \
        --query "TargetGroups[?starts_with(TargetGroupName, '${RESOURCE_PREFIX}')].{Name: TargetGroupName, Arn: TargetGroupArn}" \
        --output json \
        --region "${AWS_REGION}")

    printf "%-25s %-10s %-10s %-10s\n" "TARGET_GROUP" "HEALTHY" "UNHEALTHY" "DRAINING"
    printf "%-25s %-10s %-10s %-10s\n" "------------" "-------" "---------" "--------"

    echo "${TARGET_GROUPS}" | jq -c '.[]' | while read -r tg; do
        TG_NAME=$(echo "${tg}" | jq -r '.Name')
        TG_ARN=$(echo "${tg}" | jq -r '.Arn')

        # Get target health
        HEALTH_INFO=$(aws elbv2 describe-target-health \
            --target-group-arn "${TG_ARN}" \
            --query 'TargetHealthDescriptions' \
            --output json \
            --region "${AWS_REGION}")

        HEALTHY_COUNT=$(echo "${HEALTH_INFO}" | jq '[.[] | select(.TargetHealth.State == "healthy")] | length')
        UNHEALTHY_COUNT=$(echo "${HEALTH_INFO}" | jq '[.[] | select(.TargetHealth.State == "unhealthy")] | length')
        DRAINING_COUNT=$(echo "${HEALTH_INFO}" | jq '[.[] | select(.TargetHealth.State == "draining")] | length')

        if [[ "${UNHEALTHY_COUNT}" -gt 0 ]]; then
            printf "%-25s ${GREEN}%-10s${NC} ${RED}%-10s${NC} ${YELLOW}%-10s${NC}\n" "${TG_NAME}" "${HEALTHY_COUNT}" "${UNHEALTHY_COUNT}" "${DRAINING_COUNT}"
        else
            printf "%-25s ${GREEN}%-10s${NC} %-10s ${YELLOW}%-10s${NC}\n" "${TG_NAME}" "${HEALTHY_COUNT}" "${UNHEALTHY_COUNT}" "${DRAINING_COUNT}"
        fi
    done

    echo ""
fi

# -----------------------------------------------------------------------------
# HTTP Health Checks (if ALB exists)
# -----------------------------------------------------------------------------
if [[ -n "${ALB_DNS}" ]]; then
    log_info "Performing HTTP health checks..."
    echo ""

    # Note: These checks hit the ALB endpoints
    # Adjust paths based on your ALB routing rules

    HTTP_ENDPOINTS=(
        "/"
        "/api/health"
    )

    printf "%-30s %-10s %-10s\n" "ENDPOINT" "STATUS" "RESPONSE"
    printf "%-30s %-10s %-10s\n" "--------" "------" "--------"

    for endpoint in "${HTTP_ENDPOINTS[@]}"; do
        URL="http://${ALB_DNS}${endpoint}"

        # Make request with timeout
        HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "${URL}" 2>/dev/null || echo "000")

        if [[ "${HTTP_RESPONSE}" == "200" ]]; then
            printf "%-30s ${GREEN}%-10s${NC} %-10s\n" "${endpoint}" "${HTTP_RESPONSE}" "OK"
        elif [[ "${HTTP_RESPONSE}" == "000" ]]; then
            printf "%-30s ${RED}%-10s${NC} %-10s\n" "${endpoint}" "TIMEOUT" "No response"
            ALL_HEALTHY=false
        else
            printf "%-30s ${YELLOW}%-10s${NC} %-10s\n" "${endpoint}" "${HTTP_RESPONSE}" "Check logs"
        fi
    done

    echo ""
fi

# -----------------------------------------------------------------------------
# Recent Service Events
# -----------------------------------------------------------------------------
log_info "Recent service events (last 5 per service)..."
echo ""

for svc in "${SERVICES[@]}"; do
    SERVICE_NAME="${RESOURCE_PREFIX}-${svc}"

    EVENTS=$(aws ecs describe-services \
        --cluster "${ECS_CLUSTER}" \
        --services "${SERVICE_NAME}" \
        --query 'services[0].events[:3]' \
        --output json \
        --region "${AWS_REGION}" 2>/dev/null || echo "[]")

    if [[ "${EVENTS}" != "[]" ]]; then
        echo -e "${CYAN}${svc}:${NC}"
        echo "${EVENTS}" | jq -r '.[] | "  [\(.createdAt | split("T")[0])] \(.message | .[0:80])"' 2>/dev/null || true
        echo ""
    fi
done

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo "============================================================================="
if ${ALL_HEALTHY}; then
    log_success "All services are healthy!"
else
    log_warn "Some services may have issues. Check logs for details:"
    echo ""
    echo "  View logs:    ./tail-logs.sh <service> ${ENVIRONMENT}"
    echo "  ECS Console:  https://${AWS_REGION}.console.aws.amazon.com/ecs/v2/clusters/${ECS_CLUSTER}/services"
fi

if [[ -n "${ALB_DNS}" ]]; then
    echo ""
    echo "Application URL: http://${ALB_DNS}"
fi
echo "============================================================================="
