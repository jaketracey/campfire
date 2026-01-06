#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create CloudWatch Resources (Production)
# =============================================================================
# Creates CloudWatch log groups, dashboards, alarms, and SNS topics
# for production monitoring and alerting
#
# Usage: ./09-create-cloudwatch.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli
confirm_production

log "Creating CloudWatch resources for environment: ${ENVIRONMENT}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# -----------------------------------------------------------------------------
# Create SNS Topic for Alerts
# -----------------------------------------------------------------------------
log "Creating SNS topic for alerts"

SNS_TOPIC_NAME="${RESOURCE_PREFIX}-alerts"

SNS_TOPIC_ARN=$(aws sns create-topic \
    --name "${SNS_TOPIC_NAME}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" \
    --query 'TopicArn' \
    --output text)

log "SNS topic created: ${SNS_TOPIC_ARN}"

# Create SNS topic for critical alerts
SNS_CRITICAL_TOPIC_NAME="${RESOURCE_PREFIX}-critical-alerts"

SNS_CRITICAL_TOPIC_ARN=$(aws sns create-topic \
    --name "${SNS_CRITICAL_TOPIC_NAME}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Severity,Value=critical \
    --query 'TopicArn' \
    --output text)

log "Critical alerts SNS topic created: ${SNS_CRITICAL_TOPIC_ARN}"

echo ""
warn "IMPORTANT: Subscribe to SNS topics to receive alerts:"
echo "  aws sns subscribe --topic-arn ${SNS_TOPIC_ARN} --protocol email --notification-endpoint your-email@example.com"
echo "  aws sns subscribe --topic-arn ${SNS_CRITICAL_TOPIC_ARN} --protocol email --notification-endpoint oncall@example.com"
echo ""

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
            --tags Project="${TAG_PROJECT}",Environment="${TAG_ENVIRONMENT}",Service="${service}",CostCenter="${TAG_COST_CENTER}"

        log "Log group created: ${LOG_GROUP}"
    fi

    # Set retention policy (90 days for production)
    aws logs put-retention-policy \
        --log-group-name "${LOG_GROUP}" \
        --retention-in-days "${LOG_RETENTION_DAYS}"

    log "Retention set to ${LOG_RETENTION_DAYS} days for ${LOG_GROUP}"
done

# Create application log group
APP_LOG_GROUP="/ecs/${RESOURCE_PREFIX}/application"
aws logs create-log-group \
    --log-group-name "${APP_LOG_GROUP}" \
    --tags Project="${TAG_PROJECT}",Environment="${TAG_ENVIRONMENT}" \
    2>/dev/null || log "Application log group already exists"

aws logs put-retention-policy \
    --log-group-name "${APP_LOG_GROUP}" \
    --retention-in-days "${LOG_RETENTION_DAYS}"

# -----------------------------------------------------------------------------
# Create Metric Filters for Error Tracking
# -----------------------------------------------------------------------------
log "Creating metric filters for error tracking"

for service in "${SERVICES[@]}"; do
    LOG_GROUP="/ecs/${RESOURCE_PREFIX}/${service}"

    # Error count metric filter
    aws logs put-metric-filter \
        --log-group-name "${LOG_GROUP}" \
        --filter-name "${RESOURCE_PREFIX}-${service}-errors" \
        --filter-pattern "?ERROR ?Error ?error ?FATAL ?Fatal ?fatal" \
        --metric-transformations \
            metricName="${service}-ErrorCount",metricNamespace="Campfire/${ENVIRONMENT}",metricValue="1",defaultValue="0"

    # Latency metric filter (if applicable)
    aws logs put-metric-filter \
        --log-group-name "${LOG_GROUP}" \
        --filter-name "${RESOURCE_PREFIX}-${service}-latency" \
        --filter-pattern "[timestamp, requestId, latency, ...]" \
        --metric-transformations \
            metricName="${service}-Latency",metricNamespace="Campfire/${ENVIRONMENT}",metricValue="\$latency",defaultValue="0" \
        2>/dev/null || true

    log "Metric filters created for ${service}"
done

# -----------------------------------------------------------------------------
# Create CloudWatch Dashboard (Production)
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
                "markdown": "# Campfire Production Dashboard\n**Environment:** ${ENVIRONMENT} | **Region:** ${AWS_REGION} | **Last Updated:** \${NOW}"
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 1,
            "width": 8,
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
                        {"label": "Scale Out Threshold", "value": ${AUTOSCALING_TARGET_CPU}, "color": "#ff7f0e"}
                    ]
                }
            }
        },
        {
            "type": "metric",
            "x": 8,
            "y": 1,
            "width": 8,
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
                        {"label": "Scale Out Threshold", "value": ${AUTOSCALING_TARGET_MEMORY}, "color": "#ff7f0e"}
                    ]
                }
            }
        },
        {
            "type": "metric",
            "x": 16,
            "y": 1,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "Running Task Count",
                "metrics": [
                    ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", "${ECS_CLUSTER_NAME}", "ServiceName", "${RESOURCE_PREFIX}-gateway", {"label": "Gateway"}],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-orchestrator", {"label": "Orchestrator"}],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-web", {"label": "Web"}],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-workers", {"label": "Workers"}]
                ],
                "view": "timeSeries",
                "stacked": true,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Average"
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
                    ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "${ALB_ARN##*/}", {"label": "Total Requests", "stat": "Sum"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60
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
                    ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", "${ALB_ARN##*/}", {"label": "p50", "stat": "p50"}],
                    [".", ".", ".", ".", {"label": "p95", "stat": "p95"}],
                    [".", ".", ".", ".", {"label": "p99", "stat": "p99"}]
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
                "title": "HTTP Error Rates",
                "metrics": [
                    ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", "${ALB_ARN##*/}", {"label": "4XX Errors", "color": "#ff7f0e"}],
                    [".", "HTTPCode_Target_5XX_Count", ".", ".", {"label": "5XX Errors", "color": "#d62728"}]
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
                "title": "RDS CPU & Connections",
                "metrics": [
                    ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", "${RDS_INSTANCE_IDENTIFIER}", {"label": "CPU %"}],
                    [".", "DatabaseConnections", ".", ".", {"label": "Connections", "yAxis": "right"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Average",
                "yAxis": {
                    "left": {"min": 0, "max": 100},
                    "right": {"min": 0}
                }
            }
        },
        {
            "type": "metric",
            "x": 8,
            "y": 13,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "RDS Read/Write IOPS",
                "metrics": [
                    ["AWS/RDS", "ReadIOPS", "DBInstanceIdentifier", "${RDS_INSTANCE_IDENTIFIER}", {"label": "Read IOPS"}],
                    [".", "WriteIOPS", ".", ".", {"label": "Write IOPS"}]
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
            "x": 16,
            "y": 13,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "RDS Free Storage & Memory",
                "metrics": [
                    ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", "${RDS_INSTANCE_IDENTIFIER}", {"label": "Free Storage (GB)", "stat": "Average"}],
                    [".", "FreeableMemory", ".", ".", {"label": "Free Memory (GB)", "yAxis": "right"}]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 300
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 19,
            "width": 12,
            "height": 6,
            "properties": {
                "title": "Healthy Host Count",
                "metrics": [
                    ["AWS/ApplicationELB", "HealthyHostCount", "TargetGroup", "${GATEWAY_TG_ARN##*/}", "LoadBalancer", "${ALB_ARN##*/}", {"label": "Gateway"}],
                    [".", ".", ".", "${WEB_TG_ARN##*/}", ".", ".", {"label": "Web"}]
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
                "title": "Application Errors (from logs)",
                "metrics": [
                    ["Campfire/${ENVIRONMENT}", "gateway-ErrorCount", {"label": "Gateway Errors"}],
                    [".", "orchestrator-ErrorCount", {"label": "Orchestrator Errors"}],
                    [".", "web-ErrorCount", {"label": "Web Errors"}],
                    [".", "workers-ErrorCount", {"label": "Workers Errors"}]
                ],
                "view": "timeSeries",
                "stacked": true,
                "region": "${AWS_REGION}",
                "period": 60,
                "stat": "Sum"
            }
        },
        {
            "type": "log",
            "x": 0,
            "y": 25,
            "width": 24,
            "height": 6,
            "properties": {
                "title": "Recent Error Logs",
                "query": "SOURCE '/ecs/${RESOURCE_PREFIX}/gateway' | SOURCE '/ecs/${RESOURCE_PREFIX}/orchestrator' | SOURCE '/ecs/${RESOURCE_PREFIX}/web' | SOURCE '/ecs/${RESOURCE_PREFIX}/workers' | fields @timestamp, @message, @logStream | filter @message like /(?i)(error|exception|fatal|critical)/ | sort @timestamp desc | limit 100",
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
# Create CloudWatch Alarms (Production - with SNS notifications)
# -----------------------------------------------------------------------------
log "Creating CloudWatch alarms"

# High CPU Alarm for each service
for service in "gateway" "orchestrator" "web" "workers"; do
    ALARM_NAME="${RESOURCE_PREFIX}-${service}-high-cpu"

    aws cloudwatch put-metric-alarm \
        --alarm-name "${ALARM_NAME}" \
        --alarm-description "High CPU utilization for ${service} service in production" \
        --metric-name CPUUtilization \
        --namespace AWS/ECS \
        --statistic Average \
        --period 60 \
        --threshold 85 \
        --comparison-operator GreaterThanThreshold \
        --dimensions Name=ClusterName,Value="${ECS_CLUSTER_NAME}" Name=ServiceName,Value="${RESOURCE_PREFIX}-${service}" \
        --evaluation-periods 3 \
        --datapoints-to-alarm 2 \
        --treat-missing-data notBreaching \
        --alarm-actions "${SNS_TOPIC_ARN}" \
        --ok-actions "${SNS_TOPIC_ARN}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Alarm created: ${ALARM_NAME}"
done

# High Memory Alarm for each service
for service in "gateway" "orchestrator" "web" "workers"; do
    ALARM_NAME="${RESOURCE_PREFIX}-${service}-high-memory"

    aws cloudwatch put-metric-alarm \
        --alarm-name "${ALARM_NAME}" \
        --alarm-description "High memory utilization for ${service} service in production" \
        --metric-name MemoryUtilization \
        --namespace AWS/ECS \
        --statistic Average \
        --period 60 \
        --threshold 85 \
        --comparison-operator GreaterThanThreshold \
        --dimensions Name=ClusterName,Value="${ECS_CLUSTER_NAME}" Name=ServiceName,Value="${RESOURCE_PREFIX}-${service}" \
        --evaluation-periods 3 \
        --datapoints-to-alarm 2 \
        --treat-missing-data notBreaching \
        --alarm-actions "${SNS_TOPIC_ARN}" \
        --ok-actions "${SNS_TOPIC_ARN}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Alarm created: ${ALARM_NAME}"
done

# ALB 5xx Error Rate Alarm (Critical)
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-alb-5xx-errors-critical" \
    --alarm-description "Critical: High rate of 5xx errors from ALB in production" \
    --metric-name HTTPCode_Target_5XX_Count \
    --namespace AWS/ApplicationELB \
    --statistic Sum \
    --period 60 \
    --threshold 50 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 2 \
    --datapoints-to-alarm 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_CRITICAL_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Severity,Value=critical

log "Alarm created: ${RESOURCE_PREFIX}-alb-5xx-errors-critical"

# ALB High Latency Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-alb-high-latency" \
    --alarm-description "High response latency from ALB in production" \
    --metric-name TargetResponseTime \
    --namespace AWS/ApplicationELB \
    --extended-statistic p95 \
    --period 60 \
    --threshold 2.0 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 3 \
    --datapoints-to-alarm 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-alb-high-latency"

# ALB Unhealthy Host Alarm (Critical)
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-unhealthy-hosts-critical" \
    --alarm-description "Critical: Unhealthy hosts detected in production target group" \
    --metric-name UnHealthyHostCount \
    --namespace AWS/ApplicationELB \
    --statistic Maximum \
    --period 60 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --dimensions Name=TargetGroup,Value="${GATEWAY_TG_ARN##*/}" Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 2 \
    --datapoints-to-alarm 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_CRITICAL_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Severity,Value=critical

log "Alarm created: ${RESOURCE_PREFIX}-unhealthy-hosts-critical"

# RDS CPU Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-high-cpu" \
    --alarm-description "High CPU utilization on RDS production instance" \
    --metric-name CPUUtilization \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 3 \
    --datapoints-to-alarm 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-high-cpu"

# RDS Low Storage Alarm (Critical)
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-low-storage-critical" \
    --alarm-description "Critical: Low storage space on RDS production instance" \
    --metric-name FreeStorageSpace \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 10737418240 \
    --comparison-operator LessThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 2 \
    --datapoints-to-alarm 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_CRITICAL_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=Severity,Value=critical

log "Alarm created: ${RESOURCE_PREFIX}-rds-low-storage-critical"

# RDS High Connections Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-high-connections" \
    --alarm-description "High database connection count on RDS production instance" \
    --metric-name DatabaseConnections \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 100 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 3 \
    --datapoints-to-alarm 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-high-connections"

# Clean up temp files
rm -f /tmp/dashboard.json

# -----------------------------------------------------------------------------
# Save CloudWatch Configuration
# -----------------------------------------------------------------------------
cat >> "${SCRIPT_DIR}/vpc-outputs.env" << EOF

# CloudWatch Resources - Generated by 09-create-cloudwatch.sh
export SNS_TOPIC_ARN="${SNS_TOPIC_ARN}"
export SNS_CRITICAL_TOPIC_ARN="${SNS_CRITICAL_TOPIC_ARN}"
export DASHBOARD_NAME="${DASHBOARD_NAME}"
EOF

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "CloudWatch Resources Created Successfully (Production)"
echo "============================================================================="
echo "Log Groups (${LOG_RETENTION_DAYS} day retention):"
for service in "${SERVICES[@]}"; do
    echo "  - /ecs/${RESOURCE_PREFIX}/${service}"
done
echo ""
echo "SNS Topics (for alerting):"
echo "  - Standard Alerts: ${SNS_TOPIC_ARN}"
echo "  - Critical Alerts: ${SNS_CRITICAL_TOPIC_ARN}"
echo ""
echo "Dashboard: ${DASHBOARD_NAME}"
echo "  URL: https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${DASHBOARD_NAME}"
echo ""
echo "Alarms Created:"
echo "  Per-Service Alarms:"
echo "    - CPU utilization (threshold: 85%)"
echo "    - Memory utilization (threshold: 85%)"
echo ""
echo "  ALB Alarms:"
echo "    - 5xx error rate (threshold: 50/min) - CRITICAL"
echo "    - Response latency p95 (threshold: 2s)"
echo "    - Unhealthy hosts - CRITICAL"
echo ""
echo "  RDS Alarms:"
echo "    - CPU utilization (threshold: 80%)"
echo "    - Low storage (threshold: 10GB) - CRITICAL"
echo "    - High connections (threshold: 100)"
echo ""
echo "IMPORTANT: Subscribe to SNS topics to receive alerts:"
echo "  aws sns subscribe --topic-arn ${SNS_TOPIC_ARN} --protocol email --notification-endpoint your-email@example.com"
echo "  aws sns subscribe --topic-arn ${SNS_CRITICAL_TOPIC_ARN} --protocol email --notification-endpoint oncall@example.com"
echo ""
echo "Next step: ./10-deploy-services.sh"
echo "============================================================================="
