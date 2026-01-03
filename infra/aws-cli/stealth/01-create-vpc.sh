#!/bin/bash
# Create minimal VPC for stealth launch
# Public subnet only - no NAT Gateway needed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "Creating VPC infrastructure for stealth launch..."

# =============================================================================
# VPC
# =============================================================================
VPC_ID=$(get_resource_id vpc "$VPC_NAME")

if [[ "$VPC_ID" == "None" ]]; then
    log "Creating VPC: ${VPC_NAME}"
    VPC_ID=$(aws ec2 create-vpc \
        --cidr-block "$VPC_CIDR" \
        --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${VPC_NAME}},${TAGS}]" \
        --query 'Vpc.VpcId' \
        --output text)

    # Enable DNS hostnames and resolution
    aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames
    aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support

    log "Created VPC: ${VPC_ID}"
else
    log "VPC already exists: ${VPC_ID}"
fi

# =============================================================================
# Internet Gateway
# =============================================================================
IGW_ID=$(get_resource_id igw "$IGW_NAME")

if [[ "$IGW_ID" == "None" ]]; then
    log "Creating Internet Gateway: ${IGW_NAME}"
    IGW_ID=$(aws ec2 create-internet-gateway \
        --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${IGW_NAME}},${TAGS}]" \
        --query 'InternetGateway.InternetGatewayId' \
        --output text)

    aws ec2 attach-internet-gateway --vpc-id "$VPC_ID" --internet-gateway-id "$IGW_ID"
    log "Created and attached Internet Gateway: ${IGW_ID}"
else
    log "Internet Gateway already exists: ${IGW_ID}"
fi

# =============================================================================
# Public Subnet
# =============================================================================
SUBNET_ID=$(get_resource_id subnet "$SUBNET_NAME")

if [[ "$SUBNET_ID" == "None" ]]; then
    log "Creating public subnet: ${SUBNET_NAME}"
    SUBNET_ID=$(aws ec2 create-subnet \
        --vpc-id "$VPC_ID" \
        --cidr-block "$PUBLIC_SUBNET_CIDR" \
        --availability-zone "$AVAILABILITY_ZONE" \
        --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${SUBNET_NAME}},${TAGS}]" \
        --query 'Subnet.SubnetId' \
        --output text)

    # Enable auto-assign public IP
    aws ec2 modify-subnet-attribute --subnet-id "$SUBNET_ID" --map-public-ip-on-launch

    log "Created public subnet: ${SUBNET_ID}"
else
    log "Public subnet already exists: ${SUBNET_ID}"
fi

# =============================================================================
# Route Table
# =============================================================================
RTB_ID=$(aws ec2 describe-route-tables \
    --filters "Name=tag:Name,Values=${RTB_NAME}" \
    --query 'RouteTables[0].RouteTableId' \
    --output text 2>/dev/null || echo "None")

if [[ "$RTB_ID" == "None" ]]; then
    log "Creating route table: ${RTB_NAME}"
    RTB_ID=$(aws ec2 create-route-table \
        --vpc-id "$VPC_ID" \
        --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${RTB_NAME}},${TAGS}]" \
        --query 'RouteTable.RouteTableId' \
        --output text)

    # Add route to Internet Gateway
    aws ec2 create-route \
        --route-table-id "$RTB_ID" \
        --destination-cidr-block "0.0.0.0/0" \
        --gateway-id "$IGW_ID"

    # Associate with public subnet
    aws ec2 associate-route-table --route-table-id "$RTB_ID" --subnet-id "$SUBNET_ID"

    log "Created and configured route table: ${RTB_ID}"
else
    log "Route table already exists: ${RTB_ID}"
fi

# =============================================================================
# Security Group
# =============================================================================
SG_ID=$(get_resource_id sg "$SG_NAME")

if [[ "$SG_ID" == "None" ]]; then
    log "Creating security group: ${SG_NAME}"
    SG_ID=$(aws ec2 create-security-group \
        --group-name "$SG_NAME" \
        --description "Campfire stealth launch security group" \
        --vpc-id "$VPC_ID" \
        --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${SG_NAME}},${TAGS}]" \
        --query 'GroupId' \
        --output text)

    # SSH (for management)
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp \
        --port 22 \
        --cidr 0.0.0.0/0

    # HTTP (Cloudflare proxied)
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp \
        --port 80 \
        --cidr 0.0.0.0/0

    # HTTPS (Cloudflare proxied)
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp \
        --port 443 \
        --cidr 0.0.0.0/0

    log "Created security group with ingress rules: ${SG_ID}"
else
    log "Security group already exists: ${SG_ID}"
fi

# =============================================================================
# Summary
# =============================================================================
log ""
log "=========================================="
log "VPC Infrastructure Summary"
log "=========================================="
log "VPC ID:              ${VPC_ID}"
log "Internet Gateway ID: ${IGW_ID}"
log "Subnet ID:           ${SUBNET_ID}"
log "Route Table ID:      ${RTB_ID}"
log "Security Group ID:   ${SG_ID}"
log "=========================================="
log ""
log "Next: Run 02-create-ec2.sh to launch the instance"
