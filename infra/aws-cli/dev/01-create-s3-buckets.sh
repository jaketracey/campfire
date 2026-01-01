#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create S3 Buckets
# =============================================================================
# Creates S3 buckets for media storage and vault (encrypted user data)
#
# Usage: ./01-create-s3-buckets.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "Creating S3 buckets for environment: ${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# Create Media Bucket
# -----------------------------------------------------------------------------
log "Creating media bucket: ${S3_MEDIA_BUCKET}"

# Check if bucket already exists
if aws s3api head-bucket --bucket "${S3_MEDIA_BUCKET}" 2>/dev/null; then
    log "Media bucket already exists, skipping creation"
else
    # Create bucket (LocationConstraint not needed for us-east-1)
    if [[ "${AWS_REGION}" == "us-east-1" ]]; then
        aws s3api create-bucket \
            --bucket "${S3_MEDIA_BUCKET}" \
            --region "${AWS_REGION}"
    else
        aws s3api create-bucket \
            --bucket "${S3_MEDIA_BUCKET}" \
            --region "${AWS_REGION}" \
            --create-bucket-configuration LocationConstraint="${AWS_REGION}"
    fi

    log "Media bucket created successfully"
fi

# Enable versioning on media bucket
aws s3api put-bucket-versioning \
    --bucket "${S3_MEDIA_BUCKET}" \
    --versioning-configuration Status=Enabled

# Block public access
aws s3api put-public-access-block \
    --bucket "${S3_MEDIA_BUCKET}" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Add lifecycle policy for cost optimization
aws s3api put-bucket-lifecycle-configuration \
    --bucket "${S3_MEDIA_BUCKET}" \
    --lifecycle-configuration '{
        "Rules": [
            {
                "ID": "TransitionToInfrequentAccess",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "Transitions": [
                    {
                        "Days": 90,
                        "StorageClass": "STANDARD_IA"
                    }
                ]
            },
            {
                "ID": "DeleteOldVersions",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "NoncurrentVersionExpiration": {
                    "NoncurrentDays": 30
                }
            }
        ]
    }'

# Add CORS configuration for web uploads
aws s3api put-bucket-cors \
    --bucket "${S3_MEDIA_BUCKET}" \
    --cors-configuration '{
        "CORSRules": [
            {
                "AllowedOrigins": ["*"],
                "AllowedMethods": ["GET", "PUT", "POST"],
                "AllowedHeaders": ["*"],
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600
            }
        ]
    }'

# Tag the bucket
aws s3api put-bucket-tagging \
    --bucket "${S3_MEDIA_BUCKET}" \
    --tagging "TagSet=[{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Purpose,Value=media-storage}]"

log "Media bucket configuration complete"

# -----------------------------------------------------------------------------
# Create Vault Bucket (Encrypted)
# -----------------------------------------------------------------------------
log "Creating vault bucket: ${S3_VAULT_BUCKET}"

if aws s3api head-bucket --bucket "${S3_VAULT_BUCKET}" 2>/dev/null; then
    log "Vault bucket already exists, skipping creation"
else
    if [[ "${AWS_REGION}" == "us-east-1" ]]; then
        aws s3api create-bucket \
            --bucket "${S3_VAULT_BUCKET}" \
            --region "${AWS_REGION}"
    else
        aws s3api create-bucket \
            --bucket "${S3_VAULT_BUCKET}" \
            --region "${AWS_REGION}" \
            --create-bucket-configuration LocationConstraint="${AWS_REGION}"
    fi

    log "Vault bucket created successfully"
fi

# Enable versioning
aws s3api put-bucket-versioning \
    --bucket "${S3_VAULT_BUCKET}" \
    --versioning-configuration Status=Enabled

# Block public access (critical for vault)
aws s3api put-public-access-block \
    --bucket "${S3_VAULT_BUCKET}" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable server-side encryption with AWS managed keys
aws s3api put-bucket-encryption \
    --bucket "${S3_VAULT_BUCKET}" \
    --server-side-encryption-configuration '{
        "Rules": [
            {
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "aws:kms"
                },
                "BucketKeyEnabled": true
            }
        ]
    }'

# Add lifecycle policy
aws s3api put-bucket-lifecycle-configuration \
    --bucket "${S3_VAULT_BUCKET}" \
    --lifecycle-configuration '{
        "Rules": [
            {
                "ID": "TransitionToInfrequentAccess",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "Transitions": [
                    {
                        "Days": 30,
                        "StorageClass": "STANDARD_IA"
                    }
                ]
            },
            {
                "ID": "RetainVersions",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "NoncurrentVersionExpiration": {
                    "NoncurrentDays": 90
                }
            }
        ]
    }'

# Tag the bucket
aws s3api put-bucket-tagging \
    --bucket "${S3_VAULT_BUCKET}" \
    --tagging "TagSet=[{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Purpose,Value=vault-storage},{Key=Encryption,Value=aws-kms}]"

log "Vault bucket configuration complete"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "S3 Buckets Created Successfully"
echo "============================================================================="
echo "Media Bucket: ${S3_MEDIA_BUCKET}"
echo "Vault Bucket: ${S3_VAULT_BUCKET}"
echo ""
echo "Next step: ./02-create-ecr-repos.sh"
echo "============================================================================="
