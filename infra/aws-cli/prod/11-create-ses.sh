#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - SES Email Configuration
# =============================================================================
# This script configures Amazon SES for transactional and marketing emails:
# - Verifies sender email identity
# - Creates a configuration set for tracking
# - Creates SNS topics for bounce/complaint/delivery notifications
# - Sets up event destinations for tracking opens, clicks, bounces, complaints
#
# Usage: ./11-create-ses.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

# -----------------------------------------------------------------------------
# SES Configuration
# -----------------------------------------------------------------------------
export SES_SENDER_EMAIL="${SES_SENDER_EMAIL:-noreply@campfire.app}"
export SES_SENDER_DOMAIN="${SES_SENDER_DOMAIN:-campfire.app}"
export SES_CONFIGURATION_SET="${RESOURCE_PREFIX}-email-tracking"
export SNS_BOUNCE_TOPIC="${RESOURCE_PREFIX}-email-bounces"
export SNS_COMPLAINT_TOPIC="${RESOURCE_PREFIX}-email-complaints"
export SNS_DELIVERY_TOPIC="${RESOURCE_PREFIX}-email-delivery"

log "=== Creating SES Email Configuration ==="

check_aws_cli
confirm_production

# -----------------------------------------------------------------------------
# Step 1: Verify Email Identity
# -----------------------------------------------------------------------------
log "Step 1: Verifying email identity..."

# Check if email is already verified
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
# Step 2: Verify Domain Identity (for production sending)
# -----------------------------------------------------------------------------
log "Step 2: Verifying domain identity..."

DOMAIN_STATUS=$(aws sesv2 get-email-identity \
    --email-identity "${SES_SENDER_DOMAIN}" \
    --query 'VerifiedForSendingStatus' \
    --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "${DOMAIN_STATUS}" == "true" ]]; then
    log "Domain ${SES_SENDER_DOMAIN} is already verified"
else
    log "Creating domain identity for ${SES_SENDER_DOMAIN}..."
    aws sesv2 create-email-identity \
        --email-identity "${SES_SENDER_DOMAIN}" \
        --tags $(get_tags_cli) || true

    # Get DKIM tokens for DNS configuration
    log "Getting DKIM tokens for DNS configuration..."
    DKIM_TOKENS=$(aws sesv2 get-email-identity \
        --email-identity "${SES_SENDER_DOMAIN}" \
        --query 'DkimAttributes.Tokens' \
        --output json 2>/dev/null || echo "[]")

    echo ""
    echo "=========================================="
    echo "  DNS CONFIGURATION REQUIRED"
    echo "=========================================="
    echo ""
    echo "Add the following CNAME records to your DNS:"
    echo ""

    if [[ "${DKIM_TOKENS}" != "[]" ]]; then
        for token in $(echo "${DKIM_TOKENS}" | jq -r '.[]'); do
            echo "  Name:  ${token}._domainkey.${SES_SENDER_DOMAIN}"
            echo "  Value: ${token}.dkim.amazonses.com"
            echo ""
        done
    fi

    echo "After adding DNS records, verification may take up to 72 hours."
    echo ""
fi

# -----------------------------------------------------------------------------
# Step 3: Create SNS Topics for Notifications
# -----------------------------------------------------------------------------
log "Step 3: Creating SNS topics for email notifications..."

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
# Step 4: Create Configuration Set
# -----------------------------------------------------------------------------
log "Step 4: Creating configuration set..."

CONFIG_SET_EXISTS=$(aws sesv2 get-configuration-set \
    --configuration-set-name "${SES_CONFIGURATION_SET}" \
    --query 'ConfigurationSetName' \
    --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "${CONFIG_SET_EXISTS}" != "NOT_FOUND" ]]; then
    log "Configuration set ${SES_CONFIGURATION_SET} already exists"
else
    aws sesv2 create-configuration-set \
        --configuration-set-name "${SES_CONFIGURATION_SET}" \
        --tracking-options CustomRedirectDomain="${SES_SENDER_DOMAIN}" \
        --reputation-options ReputationMetricsEnabled=true \
        --sending-options SendingEnabled=true \
        --tags $(get_tags_cli)

    log "Configuration set ${SES_CONFIGURATION_SET} created"
fi

# -----------------------------------------------------------------------------
# Step 5: Create Event Destinations
# -----------------------------------------------------------------------------
log "Step 5: Creating event destinations..."

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
# Step 6: Set up HTTPS endpoint subscription for SNS (webhook)
# -----------------------------------------------------------------------------
log "Step 6: Setting up webhook subscriptions..."

# Get the gateway URL for webhooks
WEBHOOK_URL="${API_DOMAIN_NAME:-https://api.campfire.app}/webhooks/email/sns"

log "Webhook URL: ${WEBHOOK_URL}"
log ""
log "To complete webhook setup, subscribe the SNS topics to your endpoint:"
echo ""
echo "  # Bounce/Complaint notifications:"
echo "  aws sns subscribe \\"
echo "      --topic-arn ${BOUNCE_TOPIC_ARN} \\"
echo "      --protocol https \\"
echo "      --notification-endpoint ${WEBHOOK_URL}"
echo ""
echo "  # Delivery notifications:"
echo "  aws sns subscribe \\"
echo "      --topic-arn ${DELIVERY_TOPIC_ARN} \\"
echo "      --protocol https \\"
echo "      --notification-endpoint ${WEBHOOK_URL}"
echo ""

# -----------------------------------------------------------------------------
# Step 7: Enable open and click tracking
# -----------------------------------------------------------------------------
log "Step 7: Enabling open and click tracking..."

aws sesv2 put-configuration-set-tracking-options \
    --configuration-set-name "${SES_CONFIGURATION_SET}" \
    --custom-redirect-domain "${SES_SENDER_DOMAIN}" 2>/dev/null || true

log "Open and click tracking enabled"

# -----------------------------------------------------------------------------
# Output Configuration
# -----------------------------------------------------------------------------
echo ""
echo "=========================================="
echo "  SES CONFIGURATION COMPLETE"
echo "=========================================="
echo ""
echo "Add these to your .env file:"
echo ""
echo "  # Amazon SES Email Configuration"
echo "  SES_SENDER_EMAIL=${SES_SENDER_EMAIL}"
echo "  SES_SENDER_NAME=Campfire"
echo "  SES_REPLY_TO_EMAIL=support@campfire.app"
echo "  SES_REGION=${AWS_REGION}"
echo "  SES_SANDBOX_MODE=false"
echo "  SES_MAX_SEND_RATE=14"
echo "  SES_CONFIGURATION_SET=${SES_CONFIGURATION_SET}"
echo "  SES_BOUNCE_TOPIC_ARN=${BOUNCE_TOPIC_ARN}"
echo "  SES_COMPLAINT_TOPIC_ARN=${COMPLAINT_TOPIC_ARN}"
echo ""
echo "Next steps:"
echo "  1. Verify the sender email by clicking the link sent to ${SES_SENDER_EMAIL}"
echo "  2. Add DKIM DNS records for domain verification"
echo "  3. Request production access if still in sandbox mode:"
echo "     aws sesv2 put-account-details --production-access-enabled"
echo "  4. Subscribe SNS topics to your webhook endpoint (commands above)"
echo ""

log "=== SES Email Configuration Complete ==="
