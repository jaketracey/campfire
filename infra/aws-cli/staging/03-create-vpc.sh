#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create VPC (Staging)
# =============================================================================
# Creates VPC with public and private subnets, internet gateway, and NAT gateway
# with production-like security settings
#
# Usage: ./03-create-vpc.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "Creating VPC for environment: ${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# Create VPC
# -----------------------------------------------------------------------------
log "Creating VPC with CIDR ${VPC_CIDR}"

VPC_ID=$(aws ec2 create-vpc \
    --cidr-block "${VPC_CIDR}" \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-vpc},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=CostCenter,Value=${TAG_COST_CENTER}}]" \
    --query 'Vpc.VpcId' \
    --output text)

log "VPC created: ${VPC_ID}"

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

IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-igw},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'InternetGateway.InternetGatewayId' \
    --output text)

aws ec2 attach-internet-gateway \
    --internet-gateway-id "${IGW_ID}" \
    --vpc-id "${VPC_ID}"

log "Internet Gateway attached: ${IGW_ID}"

# -----------------------------------------------------------------------------
# Create Public Subnets
# -----------------------------------------------------------------------------
log "Creating public subnets"

PUBLIC_SUBNET_1_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PUBLIC_SUBNET_1_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_1}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-1},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=public}]" \
    --query 'Subnet.SubnetId' \
    --output text)

PUBLIC_SUBNET_2_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PUBLIC_SUBNET_2_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_2}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-2},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=public}]" \
    --query 'Subnet.SubnetId' \
    --output text)

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

PRIVATE_SUBNET_1_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PRIVATE_SUBNET_1_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_1}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-1},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=private}]" \
    --query 'Subnet.SubnetId' \
    --output text)

PRIVATE_SUBNET_2_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PRIVATE_SUBNET_2_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_2}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-2},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=private}]" \
    --query 'Subnet.SubnetId' \
    --output text)

log "Private subnets created: ${PRIVATE_SUBNET_1_ID}, ${PRIVATE_SUBNET_2_ID}"

# -----------------------------------------------------------------------------
# Create NAT Gateway (for private subnet internet access)
# -----------------------------------------------------------------------------
log "Creating NAT Gateway"

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

# -----------------------------------------------------------------------------
# Create Route Tables
# -----------------------------------------------------------------------------
log "Creating route tables"

# Public route table
PUBLIC_RT_ID=$(aws ec2 create-route-table \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-rt},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'RouteTable.RouteTableId' \
    --output text)

# Add route to internet gateway
aws ec2 create-route \
    --route-table-id "${PUBLIC_RT_ID}" \
    --destination-cidr-block "0.0.0.0/0" \
    --gateway-id "${IGW_ID}"

# Associate public subnets with public route table
aws ec2 associate-route-table \
    --route-table-id "${PUBLIC_RT_ID}" \
    --subnet-id "${PUBLIC_SUBNET_1_ID}"

aws ec2 associate-route-table \
    --route-table-id "${PUBLIC_RT_ID}" \
    --subnet-id "${PUBLIC_SUBNET_2_ID}"

log "Public route table configured: ${PUBLIC_RT_ID}"

# Private route table
PRIVATE_RT_ID=$(aws ec2 create-route-table \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-rt},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'RouteTable.RouteTableId' \
    --output text)

# Add route to NAT gateway
aws ec2 create-route \
    --route-table-id "${PRIVATE_RT_ID}" \
    --destination-cidr-block "0.0.0.0/0" \
    --nat-gateway-id "${NAT_GW_ID}"

# Associate private subnets with private route table
aws ec2 associate-route-table \
    --route-table-id "${PRIVATE_RT_ID}" \
    --subnet-id "${PRIVATE_SUBNET_1_ID}"

aws ec2 associate-route-table \
    --route-table-id "${PRIVATE_RT_ID}" \
    --subnet-id "${PRIVATE_SUBNET_2_ID}"

log "Private route table configured: ${PRIVATE_RT_ID}"

# -----------------------------------------------------------------------------
# Create Security Groups (Production-like strict rules)
# -----------------------------------------------------------------------------
log "Creating security groups"

# ALB Security Group
ALB_SG_ID=$(aws ec2 create-security-group \
    --group-name "${RESOURCE_PREFIX}-alb-sg" \
    --description "Security group for Application Load Balancer" \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-alb-sg},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'GroupId' \
    --output text)

# Allow HTTPS from anywhere to ALB (production-like - HTTPS only)
aws ec2 authorize-security-group-ingress \
    --group-id "${ALB_SG_ID}" \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0

# Allow HTTP for redirect to HTTPS
aws ec2 authorize-security-group-ingress \
    --group-id "${ALB_SG_ID}" \
    --protocol tcp \
    --port 80 \
    --cidr 0.0.0.0/0

log "ALB security group created: ${ALB_SG_ID}"

# ECS Tasks Security Group
ECS_SG_ID=$(aws ec2 create-security-group \
    --group-name "${RESOURCE_PREFIX}-ecs-sg" \
    --description "Security group for ECS tasks" \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-ecs-sg},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'GroupId' \
    --output text)

# Allow traffic from ALB to ECS tasks
aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 3000-5000 \
    --source-group "${ALB_SG_ID}"

# Allow traffic between ECS tasks
aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 0-65535 \
    --source-group "${ECS_SG_ID}"

log "ECS security group created: ${ECS_SG_ID}"

# RDS Security Group
RDS_SG_ID=$(aws ec2 create-security-group \
    --group-name "${RESOURCE_PREFIX}-rds-sg" \
    --description "Security group for RDS instances" \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-rds-sg},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'GroupId' \
    --output text)

# Allow PostgreSQL traffic from ECS tasks only
aws ec2 authorize-security-group-ingress \
    --group-id "${RDS_SG_ID}" \
    --protocol tcp \
    --port 5432 \
    --source-group "${ECS_SG_ID}"

log "RDS security group created: ${RDS_SG_ID}"

# Redis Security Group (ElastiCache)
REDIS_SG_ID=$(aws ec2 create-security-group \
    --group-name "${RESOURCE_PREFIX}-redis-sg" \
    --description "Security group for Redis/ElastiCache" \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-redis-sg},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'GroupId' \
    --output text)

# Allow Redis traffic from ECS tasks only
aws ec2 authorize-security-group-ingress \
    --group-id "${REDIS_SG_ID}" \
    --protocol tcp \
    --port 6379 \
    --source-group "${ECS_SG_ID}"

log "Redis security group created: ${REDIS_SG_ID}"

# -----------------------------------------------------------------------------
# Create VPC Flow Logs (Production-like monitoring)
# -----------------------------------------------------------------------------
log "Creating VPC Flow Logs"

# Create CloudWatch log group for flow logs
FLOW_LOG_GROUP="/vpc/${RESOURCE_PREFIX}/flow-logs"
aws logs create-log-group \
    --log-group-name "${FLOW_LOG_GROUP}" \
    --tags Project="${TAG_PROJECT}",Environment="${TAG_ENVIRONMENT}" \
    2>/dev/null || log "Flow log group already exists"

aws logs put-retention-policy \
    --log-group-name "${FLOW_LOG_GROUP}" \
    --retention-in-days "${LOG_RETENTION_DAYS}"

# Create IAM role for VPC Flow Logs
FLOW_LOG_ROLE_NAME="${RESOURCE_PREFIX}-vpc-flow-log-role"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > /tmp/flow-log-trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "vpc-flow-logs.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
EOF

if aws iam get-role --role-name "${FLOW_LOG_ROLE_NAME}" 2>/dev/null; then
    log "Flow log role already exists"
else
    aws iam create-role \
        --role-name "${FLOW_LOG_ROLE_NAME}" \
        --assume-role-policy-document file:///tmp/flow-log-trust-policy.json \
        --description "Role for VPC Flow Logs"
fi

cat > /tmp/flow-log-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams"
            ],
            "Resource": "*"
        }
    ]
}
EOF

FLOW_LOG_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-vpc-flow-log-policy"

if aws iam get-policy --policy-arn "${FLOW_LOG_POLICY_ARN}" 2>/dev/null; then
    log "Flow log policy already exists"
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-vpc-flow-log-policy" \
        --policy-document file:///tmp/flow-log-policy.json
fi

aws iam attach-role-policy \
    --role-name "${FLOW_LOG_ROLE_NAME}" \
    --policy-arn "${FLOW_LOG_POLICY_ARN}" 2>/dev/null || true

# Create VPC Flow Log
aws ec2 create-flow-logs \
    --resource-type VPC \
    --resource-ids "${VPC_ID}" \
    --traffic-type ALL \
    --log-destination-type cloud-watch-logs \
    --log-group-name "${FLOW_LOG_GROUP}" \
    --deliver-logs-permission-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${FLOW_LOG_ROLE_NAME}" \
    --tag-specifications "ResourceType=vpc-flow-log,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-flow-log},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    2>/dev/null || log "VPC Flow Log may already exist"

log "VPC Flow Logs configured"

rm -f /tmp/flow-log-trust-policy.json /tmp/flow-log-policy.json

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

export FLOW_LOG_GROUP="${FLOW_LOG_GROUP}"
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
echo "Production-like Features:"
echo "  - VPC Flow Logs: Enabled"
echo "  - DNS Hostnames: Enabled"
echo "  - Security Groups: Strict ingress rules"
echo ""
echo "Next step: ./04-create-rds.sh"
echo "============================================================================="
