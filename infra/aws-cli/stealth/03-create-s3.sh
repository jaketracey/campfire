#!/bin/bash
# Create S3 bucket for media storage

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "Creating S3 bucket for stealth launch..."

# =============================================================================
# Create Media Bucket
# =============================================================================
if aws s3api head-bucket --bucket "$S3_MEDIA_BUCKET" 2>/dev/null; then
    log "S3 bucket already exists: ${S3_MEDIA_BUCKET}"
else
    log "Creating S3 bucket: ${S3_MEDIA_BUCKET}"

    # Create bucket (different command for us-east-1)
    if [[ "$AWS_REGION" == "us-east-1" ]]; then
        aws s3api create-bucket --bucket "$S3_MEDIA_BUCKET"
    else
        aws s3api create-bucket \
            --bucket "$S3_MEDIA_BUCKET" \
            --create-bucket-configuration LocationConstraint="$AWS_REGION"
    fi

    log "Created bucket: ${S3_MEDIA_BUCKET}"
fi

# =============================================================================
# Block Public Access (default secure)
# =============================================================================
log "Configuring public access block..."
aws s3api put-public-access-block \
    --bucket "$S3_MEDIA_BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# =============================================================================
# Enable Versioning (optional but recommended)
# =============================================================================
log "Enabling versioning..."
aws s3api put-bucket-versioning \
    --bucket "$S3_MEDIA_BUCKET" \
    --versioning-configuration Status=Enabled

# =============================================================================
# CORS Configuration (for presigned URLs)
# =============================================================================
log "Configuring CORS..."
aws s3api put-bucket-cors \
    --bucket "$S3_MEDIA_BUCKET" \
    --cors-configuration '{
        "CORSRules": [
            {
                "AllowedHeaders": ["*"],
                "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
                "AllowedOrigins": ["https://'"${DOMAIN}"'", "http://localhost:3000"],
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600
            }
        ]
    }'

# =============================================================================
# Lifecycle Policy (cost optimization)
# =============================================================================
log "Configuring lifecycle policy..."
aws s3api put-bucket-lifecycle-configuration \
    --bucket "$S3_MEDIA_BUCKET" \
    --lifecycle-configuration '{
        "Rules": [
            {
                "ID": "TransitionToIA",
                "Status": "Enabled",
                "Filter": {},
                "Transitions": [
                    {
                        "Days": 30,
                        "StorageClass": "STANDARD_IA"
                    }
                ]
            },
            {
                "ID": "DeleteOldVersions",
                "Status": "Enabled",
                "Filter": {},
                "NoncurrentVersionExpiration": {
                    "NoncurrentDays": 30
                }
            }
        ]
    }'

# =============================================================================
# Tags
# =============================================================================
log "Adding tags..."
aws s3api put-bucket-tagging \
    --bucket "$S3_MEDIA_BUCKET" \
    --tagging "TagSet=[{Key=Project,Value=${PROJECT_NAME}},{Key=Environment,Value=${ENV}}]"

# =============================================================================
# Summary
# =============================================================================
log ""
log "=========================================="
log "S3 Bucket Summary"
log "=========================================="
log "Bucket Name: ${S3_MEDIA_BUCKET}"
log "Region:      ${AWS_REGION}"
log "Versioning:  Enabled"
log "CORS:        Configured for ${DOMAIN}"
log "Lifecycle:   Transition to IA after 30 days"
log "=========================================="
log ""
log "Next: SSH into EC2 and run 04-setup-instance.sh"
