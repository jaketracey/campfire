#!/bin/bash
# Teardown all stealth launch resources
# WARNING: This will delete everything!

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "=========================================="
log "WARNING: This will delete ALL stealth resources!"
log "=========================================="
log ""
log "Resources to be deleted:"
log "  - EC2 Instance: ${INSTANCE_NAME}"
log "  - Elastic IP: ${EIP_NAME}"
log "  - Security Group: ${SG_NAME}"
log "  - Subnet: ${SUBNET_NAME}"
log "  - Route Table: ${RTB_NAME}"
log "  - Internet Gateway: ${IGW_NAME}"
log "  - VPC: ${VPC_NAME}"
log "  - S3 Bucket: ${S3_MEDIA_BUCKET}"
log "  - Key Pair: ${KEY_NAME}"
log ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    log "Aborted."
    exit 0
fi

log ""
log "Starting teardown..."

# =============================================================================
# Terminate EC2 Instance
# =============================================================================
INSTANCE_ID=$(get_resource_id instance "$INSTANCE_NAME")
if [[ "$INSTANCE_ID" != "None" ]]; then
    log "Terminating EC2 instance: ${INSTANCE_ID}"
    aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"
    log "Waiting for instance to terminate..."
    aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
    log "Instance terminated"
else
    log "No instance found"
fi

# =============================================================================
# Release Elastic IP
# =============================================================================
EIP_ALLOC_ID=$(get_resource_id eip "$EIP_NAME")
if [[ "$EIP_ALLOC_ID" != "None" ]]; then
    log "Releasing Elastic IP: ${EIP_ALLOC_ID}"
    aws ec2 release-address --allocation-id "$EIP_ALLOC_ID" || true
    log "Elastic IP released"
else
    log "No Elastic IP found"
fi

# =============================================================================
# Delete Security Group
# =============================================================================
SG_ID=$(get_resource_id sg "$SG_NAME")
if [[ "$SG_ID" != "None" ]]; then
    log "Deleting security group: ${SG_ID}"
    # May need to wait for ENIs to detach
    sleep 5
    aws ec2 delete-security-group --group-id "$SG_ID" || log "Could not delete SG yet, will retry"
else
    log "No security group found"
fi

# =============================================================================
# Delete Subnet
# =============================================================================
SUBNET_ID=$(get_resource_id subnet "$SUBNET_NAME")
if [[ "$SUBNET_ID" != "None" ]]; then
    log "Deleting subnet: ${SUBNET_ID}"
    aws ec2 delete-subnet --subnet-id "$SUBNET_ID"
    log "Subnet deleted"
else
    log "No subnet found"
fi

# =============================================================================
# Delete Route Table
# =============================================================================
RTB_ID=$(aws ec2 describe-route-tables \
    --filters "Name=tag:Name,Values=${RTB_NAME}" \
    --query 'RouteTables[0].RouteTableId' \
    --output text 2>/dev/null || echo "None")

if [[ "$RTB_ID" != "None" && -n "$RTB_ID" ]]; then
    # Disassociate from subnets first
    ASSOC_IDS=$(aws ec2 describe-route-tables \
        --route-table-ids "$RTB_ID" \
        --query 'RouteTables[0].Associations[?!Main].RouteTableAssociationId' \
        --output text 2>/dev/null || echo "")

    for ASSOC_ID in $ASSOC_IDS; do
        if [[ -n "$ASSOC_ID" && "$ASSOC_ID" != "None" ]]; then
            aws ec2 disassociate-route-table --association-id "$ASSOC_ID" || true
        fi
    done

    log "Deleting route table: ${RTB_ID}"
    aws ec2 delete-route-table --route-table-id "$RTB_ID" || true
    log "Route table deleted"
else
    log "No route table found"
fi

# =============================================================================
# Detach and Delete Internet Gateway
# =============================================================================
IGW_ID=$(get_resource_id igw "$IGW_NAME")
VPC_ID=$(get_resource_id vpc "$VPC_NAME")

if [[ "$IGW_ID" != "None" ]]; then
    if [[ "$VPC_ID" != "None" ]]; then
        log "Detaching Internet Gateway from VPC..."
        aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" || true
    fi
    log "Deleting Internet Gateway: ${IGW_ID}"
    aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID"
    log "Internet Gateway deleted"
else
    log "No Internet Gateway found"
fi

# =============================================================================
# Delete VPC
# =============================================================================
if [[ "$VPC_ID" != "None" ]]; then
    # Retry security group deletion
    SG_ID=$(get_resource_id sg "$SG_NAME")
    if [[ "$SG_ID" != "None" ]]; then
        log "Retrying security group deletion..."
        aws ec2 delete-security-group --group-id "$SG_ID" || true
    fi

    log "Deleting VPC: ${VPC_ID}"
    aws ec2 delete-vpc --vpc-id "$VPC_ID"
    log "VPC deleted"
else
    log "No VPC found"
fi

# =============================================================================
# Empty and Delete S3 Bucket
# =============================================================================
if aws s3api head-bucket --bucket "$S3_MEDIA_BUCKET" 2>/dev/null; then
    log "Emptying S3 bucket: ${S3_MEDIA_BUCKET}"
    aws s3 rm "s3://${S3_MEDIA_BUCKET}" --recursive || true

    # Delete versions if versioning was enabled
    log "Deleting object versions..."
    aws s3api list-object-versions --bucket "$S3_MEDIA_BUCKET" --output text \
        --query 'Versions[].{Key:Key,VersionId:VersionId}' 2>/dev/null | \
        while read KEY VERSION; do
            if [[ -n "$KEY" && -n "$VERSION" ]]; then
                aws s3api delete-object --bucket "$S3_MEDIA_BUCKET" --key "$KEY" --version-id "$VERSION" 2>/dev/null || true
            fi
        done

    # Delete markers
    aws s3api list-object-versions --bucket "$S3_MEDIA_BUCKET" --output text \
        --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' 2>/dev/null | \
        while read KEY VERSION; do
            if [[ -n "$KEY" && -n "$VERSION" ]]; then
                aws s3api delete-object --bucket "$S3_MEDIA_BUCKET" --key "$KEY" --version-id "$VERSION" 2>/dev/null || true
            fi
        done

    log "Deleting S3 bucket..."
    aws s3api delete-bucket --bucket "$S3_MEDIA_BUCKET"
    log "S3 bucket deleted"
else
    log "No S3 bucket found"
fi

# =============================================================================
# Delete Key Pair
# =============================================================================
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" &>/dev/null; then
    log "Deleting key pair: ${KEY_NAME}"
    aws ec2 delete-key-pair --key-name "$KEY_NAME"

    # Remove local key file
    KEY_FILE="${SCRIPT_DIR}/${KEY_NAME}.pem"
    if [[ -f "$KEY_FILE" ]]; then
        rm "$KEY_FILE"
        log "Removed local key file"
    fi
    log "Key pair deleted"
else
    log "No key pair found"
fi

# =============================================================================
# Summary
# =============================================================================
log ""
log "=========================================="
log "Teardown Complete"
log "=========================================="
log "All stealth launch resources have been deleted."
log "Your AWS account should no longer incur charges for these resources."
log "=========================================="
