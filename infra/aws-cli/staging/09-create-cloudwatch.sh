#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create CloudWatch Log Groups (Staging)
# =============================================================================
# Creates CloudWatch log groups and comprehensive alarms for monitoring
# with production-like alerting thresholds
#
# Usage: ./09-create-cloudwatch.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli

log "Creating CloudWatch resources for environment: ${ENVIRONMENT}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# -----------------------------------------------------------------------------
# Create Log Groups
# -----------------------------------------------------------------------------
log "Creating CloudWatch log groups"

SERVICES=("gateway" "orchestrator" "web" "workers")

for service in "${SERVICES[@]}"; do
    LOG_GROUP="/ecs/${RESOURCE_PREFIX}/${service}"

    if aws logs describe-log-groups --log-group-name-prefix "${LOG_GROUP}" --query "logGroups[?logGroupName=='${LOG_GROUP}'].logGroupName" --output text | grep -q "${LOG_GROUP}"; then
        log "Log group ${LOG_GROUP} already exists"
    else
        aws logs create-log-group \
            --log-group-name "${LOG_GROUP}" \
            --tags Project="${TAG_PROJECT}",Environment="${TAG_ENVIRONMENT}",Service="${service}"

        log "Log group created: ${LOG_GROUP}"
    fi

    # Set retention policy (longer than dev)
    aws logs put-retention-policy \
        --log-group-name "${LOG_GROUP}" \
        --retention-in-days "${LOG_RETENTION_DAYS}"

    log "Retention set to ${LOG_RETENTION_DAYS} days for ${LOG_GROUP}"
done

# -----------------------------------------------------------------------------
# Create CloudWatch Dashboard
# -----------------------------------------------------------------------------
log "Creating CloudWatch dashboard"

DASHBOARD_NAME="${RESOURCE_PREFIX}-dashboard"

cat > /tmp/dashboard.json << EOF
{
    "widgets": [
        {
            "type": "text",
            "x": 0,
            "y": 0,
            "width": 24,
            "height": 1,
            "properties": {
                "markdown": "# Campfire Staging Environment Dashboard"
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 1,
            "width": 12,
            "height": 6,
            "properties": {
                "title": "ECS CPU Utilization",
                "metrics": [
                    ["AWS/ECS", "CPUUtilization", "ClusterName", "${ECS_CLUSTER_NAME}", "ServiceName", "${RESOURCE_PREFIX}-gateway", {"label": "Gateway"}],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-orchestrator", {"label": "Orchestrator"}],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-web", {"label": "Web"}],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-workers", {"label": "Workers"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Average",
                "annotations": {
                    "horizontal": [
                        {"value": 70, "label": "Scale-out threshold", "color": "#ff9900"},
                        {"value": 80, "label": "Alert threshold", "color": "#ff0000"}
                    ]
                }
            }
        },
        {
            "type": "metric",
            "x": 12,
            "y": 1,
            "width": 12,
            "height": 6,
            "properties": {
                "title": "ECS Memory Utilization",
                "metrics": [
                    ["AWS/ECS", "MemoryUtilization", "ClusterName", "${ECS_CLUSTER_NAME}", "ServiceName", "${RESOURCE_PREFIX}-gateway", {"label": "Gateway"}],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-orchestrator", {"label": "Orchestrator"}],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-web", {"label": "Web"}],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-workers", {"label": "Workers"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Average",
                "annotations": {
                    "horizontal": [
                        {"value": 70, "label": "Scale-out threshold", "color": "#ff9900"},
                        {"value": 80, "label": "Alert threshold", "color": "#ff0000"}
                    ]
                }
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 7,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "ALB Request Count",
                "metrics": [
                    ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "${ALB_ARN##*/}"]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Sum"
            }
        },
        {
            "type": "metric",
            "x": 8,
            "y": 7,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "ALB Response Time (p50, p95, p99)",
                "metrics": [
                    ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", "${ALB_ARN##*/}", {"stat": "p50", "label": "p50"}],
                    [".", ".", ".", ".", {"stat": "p95", "label": "p95"}],
                    [".", ".", ".", ".", {"stat": "p99", "label": "p99"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60
            }
        },
        {
            "type": "metric",
            "x": 16,
            "y": 7,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "Active Connections",
                "metrics": [
                    ["AWS/ApplicationELB", "ActiveConnectionCount", "LoadBalancer", "${ALB_ARN##*/}"]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Sum"
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 13,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "ALB HTTP 5xx Errors",
                "metrics": [
                    ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", "${ALB_ARN##*/}", {"color": "#ff0000"}],
                    [".", "HTTPCode_ELB_5XX_Count", ".", ".", {"color": "#ff9900"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Sum"
            }
        },
        {
            "type": "metric",
            "x": 8,
            "y": 13,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "ALB HTTP 4xx Errors",
                "metrics": [
                    ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", "${ALB_ARN##*/}"]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Sum"
            }
        },
        {
            "type": "metric",
            "x": 16,
            "y": 13,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "Healthy vs Unhealthy Hosts",
                "metrics": [
                    ["AWS/ApplicationELB", "HealthyHostCount", "TargetGroup", "${GATEWAY_TG_ARN##*/}", "LoadBalancer", "${ALB_ARN##*/}", {"label": "Gateway Healthy", "color": "#2ca02c"}],
                    [".", "UnHealthyHostCount", ".", ".", ".", ".", {"label": "Gateway Unhealthy", "color": "#ff0000"}],
                    [".", "HealthyHostCount", ".", "${WEB_TG_ARN##*/}", ".", ".", {"label": "Web Healthy", "color": "#1f77b4"}],
                    [".", "UnHealthyHostCount", ".", ".", ".", ".", {"label": "Web Unhealthy", "color": "#ff9900"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Average"
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 19,
            "width": 12,
            "height": 6,
            "properties": {
                "title": "RDS CPU & Connections",
                "metrics": [
                    ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", "${RDS_INSTANCE_IDENTIFIER}", {"label": "CPU %"}],
                    [".", "DatabaseConnections", ".", ".", {"label": "Connections", "yAxis": "right"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Average"
            }
        },
        {
            "type": "metric",
            "x": 12,
            "y": 19,
            "width": 12,
            "height": 6,
            "properties": {
                "title": "RDS Storage & IOPS",
                "metrics": [
                    ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", "${RDS_INSTANCE_IDENTIFIER}", {"label": "Free Storage (bytes)"}],
                    [".", "ReadIOPS", ".", ".", {"label": "Read IOPS", "yAxis": "right"}],
                    [".", "WriteIOPS", ".", ".", {"label": "Write IOPS", "yAxis": "right"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Average"
            }
        },
        {
            "type": "log",
            "x": 0,
            "y": 25,
            "width": 24,
            "height": 6,
            "properties": {
                "title": "Recent Error Logs (All Services)",
                "query": "SOURCE '/ecs/${RESOURCE_PREFIX}/gateway' | SOURCE '/ecs/${RESOURCE_PREFIX}/orchestrator' | SOURCE '/ecs/${RESOURCE_PREFIX}/web' | SOURCE '/ecs/${RESOURCE_PREFIX}/workers' | fields @timestamp, @message | filter @message like /error|Error|ERROR|exception|Exception|EXCEPTION|failed|Failed|FAILED/ | sort @timestamp desc | limit 100",
                "region": "${AWS_REGION}",
                "view": "table"
            }
        }
    ]
}
EOF

aws cloudwatch put-dashboard \
    --dashboard-name "${DASHBOARD_NAME}" \
    --dashboard-body file:///tmp/dashboard.json

log "Dashboard created: ${DASHBOARD_NAME}"

# -----------------------------------------------------------------------------
# Create CloudWatch Alarms (Production-like thresholds)
# -----------------------------------------------------------------------------
log "Creating CloudWatch alarms"

# High CPU Alarm for each service (stricter threshold than dev)
for service in "gateway" "orchestrator" "web" "workers"; do
    ALARM_NAME="${RESOURCE_PREFIX}-${service}-high-cpu"

    aws cloudwatch put-metric-alarm \
        --alarm-name "${ALARM_NAME}" \
        --alarm-description "High CPU utilization for ${service} service (staging)" \
        --metric-name CPUUtilization \
        --namespace AWS/ECS \
        --statistic Average \
        --period 60 \
        --threshold 75 \
        --comparison-operator GreaterThanThreshold \
        --dimensions Name=ClusterName,Value="${ECS_CLUSTER_NAME}" Name=ServiceName,Value="${RESOURCE_PREFIX}-${service}" \
        --evaluation-periods 3 \
        --datapoints-to-alarm 2 \
        --treat-missing-data notBreaching \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Alarm created: ${ALARM_NAME}"
done

# High Memory Alarm for each service
for service in "gateway" "orchestrator" "web" "workers"; do
    ALARM_NAME="${RESOURCE_PREFIX}-${service}-high-memory"

    aws cloudwatch put-metric-alarm \
        --alarm-name "${ALARM_NAME}" \
        --alarm-description "High memory utilization for ${service} service (staging)" \
        --metric-name MemoryUtilization \
        --namespace AWS/ECS \
        --statistic Average \
        --period 60 \
        --threshold 75 \
        --comparison-operator GreaterThanThreshold \
        --dimensions Name=ClusterName,Value="${ECS_CLUSTER_NAME}" Name=ServiceName,Value="${RESOURCE_PREFIX}-${service}" \
        --evaluation-periods 3 \
        --datapoints-to-alarm 2 \
        --treat-missing-data notBreaching \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Alarm created: ${ALARM_NAME}"
done

# ALB 5xx Error Rate Alarm (production-like sensitivity)
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-alb-5xx-errors" \
    --alarm-description "High rate of 5xx errors from ALB (staging)" \
    --metric-name HTTPCode_Target_5XX_Count \
    --namespace AWS/ApplicationELB \
    --statistic Sum \
    --period 60 \
    --threshold 5 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 3 \
    --datapoints-to-alarm 2 \
    --treat-missing-data notBreaching \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-alb-5xx-errors"

# ALB High Latency Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-alb-high-latency" \
    --alarm-description "High response latency (p95 > 2s)" \
    --metric-name TargetResponseTime \
    --namespace AWS/ApplicationELB \
    --extended-statistic p95 \
    --period 60 \
    --threshold 2 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 3 \
    --datapoints-to-alarm 2 \
    --treat-missing-data notBreaching \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-alb-high-latency"

# ALB Unhealthy Host Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-unhealthy-hosts-gateway" \
    --alarm-description "Unhealthy hosts detected in gateway target group" \
    --metric-name UnHealthyHostCount \
    --namespace AWS/ApplicationELB \
    --statistic Average \
    --period 60 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --dimensions Name=TargetGroup,Value="${GATEWAY_TG_ARN##*/}" Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-unhealthy-hosts-gateway"

aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-unhealthy-hosts-web" \
    --alarm-description "Unhealthy hosts detected in web target group" \
    --metric-name UnHealthyHostCount \
    --namespace AWS/ApplicationELB \
    --statistic Average \
    --period 60 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --dimensions Name=TargetGroup,Value="${WEB_TG_ARN##*/}" Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-unhealthy-hosts-web"

# RDS CPU Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-high-cpu" \
    --alarm-description "High RDS CPU utilization" \
    --metric-name CPUUtilization \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-high-cpu"

# RDS Low Storage Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-low-storage" \
    --alarm-description "RDS storage running low (< 10GB)" \
    --metric-name FreeStorageSpace \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 10737418240 \
    --comparison-operator LessThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-low-storage"

# RDS High Connections Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-high-connections" \
    --alarm-description "High number of database connections" \
    --metric-name DatabaseConnections \
    --namespace AWS/RDS \
    --statistic Average \
    --period 60 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 3 \
    --treat-missing-data notBreaching \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-high-connections"

# Clean up temp files
rm -f /tmp/dashboard.json

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "CloudWatch Resources Created Successfully"
echo "============================================================================="
echo "Log Groups (${LOG_RETENTION_DAYS} day retention):"
for service in "${SERVICES[@]}"; do
    echo "  - /ecs/${RESOURCE_PREFIX}/${service}"
done
echo ""
echo "Dashboard: ${DASHBOARD_NAME}"
echo "  URL: https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${DASHBOARD_NAME}"
echo ""
echo "Alarms Created:"
echo "  ECS:"
echo "    - CPU utilization alarms (75% threshold, per service)"
echo "    - Memory utilization alarms (75% threshold, per service)"
echo "  ALB:"
echo "    - 5xx error rate alarm (> 5 errors in 3 periods)"
echo "    - High latency alarm (p95 > 2s)"
echo "    - Unhealthy hosts alarms (gateway, web)"
echo "  RDS:"
echo "    - High CPU alarm (> 80%)"
echo "    - Low storage alarm (< 10GB)"
echo "    - High connections alarm (> 80)"
echo ""
echo "Production-like Features:"
echo "  - Stricter thresholds than dev"
echo "  - Multiple evaluation periods to reduce noise"
echo "  - Comprehensive dashboard with all key metrics"
echo ""
echo "NOTE: To receive alarm notifications, create an SNS topic and"
echo "subscribe to it with email/Slack/PagerDuty, then update alarms"
echo "with --alarm-actions parameter."
echo ""
echo "Next step: ./10-deploy-services.sh"
echo "============================================================================="
