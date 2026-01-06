#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create Application Load Balancer (Production)
# =============================================================================
# Creates ALB with HTTPS, WAF integration, and production-grade settings
#
# Usage: ./07-create-alb.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli
confirm_production

log "Creating Application Load Balancer for environment: ${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# Create Application Load Balancer
# -----------------------------------------------------------------------------
log "Creating ALB: ${ALB_NAME}"

ALB_ARN=$(aws elbv2 create-load-balancer \
    --name "${ALB_NAME}" \
    --subnets "${PUBLIC_SUBNET_1_ID}" "${PUBLIC_SUBNET_2_ID}" "${PUBLIC_SUBNET_3_ID}" \
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

ALB_ZONE_ID=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns "${ALB_ARN}" \
    --query 'LoadBalancers[0].CanonicalHostedZoneId' \
    --output text)

log "ALB created: ${ALB_ARN}"
log "ALB DNS: ${ALB_DNS}"

# Configure ALB attributes for production
aws elbv2 modify-load-balancer-attributes \
    --load-balancer-arn "${ALB_ARN}" \
    --attributes \
        Key=idle_timeout.timeout_seconds,Value="${ALB_IDLE_TIMEOUT}" \
        Key=routing.http2.enabled,Value="${ALB_ENABLE_HTTP2}" \
        Key=routing.http.drop_invalid_header_fields.enabled,Value=true \
        Key=routing.http.desync_mitigation_mode,Value=defensive \
        Key=access_logs.s3.enabled,Value=true \
        Key=access_logs.s3.bucket,Value="${S3_LOGS_BUCKET}" \
        Key=access_logs.s3.prefix,Value=alb-logs

log "ALB attributes configured for production"

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
    --protocol-version HTTP1 \
    --health-check-enabled \
    --health-check-protocol HTTP \
    --health-check-path "/health" \
    --health-check-interval-seconds 15 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --matcher HttpCode=200 \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Service,Value=gateway \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)

# Enable slow start for gateway
aws elbv2 modify-target-group-attributes \
    --target-group-arn "${GATEWAY_TG_ARN}" \
    --attributes \
        Key=slow_start.duration_seconds,Value=60 \
        Key=deregistration_delay.timeout_seconds,Value=30

log "Gateway target group created: ${GATEWAY_TG_ARN}"

# Web Target Group
WEB_TG_ARN=$(aws elbv2 create-target-group \
    --name "${RESOURCE_PREFIX}-web-tg" \
    --protocol HTTP \
    --port 3000 \
    --vpc-id "${VPC_ID}" \
    --target-type ip \
    --protocol-version HTTP1 \
    --health-check-enabled \
    --health-check-protocol HTTP \
    --health-check-path "/api/health" \
    --health-check-interval-seconds 15 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --matcher HttpCode=200 \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Service,Value=web \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)

aws elbv2 modify-target-group-attributes \
    --target-group-arn "${WEB_TG_ARN}" \
    --attributes \
        Key=slow_start.duration_seconds,Value=90 \
        Key=deregistration_delay.timeout_seconds,Value=30

log "Web target group created: ${WEB_TG_ARN}"

# WebSocket Target Group (for gateway WS)
WS_TG_ARN=$(aws elbv2 create-target-group \
    --name "${RESOURCE_PREFIX}-ws-tg" \
    --protocol HTTP \
    --port 4001 \
    --vpc-id "${VPC_ID}" \
    --target-type ip \
    --protocol-version HTTP1 \
    --health-check-enabled \
    --health-check-protocol HTTP \
    --health-check-path "/health" \
    --health-check-port "4000" \
    --health-check-interval-seconds 15 \
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
        Key=deregistration_delay.timeout_seconds,Value=60

log "WebSocket target group created: ${WS_TG_ARN}"

# -----------------------------------------------------------------------------
# Create HTTPS Listener (if SSL certificate is configured)
# -----------------------------------------------------------------------------
if check_ssl_certificate; then
    log "Creating HTTPS listener with SSL certificate"

    HTTPS_LISTENER_ARN=$(aws elbv2 create-listener \
        --load-balancer-arn "${ALB_ARN}" \
        --protocol HTTPS \
        --port 443 \
        --ssl-policy "${SSL_POLICY}" \
        --certificates CertificateArn="${ACM_CERTIFICATE_ARN}" \
        --default-actions Type=forward,TargetGroupArn="${WEB_TG_ARN}" \
        --query 'Listeners[0].ListenerArn' \
        --output text)

    log "HTTPS listener created: ${HTTPS_LISTENER_ARN}"

    # Create listener rules for HTTPS
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

    # Create HTTP listener with redirect to HTTPS
    log "Creating HTTP listener with redirect to HTTPS"

    HTTP_LISTENER_ARN=$(aws elbv2 create-listener \
        --load-balancer-arn "${ALB_ARN}" \
        --protocol HTTP \
        --port 80 \
        --default-actions Type=redirect,RedirectConfig='{Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' \
        --query 'Listeners[0].ListenerArn' \
        --output text)

    log "HTTP to HTTPS redirect configured"
else
    log "No SSL certificate configured, creating HTTP-only listener"

    # Create HTTP Listener (temporary for testing)
    HTTP_LISTENER_ARN=$(aws elbv2 create-listener \
        --load-balancer-arn "${ALB_ARN}" \
        --protocol HTTP \
        --port 80 \
        --default-actions Type=forward,TargetGroupArn="${WEB_TG_ARN}" \
        --query 'Listeners[0].ListenerArn' \
        --output text)

    log "HTTP listener created: ${HTTP_LISTENER_ARN}"

    # Create listener rules for HTTP
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

    warn "IMPORTANT: Configure ACM_CERTIFICATE_ARN and re-run to enable HTTPS"
fi

# -----------------------------------------------------------------------------
# Create WAF Web ACL (if enabled)
# -----------------------------------------------------------------------------
if [[ "${ALB_ENABLE_WAF}" == "true" ]]; then
    log "Creating WAF Web ACL for production security"

    WAF_ACL_NAME="${RESOURCE_PREFIX}-waf-acl"

    # Create WAF Web ACL with AWS managed rules
    WAF_ACL_ARN=$(aws wafv2 create-web-acl \
        --name "${WAF_ACL_NAME}" \
        --scope REGIONAL \
        --default-action Allow={} \
        --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName="${RESOURCE_PREFIX}-waf" \
        --rules '[
            {
                "Name": "AWSManagedRulesCommonRuleSet",
                "Priority": 1,
                "Statement": {
                    "ManagedRuleGroupStatement": {
                        "VendorName": "AWS",
                        "Name": "AWSManagedRulesCommonRuleSet"
                    }
                },
                "OverrideAction": {"None": {}},
                "VisibilityConfig": {
                    "SampledRequestsEnabled": true,
                    "CloudWatchMetricsEnabled": true,
                    "MetricName": "AWSManagedRulesCommonRuleSet"
                }
            },
            {
                "Name": "AWSManagedRulesKnownBadInputsRuleSet",
                "Priority": 2,
                "Statement": {
                    "ManagedRuleGroupStatement": {
                        "VendorName": "AWS",
                        "Name": "AWSManagedRulesKnownBadInputsRuleSet"
                    }
                },
                "OverrideAction": {"None": {}},
                "VisibilityConfig": {
                    "SampledRequestsEnabled": true,
                    "CloudWatchMetricsEnabled": true,
                    "MetricName": "AWSManagedRulesKnownBadInputsRuleSet"
                }
            },
            {
                "Name": "AWSManagedRulesSQLiRuleSet",
                "Priority": 3,
                "Statement": {
                    "ManagedRuleGroupStatement": {
                        "VendorName": "AWS",
                        "Name": "AWSManagedRulesSQLiRuleSet"
                    }
                },
                "OverrideAction": {"None": {}},
                "VisibilityConfig": {
                    "SampledRequestsEnabled": true,
                    "CloudWatchMetricsEnabled": true,
                    "MetricName": "AWSManagedRulesSQLiRuleSet"
                }
            },
            {
                "Name": "RateLimitRule",
                "Priority": 4,
                "Statement": {
                    "RateBasedStatement": {
                        "Limit": 2000,
                        "AggregateKeyType": "IP"
                    }
                },
                "Action": {"Block": {}},
                "VisibilityConfig": {
                    "SampledRequestsEnabled": true,
                    "CloudWatchMetricsEnabled": true,
                    "MetricName": "RateLimitRule"
                }
            }
        ]' \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" \
        --query 'Summary.ARN' \
        --output text 2>/dev/null || echo "")

    if [[ -n "${WAF_ACL_ARN}" ]]; then
        # Associate WAF with ALB
        aws wafv2 associate-web-acl \
            --web-acl-arn "${WAF_ACL_ARN}" \
            --resource-arn "${ALB_ARN}"

        log "WAF Web ACL associated with ALB: ${WAF_ACL_ARN}"
    else
        warn "WAF Web ACL creation failed or already exists"
        WAF_ACL_ARN=""
    fi
else
    WAF_ACL_ARN=""
    log "WAF not enabled (set ALB_ENABLE_WAF=true to enable)"
fi

# -----------------------------------------------------------------------------
# Save ALB Configuration
# -----------------------------------------------------------------------------
cat >> "${SCRIPT_DIR}/vpc-outputs.env" << EOF

# ALB Resources - Generated by 07-create-alb.sh
export ALB_ARN="${ALB_ARN}"
export ALB_DNS="${ALB_DNS}"
export ALB_ZONE_ID="${ALB_ZONE_ID}"
export HTTP_LISTENER_ARN="${HTTP_LISTENER_ARN}"
export HTTPS_LISTENER_ARN="${HTTPS_LISTENER_ARN:-}"
export GATEWAY_TG_ARN="${GATEWAY_TG_ARN}"
export WEB_TG_ARN="${WEB_TG_ARN}"
export WS_TG_ARN="${WS_TG_ARN}"
export WAF_ACL_ARN="${WAF_ACL_ARN:-}"
EOF

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "Application Load Balancer Created Successfully (Production)"
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
echo "Production Features:"
echo "  - Access logs enabled (S3: ${S3_LOGS_BUCKET})"
echo "  - HTTP/2 enabled"
echo "  - Invalid header fields dropped"
echo "  - Desync mitigation: defensive"
echo "  - Slow start enabled for target groups"
echo ""
if [[ -n "${HTTPS_LISTENER_ARN:-}" ]]; then
    echo "SSL/TLS:"
    echo "  - HTTPS enabled on port 443"
    echo "  - SSL Policy: ${SSL_POLICY}"
    echo "  - HTTP -> HTTPS redirect enabled"
    echo ""
fi
if [[ -n "${WAF_ACL_ARN:-}" ]]; then
    echo "WAF Protection:"
    echo "  - AWS Managed Rules: Common, Known Bad Inputs, SQLi"
    echo "  - Rate limiting: 2000 requests/5min per IP"
    echo ""
fi
echo "Access the application at:"
if [[ -n "${HTTPS_LISTENER_ARN:-}" ]]; then
    echo "  https://${ALB_DNS}"
else
    echo "  http://${ALB_DNS} (HTTPS not configured)"
fi
echo ""
if [[ -z "${HTTPS_LISTENER_ARN:-}" ]]; then
    echo "IMPORTANT: Configure SSL for production:"
    echo "  1. Request/import certificate in ACM"
    echo "  2. Set ACM_CERTIFICATE_ARN environment variable"
    echo "  3. Re-run this script"
    echo ""
fi
echo "Next step: ./08-create-iam-roles.sh"
echo "============================================================================="
