#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create S3 Buckets (Production)
# =============================================================================
# Creates S3 buckets for media storage, vault, logs, and backups
# with production-grade security and lifecycle policies
#
# Usage: ./01-create-s3-buckets.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli
confirm_production

log "Creating S3 buckets for environment: ${ENVIRONMENT}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# -----------------------------------------------------------------------------
# Create Media Bucket
# -----------------------------------------------------------------------------
log "Creating media bucket: ${S3_MEDIA_BUCKET}"

if aws s3api head-bucket --bucket "${S3_MEDIA_BUCKET}" 2>/dev/null; then
    log "Media bucket already exists, updating configuration"
else
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

# Enable versioning
aws s3api put-bucket-versioning \
    --bucket "${S3_MEDIA_BUCKET}" \
    --versioning-configuration Status=Enabled

# Block public access (critical for production)
aws s3api put-public-access-block \
    --bucket "${S3_MEDIA_BUCKET}" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable server-side encryption
aws s3api put-bucket-encryption \
    --bucket "${S3_MEDIA_BUCKET}" \
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

# Production lifecycle policy
aws s3api put-bucket-lifecycle-configuration \
    --bucket "${S3_MEDIA_BUCKET}" \
    --lifecycle-configuration '{
        "Rules": [
            {
                "ID": "TransitionToIntelligentTiering",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "Transitions": [
                    {
                        "Days": 30,
                        "StorageClass": "INTELLIGENT_TIERING"
                    }
                ]
            },
            {
                "ID": "MoveOldVersionsToGlacier",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "NoncurrentVersionTransitions": [
                    {
                        "NoncurrentDays": 30,
                        "StorageClass": "GLACIER"
                    }
                ],
                "NoncurrentVersionExpiration": {
                    "NoncurrentDays": 365
                }
            },
            {
                "ID": "AbortIncompleteMultipartUploads",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "AbortIncompleteMultipartUpload": {
                    "DaysAfterInitiation": 7
                }
            }
        ]
    }'

# Restricted CORS configuration for production
aws s3api put-bucket-cors \
    --bucket "${S3_MEDIA_BUCKET}" \
    --cors-configuration '{
        "CORSRules": [
            {
                "AllowedOrigins": ["https://*.campfire.app", "https://campfire.app"],
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
    --tagging "TagSet=[{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Purpose,Value=media-storage},{Key=CostCenter,Value=${TAG_COST_CENTER}}]"

log "Media bucket configuration complete"

# -----------------------------------------------------------------------------
# Create Vault Bucket (Encrypted sensitive data)
# -----------------------------------------------------------------------------
log "Creating vault bucket: ${S3_VAULT_BUCKET}"

if aws s3api head-bucket --bucket "${S3_VAULT_BUCKET}" 2>/dev/null; then
    log "Vault bucket already exists, updating configuration"
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

# Block public access (absolutely critical for vault)
aws s3api put-public-access-block \
    --bucket "${S3_VAULT_BUCKET}" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable KMS encryption for vault
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

# Vault lifecycle policy (keep versions longer)
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
                        "Days": 60,
                        "StorageClass": "STANDARD_IA"
                    }
                ]
            },
            {
                "ID": "RetainVersions",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "NoncurrentVersionTransitions": [
                    {
                        "NoncurrentDays": 90,
                        "StorageClass": "GLACIER"
                    }
                ],
                "NoncurrentVersionExpiration": {
                    "NoncurrentDays": 730
                }
            }
        ]
    }'

# Enable object lock for compliance (optional but recommended)
# Note: Object lock can only be enabled at bucket creation time
# aws s3api put-object-lock-configuration ...

# Tag the bucket
aws s3api put-bucket-tagging \
    --bucket "${S3_VAULT_BUCKET}" \
    --tagging "TagSet=[{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Purpose,Value=vault-storage},{Key=Encryption,Value=aws-kms},{Key=DataClassification,Value=confidential},{Key=CostCenter,Value=${TAG_COST_CENTER}}]"

log "Vault bucket configuration complete"

# -----------------------------------------------------------------------------
# Create Logs Bucket (for ALB access logs, etc.)
# -----------------------------------------------------------------------------
log "Creating logs bucket: ${S3_LOGS_BUCKET}"

if aws s3api head-bucket --bucket "${S3_LOGS_BUCKET}" 2>/dev/null; then
    log "Logs bucket already exists, updating configuration"
else
    if [[ "${AWS_REGION}" == "us-east-1" ]]; then
        aws s3api create-bucket \
            --bucket "${S3_LOGS_BUCKET}" \
            --region "${AWS_REGION}"
    else
        aws s3api create-bucket \
            --bucket "${S3_LOGS_BUCKET}" \
            --region "${AWS_REGION}" \
            --create-bucket-configuration LocationConstraint="${AWS_REGION}"
    fi
    log "Logs bucket created successfully"
fi

# Block public access
aws s3api put-public-access-block \
    --bucket "${S3_LOGS_BUCKET}" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable server-side encryption
aws s3api put-bucket-encryption \
    --bucket "${S3_LOGS_BUCKET}" \
    --server-side-encryption-configuration '{
        "Rules": [
            {
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "AES256"
                }
            }
        ]
    }'

# Get the ELB account ID for the region (required for ALB access logs)
ELB_ACCOUNT_ID=""
case "${AWS_REGION}" in
    "us-east-1") ELB_ACCOUNT_ID="127311923021" ;;
    "us-east-2") ELB_ACCOUNT_ID="033677994240" ;;
    "us-west-1") ELB_ACCOUNT_ID="027434742980" ;;
    "us-west-2") ELB_ACCOUNT_ID="797873946194" ;;
    "eu-west-1") ELB_ACCOUNT_ID="156460612806" ;;
    "eu-west-2") ELB_ACCOUNT_ID="652711504416" ;;
    "eu-central-1") ELB_ACCOUNT_ID="054676820928" ;;
    "ap-southeast-1") ELB_ACCOUNT_ID="114774131450" ;;
    "ap-southeast-2") ELB_ACCOUNT_ID="783225319266" ;;
    "ap-northeast-1") ELB_ACCOUNT_ID="582318560864" ;;
    *) ELB_ACCOUNT_ID="127311923021" ;;
esac

# Bucket policy for ALB access logs
aws s3api put-bucket-policy \
    --bucket "${S3_LOGS_BUCKET}" \
    --policy "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [
            {
                \"Effect\": \"Allow\",
                \"Principal\": {
                    \"AWS\": \"arn:aws:iam::${ELB_ACCOUNT_ID}:root\"
                },
                \"Action\": \"s3:PutObject\",
                \"Resource\": \"arn:aws:s3:::${S3_LOGS_BUCKET}/alb-logs/*\"
            },
            {
                \"Effect\": \"Allow\",
                \"Principal\": {
                    \"Service\": \"delivery.logs.amazonaws.com\"
                },
                \"Action\": \"s3:PutObject\",
                \"Resource\": \"arn:aws:s3:::${S3_LOGS_BUCKET}/*\",
                \"Condition\": {
                    \"StringEquals\": {
                        \"s3:x-amz-acl\": \"bucket-owner-full-control\"
                    }
                }
            },
            {
                \"Effect\": \"Allow\",
                \"Principal\": {
                    \"Service\": \"delivery.logs.amazonaws.com\"
                },
                \"Action\": \"s3:GetBucketAcl\",
                \"Resource\": \"arn:aws:s3:::${S3_LOGS_BUCKET}\"
            }
        ]
    }"

# Lifecycle policy for logs (expire after 90 days, transition to Glacier)
aws s3api put-bucket-lifecycle-configuration \
    --bucket "${S3_LOGS_BUCKET}" \
    --lifecycle-configuration '{
        "Rules": [
            {
                "ID": "TransitionAndExpireLogs",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "Transitions": [
                    {
                        "Days": 30,
                        "StorageClass": "STANDARD_IA"
                    },
                    {
                        "Days": 60,
                        "StorageClass": "GLACIER"
                    }
                ],
                "Expiration": {
                    "Days": 365
                }
            }
        ]
    }'

# Tag the bucket
aws s3api put-bucket-tagging \
    --bucket "${S3_LOGS_BUCKET}" \
    --tagging "TagSet=[{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Purpose,Value=access-logs},{Key=CostCenter,Value=${TAG_COST_CENTER}}]"

log "Logs bucket configuration complete"

# -----------------------------------------------------------------------------
# Create Backups Bucket
# -----------------------------------------------------------------------------
log "Creating backups bucket: ${S3_BACKUPS_BUCKET}"

if aws s3api head-bucket --bucket "${S3_BACKUPS_BUCKET}" 2>/dev/null; then
    log "Backups bucket already exists, updating configuration"
else
    if [[ "${AWS_REGION}" == "us-east-1" ]]; then
        aws s3api create-bucket \
            --bucket "${S3_BACKUPS_BUCKET}" \
            --region "${AWS_REGION}"
    else
        aws s3api create-bucket \
            --bucket "${S3_BACKUPS_BUCKET}" \
            --region "${AWS_REGION}" \
            --create-bucket-configuration LocationConstraint="${AWS_REGION}"
    fi
    log "Backups bucket created successfully"
fi

# Enable versioning
aws s3api put-bucket-versioning \
    --bucket "${S3_BACKUPS_BUCKET}" \
    --versioning-configuration Status=Enabled

# Block public access
aws s3api put-public-access-block \
    --bucket "${S3_BACKUPS_BUCKET}" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable KMS encryption for backups
aws s3api put-bucket-encryption \
    --bucket "${S3_BACKUPS_BUCKET}" \
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

# Backup lifecycle policy
aws s3api put-bucket-lifecycle-configuration \
    --bucket "${S3_BACKUPS_BUCKET}" \
    --lifecycle-configuration '{
        "Rules": [
            {
                "ID": "TransitionBackupsToGlacier",
                "Status": "Enabled",
                "Filter": {
                    "Prefix": "rds/"
                },
                "Transitions": [
                    {
                        "Days": 30,
                        "StorageClass": "GLACIER"
                    }
                ],
                "Expiration": {
                    "Days": 730
                }
            },
            {
                "ID": "TransitionDailyBackups",
                "Status": "Enabled",
                "Filter": {
                    "Prefix": "daily/"
                },
                "Transitions": [
                    {
                        "Days": 7,
                        "StorageClass": "STANDARD_IA"
                    },
                    {
                        "Days": 30,
                        "StorageClass": "GLACIER"
                    }
                ],
                "Expiration": {
                    "Days": 365
                }
            }
        ]
    }'

# Tag the bucket
aws s3api put-bucket-tagging \
    --bucket "${S3_BACKUPS_BUCKET}" \
    --tagging "TagSet=[{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Purpose,Value=backups},{Key=Encryption,Value=aws-kms},{Key=CostCenter,Value=${TAG_COST_CENTER}}]"

log "Backups bucket configuration complete"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "S3 Buckets Created Successfully (Production)"
echo "============================================================================="
echo "Media Bucket:   ${S3_MEDIA_BUCKET}"
echo "Vault Bucket:   ${S3_VAULT_BUCKET}"
echo "Logs Bucket:    ${S3_LOGS_BUCKET}"
echo "Backups Bucket: ${S3_BACKUPS_BUCKET}"
echo ""
echo "All buckets configured with:"
echo "  - Server-side encryption (KMS for sensitive data)"
echo "  - Versioning enabled"
echo "  - Public access blocked"
echo "  - Lifecycle policies for cost optimization"
echo "  - Cost allocation tags"
echo ""
echo "Next step: ./02-create-ecr-repos.sh"
echo "============================================================================="
