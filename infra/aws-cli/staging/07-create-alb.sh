#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create Application Load Balancer (Staging)
# =============================================================================
# Creates ALB with target groups and listeners for all services
# with production-like security settings (HTTPS, deletion protection)
#
# Usage: ./07-create-alb.sh
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

ALB_ARN=$(aws elbv2 create-load-balancer \
    --name "${ALB_NAME}" \
    --subnets "${PUBLIC_SUBNET_1_ID}" "${PUBLIC_SUBNET_2_ID}" \
    --security-groups "${ALB_SG_ID}" \
    --scheme internet-facing \
    --type application \
    --ip-address-type ipv4 \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=CostCenter,Value="${TAG_COST_CENTER}" \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text)

ALB_DNS=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns "${ALB_ARN}" \
    --query 'LoadBalancers[0].DNSName' \
    --output text)

log "ALB created: ${ALB_ARN}"
log "ALB DNS: ${ALB_DNS}"

# Enable deletion protection (production-like)
if [[ "${ALB_DELETION_PROTECTION}" == "true" ]]; then
    aws elbv2 modify-load-balancer-attributes \
        --load-balancer-arn "${ALB_ARN}" \
        --attributes Key=deletion_protection.enabled,Value=true

    log "Deletion protection enabled"
fi

# Enable access logging (production-like)
# Note: Requires S3 bucket with proper permissions - skipped for now
# aws elbv2 modify-load-balancer-attributes \
#     --load-balancer-arn "${ALB_ARN}" \
#     --attributes Key=access_logs.s3.enabled,Value=true Key=access_logs.s3.bucket,Value=${ALB_LOGS_BUCKET}

# -----------------------------------------------------------------------------
# Create Target Groups
# -----------------------------------------------------------------------------
log "Creating target groups"

# Gateway Target Group
GATEWAY_TG_ARN=$(aws elbv2 create-target-group \
    --name "${RESOURCE_PREFIX}-gateway-tg" \
    --protocol HTTP \
    --port 4000 \
    --vpc-id "${VPC_ID}" \
    --target-type ip \
    --health-check-enabled \
    --health-check-protocol HTTP \
    --health-check-path "/health" \
    --health-check-interval-seconds 30 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --matcher HttpCode=200 \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Service,Value=gateway \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)

# Configure deregistration delay (production-like)
aws elbv2 modify-target-group-attributes \
    --target-group-arn "${GATEWAY_TG_ARN}" \
    --attributes Key=deregistration_delay.timeout_seconds,Value=30

log "Gateway target group created: ${GATEWAY_TG_ARN}"

# Web Target Group
WEB_TG_ARN=$(aws elbv2 create-target-group \
    --name "${RESOURCE_PREFIX}-web-tg" \
    --protocol HTTP \
    --port 3000 \
    --vpc-id "${VPC_ID}" \
    --target-type ip \
    --health-check-enabled \
    --health-check-protocol HTTP \
    --health-check-path "/api/health" \
    --health-check-interval-seconds 30 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --matcher HttpCode=200 \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Service,Value=web \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)

aws elbv2 modify-target-group-attributes \
    --target-group-arn "${WEB_TG_ARN}" \
    --attributes Key=deregistration_delay.timeout_seconds,Value=30

log "Web target group created: ${WEB_TG_ARN}"

# WebSocket Target Group (for gateway WS)
WS_TG_ARN=$(aws elbv2 create-target-group \
    --name "${RESOURCE_PREFIX}-ws-tg" \
    --protocol HTTP \
    --port 4001 \
    --vpc-id "${VPC_ID}" \
    --target-type ip \
    --health-check-enabled \
    --health-check-protocol HTTP \
    --health-check-path "/health" \
    --health-check-port "4000" \
    --health-check-interval-seconds 30 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --matcher HttpCode=200 \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Service,Value=websocket \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)

# Enable stickiness for WebSocket connections
aws elbv2 modify-target-group-attributes \
    --target-group-arn "${WS_TG_ARN}" \
    --attributes \
        Key=stickiness.enabled,Value=true \
        Key=stickiness.type,Value=lb_cookie \
        Key=stickiness.lb_cookie.duration_seconds,Value=86400 \
        Key=deregistration_delay.timeout_seconds,Value=30

log "WebSocket target group created: ${WS_TG_ARN}"

# -----------------------------------------------------------------------------
# Create HTTP Listener (port 80) - Redirects to HTTPS
# -----------------------------------------------------------------------------
log "Creating HTTP listener (redirect to HTTPS)"

HTTP_LISTENER_ARN=$(aws elbv2 create-listener \
    --load-balancer-arn "${ALB_ARN}" \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=redirect,RedirectConfig="{Protocol=HTTPS,Port=443,StatusCode=HTTP_301}" \
    --query 'Listeners[0].ListenerArn' \
    --output text)

log "HTTP listener created with HTTPS redirect: ${HTTP_LISTENER_ARN}"

# -----------------------------------------------------------------------------
# Create HTTPS Listener (port 443)
# Note: Requires SSL certificate - using placeholder for now
# -----------------------------------------------------------------------------
log "Creating HTTPS listener placeholder"

# Check if certificate exists for staging domain
CERT_ARN=$(aws acm list-certificates \
    --query "CertificateSummaryList[?DomainName=='staging.campfire.dev'].CertificateArn" \
    --output text 2>/dev/null || echo "")

if [[ -n "${CERT_ARN}" && "${CERT_ARN}" != "None" ]]; then
    log "Found SSL certificate: ${CERT_ARN}"

    HTTPS_LISTENER_ARN=$(aws elbv2 create-listener \
        --load-balancer-arn "${ALB_ARN}" \
        --protocol HTTPS \
        --port 443 \
        --ssl-policy "${SSL_POLICY}" \
        --certificates CertificateArn="${CERT_ARN}" \
        --default-actions Type=forward,TargetGroupArn="${WEB_TG_ARN}" \
        --query 'Listeners[0].ListenerArn' \
        --output text)

    log "HTTPS listener created: ${HTTPS_LISTENER_ARN}"

    # Create Listener Rules for Path-based Routing on HTTPS
    log "Creating HTTPS listener rules for path-based routing"

    # Rule 1: Route /api/* to Gateway
    aws elbv2 create-rule \
        --listener-arn "${HTTPS_LISTENER_ARN}" \
        --priority 10 \
        --conditions Field=path-pattern,Values='/api/*' \
        --actions Type=forward,TargetGroupArn="${GATEWAY_TG_ARN}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Rule created: /api/* -> Gateway"

    # Rule 2: Route /ws to WebSocket
    aws elbv2 create-rule \
        --listener-arn "${HTTPS_LISTENER_ARN}" \
        --priority 20 \
        --conditions Field=path-pattern,Values='/ws' \
        --actions Type=forward,TargetGroupArn="${WS_TG_ARN}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Rule created: /ws -> WebSocket"

    # Rule 3: Route /health to Gateway
    aws elbv2 create-rule \
        --listener-arn "${HTTPS_LISTENER_ARN}" \
        --priority 30 \
        --conditions Field=path-pattern,Values='/health' \
        --actions Type=forward,TargetGroupArn="${GATEWAY_TG_ARN}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Rule created: /health -> Gateway"
else
    log "No SSL certificate found for staging.campfire.dev"
    log "Creating HTTP listener with forward action for testing"

    # Override HTTP listener to forward instead of redirect for testing
    aws elbv2 modify-listener \
        --listener-arn "${HTTP_LISTENER_ARN}" \
        --default-actions Type=forward,TargetGroupArn="${WEB_TG_ARN}"

    # Create Listener Rules for Path-based Routing on HTTP
    log "Creating HTTP listener rules for path-based routing"

    aws elbv2 create-rule \
        --listener-arn "${HTTP_LISTENER_ARN}" \
        --priority 10 \
        --conditions Field=path-pattern,Values='/api/*' \
        --actions Type=forward,TargetGroupArn="${GATEWAY_TG_ARN}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    aws elbv2 create-rule \
        --listener-arn "${HTTP_LISTENER_ARN}" \
        --priority 20 \
        --conditions Field=path-pattern,Values='/ws' \
        --actions Type=forward,TargetGroupArn="${WS_TG_ARN}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    aws elbv2 create-rule \
        --listener-arn "${HTTP_LISTENER_ARN}" \
        --priority 30 \
        --conditions Field=path-pattern,Values='/health' \
        --actions Type=forward,TargetGroupArn="${GATEWAY_TG_ARN}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    HTTPS_LISTENER_ARN=""
    warn "HTTPS not configured - create SSL certificate and update listener"
fi

# -----------------------------------------------------------------------------
# Save ALB Configuration
# -----------------------------------------------------------------------------
cat >> "${SCRIPT_DIR}/vpc-outputs.env" << EOF

# ALB Resources - Generated by 07-create-alb.sh
export ALB_ARN="${ALB_ARN}"
export ALB_DNS="${ALB_DNS}"
export HTTP_LISTENER_ARN="${HTTP_LISTENER_ARN}"
export HTTPS_LISTENER_ARN="${HTTPS_LISTENER_ARN:-}"
export GATEWAY_TG_ARN="${GATEWAY_TG_ARN}"
export WEB_TG_ARN="${WEB_TG_ARN}"
export WS_TG_ARN="${WS_TG_ARN}"
EOF

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
echo "  - Gateway:   ${GATEWAY_TG_ARN}"
echo "  - Web:       ${WEB_TG_ARN}"
echo "  - WebSocket: ${WS_TG_ARN}"
echo ""
echo "Routing Rules:"
echo "  - /api/*  -> Gateway (port 4000)"
echo "  - /ws     -> WebSocket (port 4001)"
echo "  - /health -> Gateway (port 4000)"
echo "  - /*      -> Web App (port 3000) [default]"
echo ""
echo "Production-like Features:"
echo "  - Deletion protection: ${ALB_DELETION_PROTECTION}"
echo "  - Deregistration delay: 30s"
echo "  - WebSocket stickiness: Enabled"
if [[ -n "${HTTPS_LISTENER_ARN:-}" ]]; then
    echo "  - HTTPS: Enabled with TLS 1.3"
    echo "  - HTTP->HTTPS redirect: Enabled"
else
    echo "  - HTTPS: Not configured (need SSL certificate)"
fi
echo ""
echo "Access the application at: http://${ALB_DNS}"
echo ""
echo "To add HTTPS support:"
echo "  1. Request certificate: aws acm request-certificate --domain-name staging.campfire.dev"
echo "  2. Validate the certificate"
echo "  3. Update the listener with the certificate ARN"
echo ""
echo "Next step: ./08-create-iam-roles.sh"
echo "============================================================================="
