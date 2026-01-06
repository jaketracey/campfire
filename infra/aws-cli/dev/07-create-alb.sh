#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create Application Load Balancer
# =============================================================================
# Creates ALB with target groups and listeners for all services
#
# Usage: ./07-create-alb.sh
#
# This script is idempotent - running it multiple times will not create
# duplicate resources. Existing resources will be detected and reused.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli

log "Creating Application Load Balancer for environment: ${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# Create Application Load Balancer
# -----------------------------------------------------------------------------
log "Creating ALB: ${ALB_NAME}"

# Check if ALB already exists
EXISTING_ALB=$(aws elbv2 describe-load-balancers \
    --names "${ALB_NAME}" \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_ALB}" != "None" && -n "${EXISTING_ALB}" ]]; then
    ALB_ARN="${EXISTING_ALB}"
    log "ALB already exists: ${ALB_ARN}"
else
    ALB_ARN=$(aws elbv2 create-load-balancer \
        --name "${ALB_NAME}" \
        --subnets "${PUBLIC_SUBNET_1_ID}" "${PUBLIC_SUBNET_2_ID}" \
        --security-groups "${ALB_SG_ID}" \
        --scheme internet-facing \
        --type application \
        --ip-address-type ipv4 \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" \
        --query 'LoadBalancers[0].LoadBalancerArn' \
        --output text)
    log "ALB created: ${ALB_ARN}"
fi

ALB_DNS=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns "${ALB_ARN}" \
    --query 'LoadBalancers[0].DNSName' \
    --output text)

log "ALB DNS: ${ALB_DNS}"

# Wait for ALB to be active
log "Waiting for ALB to become active..."
aws elbv2 wait load-balancer-available --load-balancer-arns "${ALB_ARN}"
log "ALB is now active"

# -----------------------------------------------------------------------------
# Create Target Groups
# -----------------------------------------------------------------------------
log "Creating target groups"

# Helper function to get or create target group
get_or_create_tg() {
    local tg_name="$1"
    local port="$2"
    local health_path="$3"
    local service="$4"
    local health_port="${5:-$port}"

    local existing_tg=$(aws elbv2 describe-target-groups \
        --names "${tg_name}" \
        --query 'TargetGroups[0].TargetGroupArn' \
        --output text 2>/dev/null || echo "None")

    if [[ "${existing_tg}" != "None" && -n "${existing_tg}" ]]; then
        log "Target group ${tg_name} already exists"
        echo "${existing_tg}"
    else
        aws elbv2 create-target-group \
            --name "${tg_name}" \
            --protocol HTTP \
            --port "${port}" \
            --vpc-id "${VPC_ID}" \
            --target-type ip \
            --health-check-enabled \
            --health-check-protocol HTTP \
            --health-check-path "${health_path}" \
            --health-check-port "${health_port}" \
            --health-check-interval-seconds 30 \
            --health-check-timeout-seconds 5 \
            --healthy-threshold-count 2 \
            --unhealthy-threshold-count 3 \
            --matcher HttpCode=200 \
            --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Service,Value="${service}" \
            --query 'TargetGroups[0].TargetGroupArn' \
            --output text
        log "Target group ${tg_name} created"
    fi
}

# Gateway Target Group
GATEWAY_TG_ARN=$(get_or_create_tg "${RESOURCE_PREFIX}-gateway-tg" "4000" "/health" "gateway")
log "Gateway target group ready: ${GATEWAY_TG_ARN}"

# Web Target Group
WEB_TG_ARN=$(get_or_create_tg "${RESOURCE_PREFIX}-web-tg" "3000" "/api/health" "web")
log "Web target group ready: ${WEB_TG_ARN}"

# Orchestrator Target Group (for internal service calls if needed via ALB)
ORCHESTRATOR_TG_ARN=$(get_or_create_tg "${RESOURCE_PREFIX}-orch-tg" "5000" "/health" "orchestrator")
log "Orchestrator target group ready: ${ORCHESTRATOR_TG_ARN}"

# WebSocket Target Group (for gateway WS)
WS_TG_ARN=$(get_or_create_tg "${RESOURCE_PREFIX}-ws-tg" "4001" "/health" "websocket" "4000")

# Enable stickiness for WebSocket connections
aws elbv2 modify-target-group-attributes \
    --target-group-arn "${WS_TG_ARN}" \
    --attributes Key=stickiness.enabled,Value=true Key=stickiness.type,Value=lb_cookie Key=stickiness.lb_cookie.duration_seconds,Value=86400

log "WebSocket target group ready: ${WS_TG_ARN}"

# -----------------------------------------------------------------------------
# Create HTTP Listener (port 80)
# -----------------------------------------------------------------------------
log "Creating HTTP listener"

# Check if listener exists
EXISTING_HTTP_LISTENER=$(aws elbv2 describe-listeners \
    --load-balancer-arn "${ALB_ARN}" \
    --query "Listeners[?Port==\`80\`].ListenerArn" \
    --output text 2>/dev/null || echo "")

if [[ -n "${EXISTING_HTTP_LISTENER}" && "${EXISTING_HTTP_LISTENER}" != "None" ]]; then
    HTTP_LISTENER_ARN="${EXISTING_HTTP_LISTENER}"
    log "HTTP listener already exists: ${HTTP_LISTENER_ARN}"
else
    HTTP_LISTENER_ARN=$(aws elbv2 create-listener \
        --load-balancer-arn "${ALB_ARN}" \
        --protocol HTTP \
        --port 80 \
        --default-actions Type=forward,TargetGroupArn="${WEB_TG_ARN}" \
        --query 'Listeners[0].ListenerArn' \
        --output text)
    log "HTTP listener created: ${HTTP_LISTENER_ARN}"
fi

# -----------------------------------------------------------------------------
# Create Listener Rules for Path-based Routing
# -----------------------------------------------------------------------------
log "Creating listener rules for path-based routing"

# Helper function to create rule idempotently
create_rule_if_not_exists() {
    local priority="$1"
    local path="$2"
    local target_group="$3"
    local description="$4"

    # Check if rule with this priority exists
    local existing_rule=$(aws elbv2 describe-rules \
        --listener-arn "${HTTP_LISTENER_ARN}" \
        --query "Rules[?Priority=='${priority}'].RuleArn" \
        --output text 2>/dev/null || echo "")

    if [[ -n "${existing_rule}" && "${existing_rule}" != "None" ]]; then
        log "Rule ${description} already exists at priority ${priority}"
    else
        aws elbv2 create-rule \
            --listener-arn "${HTTP_LISTENER_ARN}" \
            --priority "${priority}" \
            --conditions Field=path-pattern,Values="${path}" \
            --actions Type=forward,TargetGroupArn="${target_group}" \
            --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" 2>/dev/null || true
        log "Rule created: ${description}"
    fi
}

# Rule 1: Route /api/* to Gateway
create_rule_if_not_exists "10" "/api/*" "${GATEWAY_TG_ARN}" "/api/* -> Gateway"

# Rule 2: Route /ws to WebSocket
create_rule_if_not_exists "20" "/ws" "${WS_TG_ARN}" "/ws -> WebSocket"

# Rule 3: Route /ws/* to WebSocket (for socket.io paths)
create_rule_if_not_exists "25" "/ws/*" "${WS_TG_ARN}" "/ws/* -> WebSocket"

# Rule 4: Route /socket.io/* to WebSocket
create_rule_if_not_exists "26" "/socket.io/*" "${WS_TG_ARN}" "/socket.io/* -> WebSocket"

# Rule 5: Route /health to Gateway (for ALB health checks)
create_rule_if_not_exists "30" "/health" "${GATEWAY_TG_ARN}" "/health -> Gateway"

# Rule 6: Route /graphql to Gateway (if using GraphQL)
create_rule_if_not_exists "35" "/graphql" "${GATEWAY_TG_ARN}" "/graphql -> Gateway"

# -----------------------------------------------------------------------------
# Save ALB Configuration
# -----------------------------------------------------------------------------
# Only append if ALB_ARN is not already in the file
if ! grep -q "^export ALB_ARN=" "${SCRIPT_DIR}/vpc-outputs.env" 2>/dev/null; then
    cat >> "${SCRIPT_DIR}/vpc-outputs.env" << EOF

# ALB Resources - Generated by 07-create-alb.sh
export ALB_ARN="${ALB_ARN}"
export ALB_DNS="${ALB_DNS}"
	export HTTP_LISTENER_ARN="${HTTP_LISTENER_ARN}"
	export GATEWAY_TG_ARN="${GATEWAY_TG_ARN}"
	export WEB_TG_ARN="${WEB_TG_ARN}"
	export ORCHESTRATOR_TG_ARN="${ORCHESTRATOR_TG_ARN}"
	export WS_TG_ARN="${WS_TG_ARN}"
EOF
    log "ALB configuration saved to vpc-outputs.env"
else
    log "ALB configuration already exists in vpc-outputs.env"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "Application Load Balancer Created Successfully"
echo "============================================================================="
echo "ALB Name:      ${ALB_NAME}"
echo "ALB DNS:       ${ALB_DNS}"
echo "ALB ARN:       ${ALB_ARN}"
echo ""
echo "Target Groups:"
echo "  - Gateway:      ${GATEWAY_TG_ARN}"
echo "  - Web:          ${WEB_TG_ARN}"
echo "  - Orchestrator: ${ORCHESTRATOR_TG_ARN}"
echo "  - WebSocket:    ${WS_TG_ARN}"
echo ""
echo "Routing Rules:"
echo "  - /api/*       -> Gateway (port 4000)"
echo "  - /ws          -> WebSocket (port 4001)"
echo "  - /ws/*        -> WebSocket (port 4001)"
echo "  - /socket.io/* -> WebSocket (port 4001)"
echo "  - /health      -> Gateway (port 4000)"
echo "  - /graphql     -> Gateway (port 4000)"
echo "  - /*           -> Web App (port 3000) [default]"
echo ""
echo "Access the application at: http://${ALB_DNS}"
echo ""
echo "NOTE: For production, you should:"
echo "  1. Create an SSL certificate in ACM"
echo "  2. Add HTTPS listener (port 443)"
echo "  3. Redirect HTTP to HTTPS"
echo "  4. Add custom domain with Route 53"
echo ""
echo "Next step: ./08-create-iam-roles.sh"
echo "============================================================================="
