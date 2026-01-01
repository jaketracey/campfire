#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - SES Email Configuration (Dev)
# =============================================================================
# This script configures Amazon SES for development/testing:
# - Verifies sender email identity
# - Creates a configuration set for tracking
# - Creates SNS topics for bounce/complaint/delivery notifications
#
# Note: Dev environment uses SES sandbox mode by default
#
# Usage: ./12-create-ses.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

# -----------------------------------------------------------------------------
# SES Configuration (Dev - uses sandbox mode)
# -----------------------------------------------------------------------------
export SES_SENDER_EMAIL="${SES_SENDER_EMAIL:-noreply@campfire.app}"
export SES_SENDER_DOMAIN="${SES_SENDER_DOMAIN:-campfire.app}"
export SES_CONFIGURATION_SET="${RESOURCE_PREFIX}-email-tracking"
export SNS_BOUNCE_TOPIC="${RESOURCE_PREFIX}-email-bounces"
export SNS_COMPLAINT_TOPIC="${RESOURCE_PREFIX}-email-complaints"
export SNS_DELIVERY_TOPIC="${RESOURCE_PREFIX}-email-delivery"

log "=== Creating SES Email Configuration (Dev) ==="

check_aws_cli

# -----------------------------------------------------------------------------
# Step 1: Verify Email Identity
# -----------------------------------------------------------------------------
log "Step 1: Verifying email identity..."

EMAIL_STATUS=$(aws sesv2 get-email-identity \
    --email-identity "${SES_SENDER_EMAIL}" \
    --query 'VerifiedForSendingStatus' \
    --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "${EMAIL_STATUS}" == "true" ]]; then
    log "Email ${SES_SENDER_EMAIL} is already verified"
else
    log "Creating email identity for ${SES_SENDER_EMAIL}..."
    aws sesv2 create-email-identity \
        --email-identity "${SES_SENDER_EMAIL}" \
        --tags $(get_tags_cli) || true

    log "Verification email sent to ${SES_SENDER_EMAIL}"
    log "Please check your email and click the verification link"
fi

# -----------------------------------------------------------------------------
# Step 2: Create SNS Topics for Notifications
# -----------------------------------------------------------------------------
log "Step 2: Creating SNS topics for email notifications..."

# Bounce topic
BOUNCE_TOPIC_ARN=$(aws sns create-topic \
    --name "${SNS_BOUNCE_TOPIC}" \
    --tags $(get_tags_cli) \
    --query 'TopicArn' \
    --output text 2>/dev/null || \
    aws sns list-topics --query "Topics[?ends_with(TopicArn, ':${SNS_BOUNCE_TOPIC}')].TopicArn | [0]" --output text)

log "Bounce topic ARN: ${BOUNCE_TOPIC_ARN}"

# Complaint topic
COMPLAINT_TOPIC_ARN=$(aws sns create-topic \
    --name "${SNS_COMPLAINT_TOPIC}" \
    --tags $(get_tags_cli) \
    --query 'TopicArn' \
    --output text 2>/dev/null || \
    aws sns list-topics --query "Topics[?ends_with(TopicArn, ':${SNS_COMPLAINT_TOPIC}')].TopicArn | [0]" --output text)

log "Complaint topic ARN: ${COMPLAINT_TOPIC_ARN}"

# Delivery topic
DELIVERY_TOPIC_ARN=$(aws sns create-topic \
    --name "${SNS_DELIVERY_TOPIC}" \
    --tags $(get_tags_cli) \
    --query 'TopicArn' \
    --output text 2>/dev/null || \
    aws sns list-topics --query "Topics[?ends_with(TopicArn, ':${SNS_DELIVERY_TOPIC}')].TopicArn | [0]" --output text)

log "Delivery topic ARN: ${DELIVERY_TOPIC_ARN}"

# -----------------------------------------------------------------------------
# Step 3: Create Configuration Set
# -----------------------------------------------------------------------------
log "Step 3: Creating configuration set..."

CONFIG_SET_EXISTS=$(aws sesv2 get-configuration-set \
    --configuration-set-name "${SES_CONFIGURATION_SET}" \
    --query 'ConfigurationSetName' \
    --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "${CONFIG_SET_EXISTS}" != "NOT_FOUND" ]]; then
    log "Configuration set ${SES_CONFIGURATION_SET} already exists"
else
    aws sesv2 create-configuration-set \
        --configuration-set-name "${SES_CONFIGURATION_SET}" \
        --reputation-options ReputationMetricsEnabled=true \
        --sending-options SendingEnabled=true \
        --tags $(get_tags_cli)

    log "Configuration set ${SES_CONFIGURATION_SET} created"
fi

# -----------------------------------------------------------------------------
# Step 4: Create Event Destinations
# -----------------------------------------------------------------------------
log "Step 4: Creating event destinations..."

# SNS destination for bounces and complaints
log "Creating SNS event destination for bounces and complaints..."
aws sesv2 create-configuration-set-event-destination \
    --configuration-set-name "${SES_CONFIGURATION_SET}" \
    --event-destination-name "bounces-complaints-sns" \
    --event-destination '{
        "Enabled": true,
        "MatchingEventTypes": ["BOUNCE", "COMPLAINT"],
        "SnsDestination": {
            "TopicArn": "'"${BOUNCE_TOPIC_ARN}"'"
        }
    }' 2>/dev/null || log "Bounce/complaint destination already exists"

# SNS destination for delivery confirmations
log "Creating SNS event destination for delivery..."
aws sesv2 create-configuration-set-event-destination \
    --configuration-set-name "${SES_CONFIGURATION_SET}" \
    --event-destination-name "delivery-sns" \
    --event-destination '{
        "Enabled": true,
        "MatchingEventTypes": ["DELIVERY", "DELIVERY_DELAY"],
        "SnsDestination": {
            "TopicArn": "'"${DELIVERY_TOPIC_ARN}"'"
        }
    }' 2>/dev/null || log "Delivery destination already exists"

# CloudWatch destination for all events (for monitoring)
log "Creating CloudWatch event destination for monitoring..."
aws sesv2 create-configuration-set-event-destination \
    --configuration-set-name "${SES_CONFIGURATION_SET}" \
    --event-destination-name "cloudwatch-metrics" \
    --event-destination '{
        "Enabled": true,
        "MatchingEventTypes": ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "REJECT", "OPEN", "CLICK"],
        "CloudWatchDestination": {
            "DimensionConfigurations": [
                {
                    "DimensionName": "template",
                    "DimensionValueSource": "MESSAGE_TAG",
                    "DefaultDimensionValue": "unknown"
                },
                {
                    "DimensionName": "type",
                    "DimensionValueSource": "MESSAGE_TAG",
                    "DefaultDimensionValue": "unknown"
                }
            ]
        }
    }' 2>/dev/null || log "CloudWatch destination already exists"

# -----------------------------------------------------------------------------
# Output Configuration
# -----------------------------------------------------------------------------
echo ""
echo "=========================================="
echo "  SES CONFIGURATION COMPLETE (Dev)"
echo "=========================================="
echo ""
echo "Add these to your .env file:"
echo ""
echo "  # Amazon SES Email Configuration"
echo "  SES_SENDER_EMAIL=${SES_SENDER_EMAIL}"
echo "  SES_SENDER_NAME=Campfire"
echo "  SES_REPLY_TO_EMAIL=support@campfire.app"
echo "  SES_REGION=${AWS_REGION}"
echo "  SES_SANDBOX_MODE=true"
echo "  SES_MAX_SEND_RATE=1"
echo "  SES_CONFIGURATION_SET=${SES_CONFIGURATION_SET}"
echo "  SES_BOUNCE_TOPIC_ARN=${BOUNCE_TOPIC_ARN}"
echo "  SES_COMPLAINT_TOPIC_ARN=${COMPLAINT_TOPIC_ARN}"
echo ""
echo "IMPORTANT: Dev environment uses SES sandbox mode."
echo "You can only send to verified email addresses in sandbox mode."
echo ""
echo "To verify test recipient emails:"
echo "  aws sesv2 create-email-identity --email-identity recipient@example.com"
echo ""

log "=== SES Email Configuration Complete (Dev) ==="
