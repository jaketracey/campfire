#!/bin/bash
# =============================================================================
# Upload Companion Variation Images to S3
# =============================================================================
# This script uploads the pre-generated companion variation images to S3
# for use as identity anchors in IP-Adapter based image generation.
#
# Usage: ./upload-companion-images-to-s3.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Configuration
S3_BUCKET="${S3_MEDIA_BUCKET:-campfire-dev-media}"
S3_REGION="${AWS_REGION:-us-east-1}"
S3_VARIATIONS_PREFIX="companions/variations"
S3_ANCHORS_PREFIX="companions/anchors"

# Source directories
VARIATIONS_DIR="${PROJECT_ROOT}/packages/web/public/images/companions"
ANCHORS_DIR="${VARIATIONS_DIR}/anchors"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"
    exit 1
}

# Check prerequisites
check_prerequisites() {
    if ! command -v aws &> /dev/null; then
        error "AWS CLI is not installed. Please install it first."
    fi

    if ! aws sts get-caller-identity &> /dev/null; then
        error "AWS CLI is not configured. Please run 'aws configure' first."
    fi

    if [ ! -d "$VARIATIONS_DIR" ]; then
        error "Variations directory not found: $VARIATIONS_DIR"
    fi

    log "AWS CLI configured for account: $(aws sts get-caller-identity --query Account --output text)"
    log "Target bucket: s3://${S3_BUCKET}"
}

# Upload variation images
upload_variations() {
    log "Uploading variation images to s3://${S3_BUCKET}/${S3_VARIATIONS_PREFIX}/"

    local count=0
    local failed=0

    for img in "${VARIATIONS_DIR}"/*.png; do
        if [ -f "$img" ]; then
            local filename=$(basename "$img")
            local s3_key="${S3_VARIATIONS_PREFIX}/${filename}"

            if aws s3 cp "$img" "s3://${S3_BUCKET}/${s3_key}" \
                --content-type "image/png" \
                --cache-control "max-age=31536000" \
                --quiet 2>/dev/null; then
                ((count++))
                echo -ne "\r  Uploaded: $count images"
            else
                ((failed++))
                warn "Failed to upload: $filename"
            fi
        fi
    done

    echo ""
    log "Uploaded $count variation images ($failed failed)"
}

# Upload anchor images
upload_anchors() {
    if [ ! -d "$ANCHORS_DIR" ]; then
        warn "Anchors directory not found: $ANCHORS_DIR"
        return
    fi

    log "Uploading anchor images to s3://${S3_BUCKET}/${S3_ANCHORS_PREFIX}/"

    local count=0

    for img in "${ANCHORS_DIR}"/*.png; do
        if [ -f "$img" ]; then
            local filename=$(basename "$img")
            local s3_key="${S3_ANCHORS_PREFIX}/${filename}"

            if aws s3 cp "$img" "s3://${S3_BUCKET}/${s3_key}" \
                --content-type "image/png" \
                --cache-control "max-age=31536000" \
                --quiet 2>/dev/null; then
                ((count++))
            fi
        fi
    done

    log "Uploaded $count anchor images"
}

# Make images publicly accessible (for ComfyUI to fetch)
configure_bucket_policy() {
    log "Configuring bucket policy for public read access to companion images..."

    # Create a policy that allows public read for the companions/ prefix only
    local policy='{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "PublicReadCompanionImages",
                "Effect": "Allow",
                "Principal": "*",
                "Action": "s3:GetObject",
                "Resource": "arn:aws:s3:::'${S3_BUCKET}'/companions/*"
            }
        ]
    }'

    # First, we need to disable block public access for this bucket
    log "Disabling BlockPublicPolicy for companion images..."
    aws s3api put-public-access-block \
        --bucket "${S3_BUCKET}" \
        --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false" 2>/dev/null || true

    # Apply the bucket policy
    echo "$policy" | aws s3api put-bucket-policy \
        --bucket "${S3_BUCKET}" \
        --policy file:///dev/stdin 2>/dev/null || {
        warn "Could not set bucket policy. You may need to configure this manually."
        warn "The companion images need to be publicly readable for ComfyUI to access them."
    }

    log "Bucket policy configured"
}

# Verify upload
verify_upload() {
    log "Verifying upload..."

    local test_file="east-asian-slim-black.png"
    local s3_url="https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${S3_VARIATIONS_PREFIX}/${test_file}"

    if curl -s --head "$s3_url" | head -n 1 | grep -q "200 OK"; then
        log "Verification successful! Images are publicly accessible."
        log "Example URL: $s3_url"
    else
        warn "Verification failed. Images may not be publicly accessible."
        warn "You may need to configure bucket policies manually."
    fi
}

# Main
main() {
    echo "============================================================================="
    echo " Upload Companion Images to S3"
    echo "============================================================================="

    check_prerequisites
    upload_variations
    upload_anchors
    configure_bucket_policy
    verify_upload

    echo ""
    echo "============================================================================="
    echo " Upload Complete"
    echo "============================================================================="
    echo "Bucket: s3://${S3_BUCKET}"
    echo "Variations: ${S3_VARIATIONS_PREFIX}/"
    echo "Anchors: ${S3_ANCHORS_PREFIX}/"
    echo ""
    echo "URLs will be:"
    echo "  https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${S3_VARIATIONS_PREFIX}/{ethnicity}-{bodyType}-{hairColor}.png"
    echo "  https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${S3_ANCHORS_PREFIX}/{ethnicity}.png"
    echo "============================================================================="
}

main "$@"
