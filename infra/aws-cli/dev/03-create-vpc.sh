#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create VPC
# =============================================================================
# Creates VPC with public and private subnets, internet gateway, and NAT gateway
#
# Usage: ./03-create-vpc.sh
#
# This script is idempotent - running it multiple times will not create
# duplicate resources. Existing resources will be detected and reused.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "Creating VPC for environment: ${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# Check if vpc-outputs.env exists and source it for idempotency
# -----------------------------------------------------------------------------
if [[ -f "${SCRIPT_DIR}/vpc-outputs.env" ]]; then
    log "Found existing vpc-outputs.env, checking for existing resources..."
    source "${SCRIPT_DIR}/vpc-outputs.env" 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# Create VPC
# -----------------------------------------------------------------------------
log "Creating VPC with CIDR ${VPC_CIDR}"

# Check if VPC already exists
EXISTING_VPC_ID=$(aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=${RESOURCE_PREFIX}-vpc" "Name=cidr-block,Values=${VPC_CIDR}" \
    --query 'Vpcs[0].VpcId' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_VPC_ID}" != "None" && -n "${EXISTING_VPC_ID}" ]]; then
    VPC_ID="${EXISTING_VPC_ID}"
    log "VPC already exists: ${VPC_ID}"
else
    VPC_ID=$(aws ec2 create-vpc \
        --cidr-block "${VPC_CIDR}" \
        --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-vpc},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
        --query 'Vpc.VpcId' \
        --output text)

    log "VPC created: ${VPC_ID}"
fi

# Enable DNS hostnames
aws ec2 modify-vpc-attribute \
    --vpc-id "${VPC_ID}" \
    --enable-dns-hostnames

# Enable DNS support
aws ec2 modify-vpc-attribute \
    --vpc-id "${VPC_ID}" \
    --enable-dns-support

# -----------------------------------------------------------------------------
# Create Internet Gateway
# -----------------------------------------------------------------------------
log "Creating Internet Gateway"

# Check if IGW already exists for this VPC
EXISTING_IGW_ID=$(aws ec2 describe-internet-gateways \
    --filters "Name=attachment.vpc-id,Values=${VPC_ID}" \
    --query 'InternetGateways[0].InternetGatewayId' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_IGW_ID}" != "None" && -n "${EXISTING_IGW_ID}" ]]; then
    IGW_ID="${EXISTING_IGW_ID}"
    log "Internet Gateway already exists: ${IGW_ID}"
else
    IGW_ID=$(aws ec2 create-internet-gateway \
        --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-igw},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
        --query 'InternetGateway.InternetGatewayId' \
        --output text)

    aws ec2 attach-internet-gateway \
        --internet-gateway-id "${IGW_ID}" \
        --vpc-id "${VPC_ID}"

    log "Internet Gateway attached: ${IGW_ID}"
fi

# -----------------------------------------------------------------------------
# Create Public Subnets
# -----------------------------------------------------------------------------
log "Creating public subnets"

# Check if public subnet 1 exists
EXISTING_PUBLIC_1=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${VPC_ID}" "Name=cidr-block,Values=${PUBLIC_SUBNET_1_CIDR}" \
    --query 'Subnets[0].SubnetId' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_PUBLIC_1}" != "None" && -n "${EXISTING_PUBLIC_1}" ]]; then
    PUBLIC_SUBNET_1_ID="${EXISTING_PUBLIC_1}"
    log "Public subnet 1 already exists: ${PUBLIC_SUBNET_1_ID}"
else
    PUBLIC_SUBNET_1_ID=$(aws ec2 create-subnet \
        --vpc-id "${VPC_ID}" \
        --cidr-block "${PUBLIC_SUBNET_1_CIDR}" \
        --availability-zone "${AVAILABILITY_ZONE_1}" \
        --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-1},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=public}]" \
        --query 'Subnet.SubnetId' \
        --output text)
fi

# Check if public subnet 2 exists
EXISTING_PUBLIC_2=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${VPC_ID}" "Name=cidr-block,Values=${PUBLIC_SUBNET_2_CIDR}" \
    --query 'Subnets[0].SubnetId' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_PUBLIC_2}" != "None" && -n "${EXISTING_PUBLIC_2}" ]]; then
    PUBLIC_SUBNET_2_ID="${EXISTING_PUBLIC_2}"
    log "Public subnet 2 already exists: ${PUBLIC_SUBNET_2_ID}"
else
    PUBLIC_SUBNET_2_ID=$(aws ec2 create-subnet \
        --vpc-id "${VPC_ID}" \
        --cidr-block "${PUBLIC_SUBNET_2_CIDR}" \
        --availability-zone "${AVAILABILITY_ZONE_2}" \
        --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-2},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=public}]" \
        --query 'Subnet.SubnetId' \
        --output text)
fi

# Enable auto-assign public IP for public subnets
aws ec2 modify-subnet-attribute \
    --subnet-id "${PUBLIC_SUBNET_1_ID}" \
    --map-public-ip-on-launch

aws ec2 modify-subnet-attribute \
    --subnet-id "${PUBLIC_SUBNET_2_ID}" \
    --map-public-ip-on-launch

log "Public subnets created: ${PUBLIC_SUBNET_1_ID}, ${PUBLIC_SUBNET_2_ID}"

# -----------------------------------------------------------------------------
# Create Private Subnets
# -----------------------------------------------------------------------------
log "Creating private subnets"

# Check if private subnet 1 exists
EXISTING_PRIVATE_1=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${VPC_ID}" "Name=cidr-block,Values=${PRIVATE_SUBNET_1_CIDR}" \
    --query 'Subnets[0].SubnetId' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_PRIVATE_1}" != "None" && -n "${EXISTING_PRIVATE_1}" ]]; then
    PRIVATE_SUBNET_1_ID="${EXISTING_PRIVATE_1}"
    log "Private subnet 1 already exists: ${PRIVATE_SUBNET_1_ID}"
else
    PRIVATE_SUBNET_1_ID=$(aws ec2 create-subnet \
        --vpc-id "${VPC_ID}" \
        --cidr-block "${PRIVATE_SUBNET_1_CIDR}" \
        --availability-zone "${AVAILABILITY_ZONE_1}" \
        --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-1},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=private}]" \
        --query 'Subnet.SubnetId' \
        --output text)
fi

# Check if private subnet 2 exists
EXISTING_PRIVATE_2=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${VPC_ID}" "Name=cidr-block,Values=${PRIVATE_SUBNET_2_CIDR}" \
    --query 'Subnets[0].SubnetId' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_PRIVATE_2}" != "None" && -n "${EXISTING_PRIVATE_2}" ]]; then
    PRIVATE_SUBNET_2_ID="${EXISTING_PRIVATE_2}"
    log "Private subnet 2 already exists: ${PRIVATE_SUBNET_2_ID}"
else
    PRIVATE_SUBNET_2_ID=$(aws ec2 create-subnet \
        --vpc-id "${VPC_ID}" \
        --cidr-block "${PRIVATE_SUBNET_2_CIDR}" \
        --availability-zone "${AVAILABILITY_ZONE_2}" \
        --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-2},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=private}]" \
        --query 'Subnet.SubnetId' \
        --output text)
fi

log "Private subnets created: ${PRIVATE_SUBNET_1_ID}, ${PRIVATE_SUBNET_2_ID}"

# -----------------------------------------------------------------------------
# Create NAT Gateway (for private subnet internet access)
# -----------------------------------------------------------------------------
log "Creating NAT Gateway"

# Check if NAT Gateway already exists
EXISTING_NAT_GW=$(aws ec2 describe-nat-gateways \
    --filter "Name=vpc-id,Values=${VPC_ID}" "Name=state,Values=available,pending" \
    --query 'NatGateways[0].NatGatewayId' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_NAT_GW}" != "None" && -n "${EXISTING_NAT_GW}" ]]; then
    NAT_GW_ID="${EXISTING_NAT_GW}"
    # Get the associated EIP
    EIP_ALLOC_ID=$(aws ec2 describe-nat-gateways \
        --nat-gateway-ids "${NAT_GW_ID}" \
        --query 'NatGateways[0].NatGatewayAddresses[0].AllocationId' \
        --output text)
    log "NAT Gateway already exists: ${NAT_GW_ID}"
else
    # Allocate Elastic IP for NAT Gateway
    EIP_ALLOC_ID=$(aws ec2 allocate-address \
        --domain vpc \
        --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-nat-eip},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
        --query 'AllocationId' \
        --output text)

    # Create NAT Gateway in first public subnet
    NAT_GW_ID=$(aws ec2 create-nat-gateway \
        --subnet-id "${PUBLIC_SUBNET_1_ID}" \
        --allocation-id "${EIP_ALLOC_ID}" \
        --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-nat},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
        --query 'NatGateway.NatGatewayId' \
        --output text)

    log "NAT Gateway created: ${NAT_GW_ID} (waiting for it to become available...)"

    # Wait for NAT Gateway to be available
    aws ec2 wait nat-gateway-available --nat-gateway-ids "${NAT_GW_ID}"
    log "NAT Gateway is now available"
fi

# -----------------------------------------------------------------------------
# Create Route Tables
# -----------------------------------------------------------------------------
log "Creating route tables"

# Check if public route table exists
EXISTING_PUBLIC_RT=$(aws ec2 describe-route-tables \
    --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:Name,Values=${RESOURCE_PREFIX}-public-rt" \
    --query 'RouteTables[0].RouteTableId' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_PUBLIC_RT}" != "None" && -n "${EXISTING_PUBLIC_RT}" ]]; then
    PUBLIC_RT_ID="${EXISTING_PUBLIC_RT}"
    log "Public route table already exists: ${PUBLIC_RT_ID}"
else
    PUBLIC_RT_ID=$(aws ec2 create-route-table \
        --vpc-id "${VPC_ID}" \
        --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-rt},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
        --query 'RouteTable.RouteTableId' \
        --output text)

    # Add route to internet gateway
    aws ec2 create-route \
        --route-table-id "${PUBLIC_RT_ID}" \
        --destination-cidr-block "0.0.0.0/0" \
        --gateway-id "${IGW_ID}" 2>/dev/null || true

    # Associate public subnets with public route table
    aws ec2 associate-route-table \
        --route-table-id "${PUBLIC_RT_ID}" \
        --subnet-id "${PUBLIC_SUBNET_1_ID}" 2>/dev/null || true

    aws ec2 associate-route-table \
        --route-table-id "${PUBLIC_RT_ID}" \
        --subnet-id "${PUBLIC_SUBNET_2_ID}" 2>/dev/null || true

    log "Public route table configured: ${PUBLIC_RT_ID}"
fi

# Check if private route table exists
EXISTING_PRIVATE_RT=$(aws ec2 describe-route-tables \
    --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:Name,Values=${RESOURCE_PREFIX}-private-rt" \
    --query 'RouteTables[0].RouteTableId' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_PRIVATE_RT}" != "None" && -n "${EXISTING_PRIVATE_RT}" ]]; then
    PRIVATE_RT_ID="${EXISTING_PRIVATE_RT}"
    log "Private route table already exists: ${PRIVATE_RT_ID}"
else
    PRIVATE_RT_ID=$(aws ec2 create-route-table \
        --vpc-id "${VPC_ID}" \
        --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-rt},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
        --query 'RouteTable.RouteTableId' \
        --output text)

    # Add route to NAT gateway
    aws ec2 create-route \
        --route-table-id "${PRIVATE_RT_ID}" \
        --destination-cidr-block "0.0.0.0/0" \
        --nat-gateway-id "${NAT_GW_ID}" 2>/dev/null || true

    # Associate private subnets with private route table
    aws ec2 associate-route-table \
        --route-table-id "${PRIVATE_RT_ID}" \
        --subnet-id "${PRIVATE_SUBNET_1_ID}" 2>/dev/null || true

    aws ec2 associate-route-table \
        --route-table-id "${PRIVATE_RT_ID}" \
        --subnet-id "${PRIVATE_SUBNET_2_ID}" 2>/dev/null || true

    log "Private route table configured: ${PRIVATE_RT_ID}"
fi

# -----------------------------------------------------------------------------
# Create Security Groups
# -----------------------------------------------------------------------------
log "Creating security groups"

# Helper function to get or create security group
get_or_create_sg() {
    local sg_name="$1"
    local sg_desc="$2"

    local existing_sg=$(aws ec2 describe-security-groups \
        --filters "Name=vpc-id,Values=${VPC_ID}" "Name=group-name,Values=${sg_name}" \
        --query 'SecurityGroups[0].GroupId' \
        --output text 2>/dev/null || echo "None")

    if [[ "${existing_sg}" != "None" && -n "${existing_sg}" ]]; then
        echo "${existing_sg}"
    else
        aws ec2 create-security-group \
            --group-name "${sg_name}" \
            --description "${sg_desc}" \
            --vpc-id "${VPC_ID}" \
            --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${sg_name}},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
            --query 'GroupId' \
            --output text
    fi
}

# ALB Security Group
ALB_SG_ID=$(get_or_create_sg "${RESOURCE_PREFIX}-alb-sg" "Security group for Application Load Balancer")

# Allow HTTP and HTTPS from anywhere to ALB (idempotent - will fail silently if rule exists)
aws ec2 authorize-security-group-ingress \
    --group-id "${ALB_SG_ID}" \
    --protocol tcp \
    --port 80 \
    --cidr 0.0.0.0/0 2>/dev/null || true

aws ec2 authorize-security-group-ingress \
    --group-id "${ALB_SG_ID}" \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0 2>/dev/null || true

log "ALB security group ready: ${ALB_SG_ID}"

# ECS Tasks Security Group
ECS_SG_ID=$(get_or_create_sg "${RESOURCE_PREFIX}-ecs-sg" "Security group for ECS tasks")

# Allow traffic from ALB to ECS tasks (ports 3000-5000 for various services)
aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 3000-5000 \
    --source-group "${ALB_SG_ID}" 2>/dev/null || true

# Allow port 8080 for workers health check
aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 8080 \
    --source-group "${ALB_SG_ID}" 2>/dev/null || true

# Allow traffic between ECS tasks (for service discovery)
aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 0-65535 \
    --source-group "${ECS_SG_ID}" 2>/dev/null || true

log "ECS security group ready: ${ECS_SG_ID}"

# RDS Security Group
RDS_SG_ID=$(get_or_create_sg "${RESOURCE_PREFIX}-rds-sg" "Security group for RDS instances")

# Allow PostgreSQL traffic from ECS tasks
aws ec2 authorize-security-group-ingress \
    --group-id "${RDS_SG_ID}" \
    --protocol tcp \
    --port 5432 \
    --source-group "${ECS_SG_ID}" 2>/dev/null || true

log "RDS security group ready: ${RDS_SG_ID}"

# Redis Security Group (ElastiCache)
REDIS_SG_ID=$(get_or_create_sg "${RESOURCE_PREFIX}-redis-sg" "Security group for Redis/ElastiCache")

# Allow Redis traffic from ECS tasks
aws ec2 authorize-security-group-ingress \
    --group-id "${REDIS_SG_ID}" \
    --protocol tcp \
    --port 6379 \
    --source-group "${ECS_SG_ID}" 2>/dev/null || true

log "Redis security group ready: ${REDIS_SG_ID}"

# -----------------------------------------------------------------------------
# Save Resource IDs
# -----------------------------------------------------------------------------
cat > "${SCRIPT_DIR}/vpc-outputs.env" << EOF
# VPC Resources - Generated by 03-create-vpc.sh
# Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

export VPC_ID="${VPC_ID}"
export IGW_ID="${IGW_ID}"
export NAT_GW_ID="${NAT_GW_ID}"
export EIP_ALLOC_ID="${EIP_ALLOC_ID}"

export PUBLIC_SUBNET_1_ID="${PUBLIC_SUBNET_1_ID}"
export PUBLIC_SUBNET_2_ID="${PUBLIC_SUBNET_2_ID}"
export PRIVATE_SUBNET_1_ID="${PRIVATE_SUBNET_1_ID}"
export PRIVATE_SUBNET_2_ID="${PRIVATE_SUBNET_2_ID}"

export PUBLIC_RT_ID="${PUBLIC_RT_ID}"
export PRIVATE_RT_ID="${PRIVATE_RT_ID}"

export ALB_SG_ID="${ALB_SG_ID}"
export ECS_SG_ID="${ECS_SG_ID}"
export RDS_SG_ID="${RDS_SG_ID}"
export REDIS_SG_ID="${REDIS_SG_ID}"
EOF

log "Resource IDs saved to vpc-outputs.env"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "VPC Created Successfully"
echo "============================================================================="
echo "VPC ID:              ${VPC_ID}"
echo "Internet Gateway:    ${IGW_ID}"
echo "NAT Gateway:         ${NAT_GW_ID}"
echo ""
echo "Public Subnets:"
echo "  - ${PUBLIC_SUBNET_1_ID} (${AVAILABILITY_ZONE_1})"
echo "  - ${PUBLIC_SUBNET_2_ID} (${AVAILABILITY_ZONE_2})"
echo ""
echo "Private Subnets:"
echo "  - ${PRIVATE_SUBNET_1_ID} (${AVAILABILITY_ZONE_1})"
echo "  - ${PRIVATE_SUBNET_2_ID} (${AVAILABILITY_ZONE_2})"
echo ""
echo "Security Groups:"
echo "  - ALB:   ${ALB_SG_ID}"
echo "  - ECS:   ${ECS_SG_ID}"
echo "  - RDS:   ${RDS_SG_ID}"
echo "  - Redis: ${REDIS_SG_ID}"
echo ""
echo "Next step: ./04-create-rds.sh"
echo "============================================================================="
