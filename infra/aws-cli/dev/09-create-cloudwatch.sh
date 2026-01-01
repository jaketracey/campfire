#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create CloudWatch Log Groups
# =============================================================================
# Creates CloudWatch log groups, alarms, dashboard, and SNS topic for monitoring
#
# Usage: ./09-create-cloudwatch.sh
#
# This script is idempotent - running it multiple times will not create
# duplicate resources. Existing resources will be detected and reused.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli

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
    --output text 2>/dev/null || \
    aws sns list-topics --query "Topics[?contains(TopicArn, '${SNS_TOPIC_NAME}')].TopicArn" --output text)

log "SNS topic ready: ${SNS_TOPIC_ARN}"

# -----------------------------------------------------------------------------
# Create Log Groups
# -----------------------------------------------------------------------------
log "Creating CloudWatch log groups"

SERVICES=("gateway" "orchestrator" "web" "marketing" "workers")

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

    # Set retention policy
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
            "type": "metric",
            "x": 0,
            "y": 0,
            "width": 12,
            "height": 6,
            "properties": {
                "title": "ECS CPU Utilization",
                "metrics": [
                    ["AWS/ECS", "CPUUtilization", "ClusterName", "${ECS_CLUSTER_NAME}", "ServiceName", "${RESOURCE_PREFIX}-gateway"],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-orchestrator"],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-web"],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-workers"]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 300,
                "stat": "Average"
            }
        },
        {
            "type": "metric",
            "x": 12,
            "y": 0,
            "width": 12,
            "height": 6,
            "properties": {
                "title": "ECS Memory Utilization",
                "metrics": [
                    ["AWS/ECS", "MemoryUtilization", "ClusterName", "${ECS_CLUSTER_NAME}", "ServiceName", "${RESOURCE_PREFIX}-gateway"],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-orchestrator"],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-web"],
                    [".", ".", ".", ".", ".", "${RESOURCE_PREFIX}-workers"]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${AWS_REGION}",
                "period": 300,
                "stat": "Average"
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 6,
            "width": 12,
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
            "x": 12,
            "y": 6,
            "width": 12,
            "height": 6,
            "properties": {
                "title": "ALB Response Time",
                "metrics": [
                    ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", "${ALB_ARN##*/}"]
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
            "y": 12,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "ALB HTTP 5xx Errors",
                "metrics": [
                    ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", "${ALB_ARN##*/}"]
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
            "y": 12,
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
            "y": 12,
            "width": 8,
            "height": 6,
            "properties": {
                "title": "Healthy Host Count",
                "metrics": [
                    ["AWS/ApplicationELB", "HealthyHostCount", "TargetGroup", "${GATEWAY_TG_ARN##*/}", "LoadBalancer", "${ALB_ARN##*/}"],
                    [".", ".", ".", "${WEB_TG_ARN##*/}", ".", "."]
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
            "y": 18,
            "width": 24,
            "height": 6,
            "properties": {
                "title": "Recent Error Logs",
                "query": "SOURCE '/ecs/${RESOURCE_PREFIX}/gateway' | SOURCE '/ecs/${RESOURCE_PREFIX}/orchestrator' | SOURCE '/ecs/${RESOURCE_PREFIX}/web' | fields @timestamp, @message | filter @message like /error|Error|ERROR/ | sort @timestamp desc | limit 50",
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
# Create CloudWatch Alarms
# -----------------------------------------------------------------------------
log "Creating CloudWatch alarms"

# High CPU Alarm for each service
for service in "gateway" "orchestrator" "web" "workers"; do
    ALARM_NAME="${RESOURCE_PREFIX}-${service}-high-cpu"

    aws cloudwatch put-metric-alarm \
        --alarm-name "${ALARM_NAME}" \
        --alarm-description "High CPU utilization for ${service} service" \
        --metric-name CPUUtilization \
        --namespace AWS/ECS \
        --statistic Average \
        --period 300 \
        --threshold 80 \
        --comparison-operator GreaterThanThreshold \
        --dimensions Name=ClusterName,Value="${ECS_CLUSTER_NAME}" Name=ServiceName,Value="${RESOURCE_PREFIX}-${service}" \
        --evaluation-periods 2 \
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
        --alarm-description "High memory utilization for ${service} service" \
        --metric-name MemoryUtilization \
        --namespace AWS/ECS \
        --statistic Average \
        --period 300 \
        --threshold 80 \
        --comparison-operator GreaterThanThreshold \
        --dimensions Name=ClusterName,Value="${ECS_CLUSTER_NAME}" Name=ServiceName,Value="${RESOURCE_PREFIX}-${service}" \
        --evaluation-periods 2 \
        --treat-missing-data notBreaching \
        --alarm-actions "${SNS_TOPIC_ARN}" \
        --ok-actions "${SNS_TOPIC_ARN}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Alarm created: ${ALARM_NAME}"
done

# ALB 5xx Error Rate Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-alb-5xx-errors" \
    --alarm-description "High rate of 5xx errors from ALB" \
    --metric-name HTTPCode_Target_5XX_Count \
    --namespace AWS/ApplicationELB \
    --statistic Sum \
    --period 60 \
    --threshold 10 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 3 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-alb-5xx-errors"

# ALB Unhealthy Host Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-unhealthy-hosts" \
    --alarm-description "Unhealthy hosts detected in target group" \
    --metric-name UnHealthyHostCount \
    --namespace AWS/ApplicationELB \
    --statistic Average \
    --period 60 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --dimensions Name=TargetGroup,Value="${GATEWAY_TG_ARN##*/}" Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-unhealthy-hosts"

# ALB High Latency Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-alb-high-latency" \
    --alarm-description "High response time from ALB targets" \
    --metric-name TargetResponseTime \
    --namespace AWS/ApplicationELB \
    --statistic Average \
    --period 60 \
    --threshold 2 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=LoadBalancer,Value="${ALB_ARN##*/}" \
    --evaluation-periods 3 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-alb-high-latency"

# -----------------------------------------------------------------------------
# RDS Alarms
# -----------------------------------------------------------------------------
log "Creating RDS alarms"

# RDS High CPU Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-high-cpu" \
    --alarm-description "High CPU utilization on RDS instance" \
    --metric-name CPUUtilization \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-high-cpu"

# RDS Low Storage Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-low-storage" \
    --alarm-description "Low free storage space on RDS instance" \
    --metric-name FreeStorageSpace \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 5368709120 \
    --comparison-operator LessThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 1 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-low-storage (threshold: 5GB)"

# RDS High Connection Count Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-high-connections" \
    --alarm-description "High database connection count" \
    --metric-name DatabaseConnections \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 100 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-high-connections"

# RDS Low Freeable Memory Alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-low-memory" \
    --alarm-description "Low freeable memory on RDS instance" \
    --metric-name FreeableMemory \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 268435456 \
    --comparison-operator LessThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-low-memory (threshold: 256MB)"

# RDS Read/Write Latency Alarms
aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-high-read-latency" \
    --alarm-description "High read latency on RDS instance" \
    --metric-name ReadLatency \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 0.02 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-high-read-latency"

aws cloudwatch put-metric-alarm \
    --alarm-name "${RESOURCE_PREFIX}-rds-high-write-latency" \
    --alarm-description "High write latency on RDS instance" \
    --metric-name WriteLatency \
    --namespace AWS/RDS \
    --statistic Average \
    --period 300 \
    --threshold 0.02 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=DBInstanceIdentifier,Value="${RDS_INSTANCE_IDENTIFIER}" \
    --evaluation-periods 2 \
    --treat-missing-data notBreaching \
    --alarm-actions "${SNS_TOPIC_ARN}" \
    --ok-actions "${SNS_TOPIC_ARN}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "Alarm created: ${RESOURCE_PREFIX}-rds-high-write-latency"

# Clean up temp files
rm -f /tmp/dashboard.json

# -----------------------------------------------------------------------------
# Save CloudWatch Configuration
# -----------------------------------------------------------------------------
if ! grep -q "^export SNS_TOPIC_ARN=" "${SCRIPT_DIR}/vpc-outputs.env" 2>/dev/null; then
    cat >> "${SCRIPT_DIR}/vpc-outputs.env" << EOF

# CloudWatch Resources - Generated by 09-create-cloudwatch.sh
export SNS_TOPIC_ARN="${SNS_TOPIC_ARN}"
export DASHBOARD_NAME="${DASHBOARD_NAME}"
EOF
    log "CloudWatch configuration saved to vpc-outputs.env"
fi

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
echo "SNS Topic: ${SNS_TOPIC_ARN}"
echo ""
echo "Dashboard: ${DASHBOARD_NAME}"
echo "  URL: https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${DASHBOARD_NAME}"
echo ""
echo "ECS Alarms:"
echo "  - CPU utilization alarms (per service)"
echo "  - Memory utilization alarms (per service)"
echo ""
echo "ALB Alarms:"
echo "  - 5xx error rate alarm"
echo "  - Unhealthy hosts alarm"
echo "  - High latency alarm"
echo ""
echo "RDS Alarms:"
echo "  - High CPU utilization"
echo "  - Low free storage space (5GB threshold)"
echo "  - High connection count"
echo "  - Low freeable memory (256MB threshold)"
echo "  - High read/write latency"
echo ""
echo "IMPORTANT: To receive alarm notifications, subscribe to the SNS topic:"
echo "  aws sns subscribe --topic-arn ${SNS_TOPIC_ARN} --protocol email --notification-endpoint your@email.com"
echo ""
echo "Next step: ./10-deploy-services.sh"
echo "============================================================================="
