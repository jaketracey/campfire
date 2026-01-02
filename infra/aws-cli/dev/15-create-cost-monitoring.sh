#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create Cost Monitoring
# =============================================================================
# Creates AWS Budgets, SNS topics, and CloudWatch alarms for cost monitoring.
# Specifically tracks Bedrock and SageMaker costs.
#
# Usage: ./15-create-cost-monitoring.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "Creating cost monitoring for environment: ${ENVIRONMENT}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# -----------------------------------------------------------------------------
# Create SNS Topic for Cost Alerts
# -----------------------------------------------------------------------------
COST_ALERT_TOPIC_NAME="${RESOURCE_PREFIX}-cost-alerts"

log "Creating SNS topic for cost alerts: ${COST_ALERT_TOPIC_NAME}"

COST_ALERT_TOPIC_ARN=$(aws sns create-topic \
    --name "${COST_ALERT_TOPIC_NAME}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" \
    --query 'TopicArn' \
    --output text)

log "SNS topic created: ${COST_ALERT_TOPIC_ARN}"

# Set topic policy for AWS Budgets
cat > /tmp/sns-topic-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowBudgetsPublish",
            "Effect": "Allow",
            "Principal": {
                "Service": "budgets.amazonaws.com"
            },
            "Action": "sns:Publish",
            "Resource": "${COST_ALERT_TOPIC_ARN}"
        },
        {
            "Sid": "AllowCloudWatchPublish",
            "Effect": "Allow",
            "Principal": {
                "Service": "cloudwatch.amazonaws.com"
            },
            "Action": "sns:Publish",
            "Resource": "${COST_ALERT_TOPIC_ARN}"
        }
    ]
}
EOF

aws sns set-topic-attributes \
    --topic-arn "${COST_ALERT_TOPIC_ARN}" \
    --attribute-name Policy \
    --attribute-value file:///tmp/sns-topic-policy.json

log "SNS topic policy configured"

# -----------------------------------------------------------------------------
# Create AWS Budget for Bedrock
# -----------------------------------------------------------------------------
BEDROCK_BUDGET_NAME="${RESOURCE_PREFIX}-bedrock-budget"
BEDROCK_MONTHLY_BUDGET="${COST_ALERT_MONTHLY_THRESHOLD:-500}"

log "Creating monthly budget for Bedrock: \$${BEDROCK_MONTHLY_BUDGET}"

cat > /tmp/bedrock-budget.json << EOF
{
    "BudgetName": "${BEDROCK_BUDGET_NAME}",
    "BudgetLimit": {
        "Amount": "${BEDROCK_MONTHLY_BUDGET}",
        "Unit": "USD"
    },
    "CostFilters": {
        "Service": ["Amazon Bedrock"]
    },
    "CostTypes": {
        "IncludeTax": true,
        "IncludeSubscription": true,
        "UseBlended": false,
        "IncludeRefund": false,
        "IncludeCredit": false,
        "IncludeUpfront": true,
        "IncludeRecurring": true,
        "IncludeOtherSubscription": true,
        "IncludeSupport": true,
        "IncludeDiscount": true,
        "UseAmortized": false
    },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
}
EOF

cat > /tmp/bedrock-budget-notifications.json << EOF
[
    {
        "Notification": {
            "NotificationType": "ACTUAL",
            "ComparisonOperator": "GREATER_THAN",
            "Threshold": 50,
            "ThresholdType": "PERCENTAGE",
            "NotificationState": "ALARM"
        },
        "Subscribers": [
            {
                "SubscriptionType": "SNS",
                "Address": "${COST_ALERT_TOPIC_ARN}"
            }
        ]
    },
    {
        "Notification": {
            "NotificationType": "ACTUAL",
            "ComparisonOperator": "GREATER_THAN",
            "Threshold": 80,
            "ThresholdType": "PERCENTAGE",
            "NotificationState": "ALARM"
        },
        "Subscribers": [
            {
                "SubscriptionType": "SNS",
                "Address": "${COST_ALERT_TOPIC_ARN}"
            }
        ]
    },
    {
        "Notification": {
            "NotificationType": "ACTUAL",
            "ComparisonOperator": "GREATER_THAN",
            "Threshold": 100,
            "ThresholdType": "PERCENTAGE",
            "NotificationState": "ALARM"
        },
        "Subscribers": [
            {
                "SubscriptionType": "SNS",
                "Address": "${COST_ALERT_TOPIC_ARN}"
            }
        ]
    },
    {
        "Notification": {
            "NotificationType": "FORECASTED",
            "ComparisonOperator": "GREATER_THAN",
            "Threshold": 100,
            "ThresholdType": "PERCENTAGE",
            "NotificationState": "ALARM"
        },
        "Subscribers": [
            {
                "SubscriptionType": "SNS",
                "Address": "${COST_ALERT_TOPIC_ARN}"
            }
        ]
    }
]
EOF

# Delete existing budget if it exists (ignore errors)
aws budgets delete-budget \
    --account-id "${AWS_ACCOUNT_ID}" \
    --budget-name "${BEDROCK_BUDGET_NAME}" 2>/dev/null || true

aws budgets create-budget \
    --account-id "${AWS_ACCOUNT_ID}" \
    --budget file:///tmp/bedrock-budget.json \
    --notifications-with-subscribers file:///tmp/bedrock-budget-notifications.json

log "Bedrock budget created with alerts at 50%, 80%, 100%, and forecasted 100%"

# -----------------------------------------------------------------------------
# Create AWS Budget for Overall AI Costs (Bedrock + SageMaker)
# -----------------------------------------------------------------------------
AI_TOTAL_BUDGET_NAME="${RESOURCE_PREFIX}-ai-total-budget"
AI_TOTAL_MONTHLY_BUDGET=$((BEDROCK_MONTHLY_BUDGET * 2))  # Double for total AI spend

log "Creating total AI budget: \$${AI_TOTAL_MONTHLY_BUDGET}"

cat > /tmp/ai-total-budget.json << EOF
{
    "BudgetName": "${AI_TOTAL_BUDGET_NAME}",
    "BudgetLimit": {
        "Amount": "${AI_TOTAL_MONTHLY_BUDGET}",
        "Unit": "USD"
    },
    "CostFilters": {
        "Service": ["Amazon Bedrock", "Amazon SageMaker"]
    },
    "CostTypes": {
        "IncludeTax": true,
        "IncludeSubscription": true,
        "UseBlended": false,
        "IncludeRefund": false,
        "IncludeCredit": false,
        "IncludeUpfront": true,
        "IncludeRecurring": true,
        "IncludeOtherSubscription": true,
        "IncludeSupport": true,
        "IncludeDiscount": true,
        "UseAmortized": false
    },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
}
EOF

# Delete existing budget if it exists (ignore errors)
aws budgets delete-budget \
    --account-id "${AWS_ACCOUNT_ID}" \
    --budget-name "${AI_TOTAL_BUDGET_NAME}" 2>/dev/null || true

aws budgets create-budget \
    --account-id "${AWS_ACCOUNT_ID}" \
    --budget file:///tmp/ai-total-budget.json \
    --notifications-with-subscribers file:///tmp/bedrock-budget-notifications.json

log "Total AI budget created"

# -----------------------------------------------------------------------------
# Create Daily Budget Alert
# -----------------------------------------------------------------------------
DAILY_BUDGET_NAME="${RESOURCE_PREFIX}-ai-daily-budget"
DAILY_BUDGET_AMOUNT="${COST_ALERT_DAILY_THRESHOLD:-50}"

log "Creating daily AI budget: \$${DAILY_BUDGET_AMOUNT}"

cat > /tmp/daily-budget.json << EOF
{
    "BudgetName": "${DAILY_BUDGET_NAME}",
    "BudgetLimit": {
        "Amount": "${DAILY_BUDGET_AMOUNT}",
        "Unit": "USD"
    },
    "CostFilters": {
        "Service": ["Amazon Bedrock", "Amazon SageMaker"]
    },
    "CostTypes": {
        "IncludeTax": true,
        "IncludeSubscription": true,
        "UseBlended": false,
        "IncludeRefund": false,
        "IncludeCredit": false,
        "IncludeUpfront": true,
        "IncludeRecurring": true,
        "IncludeOtherSubscription": true,
        "IncludeSupport": true,
        "IncludeDiscount": true,
        "UseAmortized": false
    },
    "TimeUnit": "DAILY",
    "BudgetType": "COST"
}
EOF

cat > /tmp/daily-budget-notifications.json << EOF
[
    {
        "Notification": {
            "NotificationType": "ACTUAL",
            "ComparisonOperator": "GREATER_THAN",
            "Threshold": 100,
            "ThresholdType": "PERCENTAGE",
            "NotificationState": "ALARM"
        },
        "Subscribers": [
            {
                "SubscriptionType": "SNS",
                "Address": "${COST_ALERT_TOPIC_ARN}"
            }
        ]
    }
]
EOF

# Delete existing budget if it exists (ignore errors)
aws budgets delete-budget \
    --account-id "${AWS_ACCOUNT_ID}" \
    --budget-name "${DAILY_BUDGET_NAME}" 2>/dev/null || true

aws budgets create-budget \
    --account-id "${AWS_ACCOUNT_ID}" \
    --budget file:///tmp/daily-budget.json \
    --notifications-with-subscribers file:///tmp/daily-budget-notifications.json

log "Daily AI budget created"

# -----------------------------------------------------------------------------
# Activate Cost Allocation Tags
# -----------------------------------------------------------------------------
log "Activating cost allocation tags..."

# These tags will help track costs by user, companion, etc.
aws ce update-cost-allocation-tags-status \
    --cost-allocation-tags-status \
        TagKey=Project,Status=Active \
        TagKey=Environment,Status=Active \
        TagKey=Service,Status=Active 2>/dev/null || log "Cost allocation tags may already be active or require console activation"

log "Cost allocation tags activation requested"

# -----------------------------------------------------------------------------
# Clean up temp files
# -----------------------------------------------------------------------------
rm -f /tmp/sns-topic-policy.json /tmp/bedrock-budget.json /tmp/bedrock-budget-notifications.json \
      /tmp/ai-total-budget.json /tmp/daily-budget.json /tmp/daily-budget-notifications.json

# -----------------------------------------------------------------------------
# Save Cost Monitoring Configuration
# -----------------------------------------------------------------------------
cat >> "${SCRIPT_DIR}/vpc-outputs.env" << EOF

# Cost Monitoring - Generated by 15-create-cost-monitoring.sh
export COST_ALERT_TOPIC_NAME="${COST_ALERT_TOPIC_NAME}"
export COST_ALERT_TOPIC_ARN="${COST_ALERT_TOPIC_ARN}"
export BEDROCK_BUDGET_NAME="${BEDROCK_BUDGET_NAME}"
export BEDROCK_MONTHLY_BUDGET="${BEDROCK_MONTHLY_BUDGET}"
EOF

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "Cost Monitoring Created Successfully"
echo "============================================================================="
echo ""
echo "SNS Topic: ${COST_ALERT_TOPIC_NAME}"
echo "  ARN: ${COST_ALERT_TOPIC_ARN}"
echo ""
echo "Budgets Created:"
echo "  - ${BEDROCK_BUDGET_NAME}: \$${BEDROCK_MONTHLY_BUDGET}/month (Bedrock only)"
echo "  - ${AI_TOTAL_BUDGET_NAME}: \$${AI_TOTAL_MONTHLY_BUDGET}/month (Bedrock + SageMaker)"
echo "  - ${DAILY_BUDGET_NAME}: \$${DAILY_BUDGET_AMOUNT}/day (Bedrock + SageMaker)"
echo ""
echo "Alerts configured at:"
echo "  - 50% of budget (heads up)"
echo "  - 80% of budget (warning)"
echo "  - 100% of budget (limit reached)"
echo "  - Forecasted 100% (if trend continues)"
echo ""
echo "IMPORTANT: Subscribe to receive alerts!"
echo "  aws sns subscribe \\"
echo "    --topic-arn ${COST_ALERT_TOPIC_ARN} \\"
echo "    --protocol email \\"
echo "    --notification-endpoint your-email@example.com"
echo ""
echo "============================================================================="
