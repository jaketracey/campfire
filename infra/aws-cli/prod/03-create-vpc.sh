#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create VPC (Production)
# =============================================================================
# Creates VPC with 3-AZ deployment, enhanced security groups, and
# production-grade networking configuration
#
# Usage: ./03-create-vpc.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli
confirm_production

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
# Create Public Subnets (3 AZs for production HA)
# -----------------------------------------------------------------------------
log "Creating public subnets across 3 AZs"

PUBLIC_SUBNET_1_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PUBLIC_SUBNET_1_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_1}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-1},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=public},{Key=kubernetes.io/role/elb,Value=1}]" \
    --query 'Subnet.SubnetId' \
    --output text)

PUBLIC_SUBNET_2_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PUBLIC_SUBNET_2_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_2}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-2},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=public},{Key=kubernetes.io/role/elb,Value=1}]" \
    --query 'Subnet.SubnetId' \
    --output text)

PUBLIC_SUBNET_3_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PUBLIC_SUBNET_3_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_3}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-3},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=public},{Key=kubernetes.io/role/elb,Value=1}]" \
    --query 'Subnet.SubnetId' \
    --output text)

# Enable auto-assign public IP for public subnets
aws ec2 modify-subnet-attribute --subnet-id "${PUBLIC_SUBNET_1_ID}" --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --subnet-id "${PUBLIC_SUBNET_2_ID}" --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --subnet-id "${PUBLIC_SUBNET_3_ID}" --map-public-ip-on-launch

log "Public subnets created: ${PUBLIC_SUBNET_1_ID}, ${PUBLIC_SUBNET_2_ID}, ${PUBLIC_SUBNET_3_ID}"

# -----------------------------------------------------------------------------
# Create Private Subnets (3 AZs for production HA)
# -----------------------------------------------------------------------------
log "Creating private subnets across 3 AZs"

PRIVATE_SUBNET_1_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PRIVATE_SUBNET_1_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_1}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-1},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=private},{Key=kubernetes.io/role/internal-elb,Value=1}]" \
    --query 'Subnet.SubnetId' \
    --output text)

PRIVATE_SUBNET_2_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PRIVATE_SUBNET_2_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_2}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-2},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=private},{Key=kubernetes.io/role/internal-elb,Value=1}]" \
    --query 'Subnet.SubnetId' \
    --output text)

PRIVATE_SUBNET_3_ID=$(aws ec2 create-subnet \
    --vpc-id "${VPC_ID}" \
    --cidr-block "${PRIVATE_SUBNET_3_CIDR}" \
    --availability-zone "${AVAILABILITY_ZONE_3}" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-3},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}},{Key=Type,Value=private},{Key=kubernetes.io/role/internal-elb,Value=1}]" \
    --query 'Subnet.SubnetId' \
    --output text)

log "Private subnets created: ${PRIVATE_SUBNET_1_ID}, ${PRIVATE_SUBNET_2_ID}, ${PRIVATE_SUBNET_3_ID}"

# -----------------------------------------------------------------------------
# Create NAT Gateways (one per AZ for HA in production)
# -----------------------------------------------------------------------------
log "Creating NAT Gateways for high availability (one per AZ)"

# NAT Gateway 1
EIP_ALLOC_1_ID=$(aws ec2 allocate-address \
    --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-nat-eip-1},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'AllocationId' \
    --output text)

NAT_GW_1_ID=$(aws ec2 create-nat-gateway \
    --subnet-id "${PUBLIC_SUBNET_1_ID}" \
    --allocation-id "${EIP_ALLOC_1_ID}" \
    --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-nat-1},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'NatGateway.NatGatewayId' \
    --output text)

log "NAT Gateway 1 created: ${NAT_GW_1_ID}"

# NAT Gateway 2
EIP_ALLOC_2_ID=$(aws ec2 allocate-address \
    --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-nat-eip-2},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'AllocationId' \
    --output text)

NAT_GW_2_ID=$(aws ec2 create-nat-gateway \
    --subnet-id "${PUBLIC_SUBNET_2_ID}" \
    --allocation-id "${EIP_ALLOC_2_ID}" \
    --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-nat-2},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'NatGateway.NatGatewayId' \
    --output text)

log "NAT Gateway 2 created: ${NAT_GW_2_ID}"

# NAT Gateway 3
EIP_ALLOC_3_ID=$(aws ec2 allocate-address \
    --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-nat-eip-3},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'AllocationId' \
    --output text)

NAT_GW_3_ID=$(aws ec2 create-nat-gateway \
    --subnet-id "${PUBLIC_SUBNET_3_ID}" \
    --allocation-id "${EIP_ALLOC_3_ID}" \
    --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-nat-3},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'NatGateway.NatGatewayId' \
    --output text)

log "NAT Gateway 3 created: ${NAT_GW_3_ID}"

# Wait for all NAT Gateways
log "Waiting for NAT Gateways to become available..."
aws ec2 wait nat-gateway-available --nat-gateway-ids "${NAT_GW_1_ID}" "${NAT_GW_2_ID}" "${NAT_GW_3_ID}"
log "All NAT Gateways are now available"

# -----------------------------------------------------------------------------
# Create Route Tables
# -----------------------------------------------------------------------------
log "Creating route tables"

# Public route table (shared)
PUBLIC_RT_ID=$(aws ec2 create-route-table \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-public-rt},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'RouteTable.RouteTableId' \
    --output text)

aws ec2 create-route \
    --route-table-id "${PUBLIC_RT_ID}" \
    --destination-cidr-block "0.0.0.0/0" \
    --gateway-id "${IGW_ID}"

aws ec2 associate-route-table --route-table-id "${PUBLIC_RT_ID}" --subnet-id "${PUBLIC_SUBNET_1_ID}"
aws ec2 associate-route-table --route-table-id "${PUBLIC_RT_ID}" --subnet-id "${PUBLIC_SUBNET_2_ID}"
aws ec2 associate-route-table --route-table-id "${PUBLIC_RT_ID}" --subnet-id "${PUBLIC_SUBNET_3_ID}"

log "Public route table configured: ${PUBLIC_RT_ID}"

# Private route table 1 (AZ1)
PRIVATE_RT_1_ID=$(aws ec2 create-route-table \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-rt-1},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'RouteTable.RouteTableId' \
    --output text)

aws ec2 create-route \
    --route-table-id "${PRIVATE_RT_1_ID}" \
    --destination-cidr-block "0.0.0.0/0" \
    --nat-gateway-id "${NAT_GW_1_ID}"

aws ec2 associate-route-table --route-table-id "${PRIVATE_RT_1_ID}" --subnet-id "${PRIVATE_SUBNET_1_ID}"

# Private route table 2 (AZ2)
PRIVATE_RT_2_ID=$(aws ec2 create-route-table \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-rt-2},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'RouteTable.RouteTableId' \
    --output text)

aws ec2 create-route \
    --route-table-id "${PRIVATE_RT_2_ID}" \
    --destination-cidr-block "0.0.0.0/0" \
    --nat-gateway-id "${NAT_GW_2_ID}"

aws ec2 associate-route-table --route-table-id "${PRIVATE_RT_2_ID}" --subnet-id "${PRIVATE_SUBNET_2_ID}"

# Private route table 3 (AZ3)
PRIVATE_RT_3_ID=$(aws ec2 create-route-table \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-private-rt-3},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'RouteTable.RouteTableId' \
    --output text)

aws ec2 create-route \
    --route-table-id "${PRIVATE_RT_3_ID}" \
    --destination-cidr-block "0.0.0.0/0" \
    --nat-gateway-id "${NAT_GW_3_ID}"

aws ec2 associate-route-table --route-table-id "${PRIVATE_RT_3_ID}" --subnet-id "${PRIVATE_SUBNET_3_ID}"

log "Private route tables configured with per-AZ NAT Gateways"

# -----------------------------------------------------------------------------
# Create Security Groups (Production - more restrictive)
# -----------------------------------------------------------------------------
log "Creating production security groups"

# ALB Security Group
ALB_SG_ID=$(aws ec2 create-security-group \
    --group-name "${RESOURCE_PREFIX}-alb-sg" \
    --description "Production security group for Application Load Balancer" \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-alb-sg},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'GroupId' \
    --output text)

# Allow HTTPS from anywhere (production should use HTTPS)
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
    --description "Production security group for ECS tasks" \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-ecs-sg},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'GroupId' \
    --output text)

# Allow traffic from ALB only to specific service ports
aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 3000 \
    --source-group "${ALB_SG_ID}"

aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 3001 \
    --source-group "${ALB_SG_ID}"

aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 4000 \
    --source-group "${ALB_SG_ID}"

aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 4001 \
    --source-group "${ALB_SG_ID}"

# Allow inter-service communication
aws ec2 authorize-security-group-ingress \
    --group-id "${ECS_SG_ID}" \
    --protocol tcp \
    --port 3000-8080 \
    --source-group "${ECS_SG_ID}"

log "ECS security group created: ${ECS_SG_ID}"

# RDS Security Group
RDS_SG_ID=$(aws ec2 create-security-group \
    --group-name "${RESOURCE_PREFIX}-rds-sg" \
    --description "Production security group for RDS instances" \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-rds-sg},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'GroupId' \
    --output text)

# Allow PostgreSQL traffic only from ECS tasks
aws ec2 authorize-security-group-ingress \
    --group-id "${RDS_SG_ID}" \
    --protocol tcp \
    --port 5432 \
    --source-group "${ECS_SG_ID}"

log "RDS security group created: ${RDS_SG_ID}"

# Redis Security Group (ElastiCache)
REDIS_SG_ID=$(aws ec2 create-security-group \
    --group-name "${RESOURCE_PREFIX}-redis-sg" \
    --description "Production security group for Redis/ElastiCache" \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-redis-sg},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'GroupId' \
    --output text)

# Allow Redis traffic only from ECS tasks
aws ec2 authorize-security-group-ingress \
    --group-id "${REDIS_SG_ID}" \
    --protocol tcp \
    --port 6379 \
    --source-group "${ECS_SG_ID}"

log "Redis security group created: ${REDIS_SG_ID}"

# VPC Endpoints Security Group (for PrivateLink)
VPCE_SG_ID=$(aws ec2 create-security-group \
    --group-name "${RESOURCE_PREFIX}-vpce-sg" \
    --description "Security group for VPC endpoints" \
    --vpc-id "${VPC_ID}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-vpce-sg},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]" \
    --query 'GroupId' \
    --output text)

# Allow HTTPS from VPC CIDR
aws ec2 authorize-security-group-ingress \
    --group-id "${VPCE_SG_ID}" \
    --protocol tcp \
    --port 443 \
    --cidr "${VPC_CIDR}"

log "VPC Endpoints security group created: ${VPCE_SG_ID}"

# -----------------------------------------------------------------------------
# Create VPC Endpoints (reduce NAT costs and improve security)
# -----------------------------------------------------------------------------
log "Creating VPC endpoints for AWS services"

# S3 Gateway Endpoint (free)
aws ec2 create-vpc-endpoint \
    --vpc-id "${VPC_ID}" \
    --service-name "com.amazonaws.${AWS_REGION}.s3" \
    --route-table-ids "${PRIVATE_RT_1_ID}" "${PRIVATE_RT_2_ID}" "${PRIVATE_RT_3_ID}" \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-s3-endpoint},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]"

log "S3 VPC endpoint created"

# DynamoDB Gateway Endpoint (free)
aws ec2 create-vpc-endpoint \
    --vpc-id "${VPC_ID}" \
    --service-name "com.amazonaws.${AWS_REGION}.dynamodb" \
    --route-table-ids "${PRIVATE_RT_1_ID}" "${PRIVATE_RT_2_ID}" "${PRIVATE_RT_3_ID}" \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-dynamodb-endpoint},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]"

log "DynamoDB VPC endpoint created"

# ECR API Interface Endpoint
aws ec2 create-vpc-endpoint \
    --vpc-id "${VPC_ID}" \
    --vpc-endpoint-type Interface \
    --service-name "com.amazonaws.${AWS_REGION}.ecr.api" \
    --subnet-ids "${PRIVATE_SUBNET_1_ID}" "${PRIVATE_SUBNET_2_ID}" "${PRIVATE_SUBNET_3_ID}" \
    --security-group-ids "${VPCE_SG_ID}" \
    --private-dns-enabled \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-ecr-api-endpoint},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]"

log "ECR API VPC endpoint created"

# ECR Docker Interface Endpoint
aws ec2 create-vpc-endpoint \
    --vpc-id "${VPC_ID}" \
    --vpc-endpoint-type Interface \
    --service-name "com.amazonaws.${AWS_REGION}.ecr.dkr" \
    --subnet-ids "${PRIVATE_SUBNET_1_ID}" "${PRIVATE_SUBNET_2_ID}" "${PRIVATE_SUBNET_3_ID}" \
    --security-group-ids "${VPCE_SG_ID}" \
    --private-dns-enabled \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-ecr-dkr-endpoint},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]"

log "ECR Docker VPC endpoint created"

# CloudWatch Logs Interface Endpoint
aws ec2 create-vpc-endpoint \
    --vpc-id "${VPC_ID}" \
    --vpc-endpoint-type Interface \
    --service-name "com.amazonaws.${AWS_REGION}.logs" \
    --subnet-ids "${PRIVATE_SUBNET_1_ID}" "${PRIVATE_SUBNET_2_ID}" "${PRIVATE_SUBNET_3_ID}" \
    --security-group-ids "${VPCE_SG_ID}" \
    --private-dns-enabled \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-logs-endpoint},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]"

log "CloudWatch Logs VPC endpoint created"

# SSM Interface Endpoint (for ECS Exec and Secrets)
aws ec2 create-vpc-endpoint \
    --vpc-id "${VPC_ID}" \
    --vpc-endpoint-type Interface \
    --service-name "com.amazonaws.${AWS_REGION}.ssm" \
    --subnet-ids "${PRIVATE_SUBNET_1_ID}" "${PRIVATE_SUBNET_2_ID}" "${PRIVATE_SUBNET_3_ID}" \
    --security-group-ids "${VPCE_SG_ID}" \
    --private-dns-enabled \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-ssm-endpoint},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]"

log "SSM VPC endpoint created"

# Secrets Manager Interface Endpoint
aws ec2 create-vpc-endpoint \
    --vpc-id "${VPC_ID}" \
    --vpc-endpoint-type Interface \
    --service-name "com.amazonaws.${AWS_REGION}.secretsmanager" \
    --subnet-ids "${PRIVATE_SUBNET_1_ID}" "${PRIVATE_SUBNET_2_ID}" "${PRIVATE_SUBNET_3_ID}" \
    --security-group-ids "${VPCE_SG_ID}" \
    --private-dns-enabled \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-secretsmanager-endpoint},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]"

log "Secrets Manager VPC endpoint created"

# -----------------------------------------------------------------------------
# Enable VPC Flow Logs
# -----------------------------------------------------------------------------
log "Enabling VPC Flow Logs for security monitoring"

# Create CloudWatch Log Group for Flow Logs
aws logs create-log-group \
    --log-group-name "/vpc/${RESOURCE_PREFIX}/flow-logs" \
    --tags Project="${TAG_PROJECT}",Environment="${TAG_ENVIRONMENT}" \
    2>/dev/null || log "Flow logs log group already exists"

aws logs put-retention-policy \
    --log-group-name "/vpc/${RESOURCE_PREFIX}/flow-logs" \
    --retention-in-days 30

# Create IAM role for flow logs
FLOW_LOGS_ROLE_NAME="${RESOURCE_PREFIX}-flow-logs-role"

cat > /tmp/flow-logs-trust-policy.json << EOF
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

aws iam create-role \
    --role-name "${FLOW_LOGS_ROLE_NAME}" \
    --assume-role-policy-document file:///tmp/flow-logs-trust-policy.json \
    --description "Role for VPC Flow Logs" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" \
    2>/dev/null || log "Flow logs role already exists"

cat > /tmp/flow-logs-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
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

aws iam put-role-policy \
    --role-name "${FLOW_LOGS_ROLE_NAME}" \
    --policy-name "flow-logs-policy" \
    --policy-document file:///tmp/flow-logs-policy.json

# Wait for role to be available
sleep 10

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create Flow Log
aws ec2 create-flow-logs \
    --resource-type VPC \
    --resource-ids "${VPC_ID}" \
    --traffic-type ALL \
    --log-group-name "/vpc/${RESOURCE_PREFIX}/flow-logs" \
    --deliver-logs-permission-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${FLOW_LOGS_ROLE_NAME}" \
    --tag-specifications "ResourceType=vpc-flow-log,Tags=[{Key=Name,Value=${RESOURCE_PREFIX}-flow-logs},{Key=Project,Value=${TAG_PROJECT}},{Key=Environment,Value=${TAG_ENVIRONMENT}}]"

log "VPC Flow Logs enabled"

# Clean up temp files
rm -f /tmp/flow-logs-trust-policy.json /tmp/flow-logs-policy.json

# -----------------------------------------------------------------------------
# Save Resource IDs
# -----------------------------------------------------------------------------
cat > "${SCRIPT_DIR}/vpc-outputs.env" << EOF
# VPC Resources - Generated by 03-create-vpc.sh
# Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Environment: ${ENVIRONMENT}

export VPC_ID="${VPC_ID}"
export IGW_ID="${IGW_ID}"

# NAT Gateways (one per AZ for HA)
export NAT_GW_1_ID="${NAT_GW_1_ID}"
export NAT_GW_2_ID="${NAT_GW_2_ID}"
export NAT_GW_3_ID="${NAT_GW_3_ID}"
export EIP_ALLOC_1_ID="${EIP_ALLOC_1_ID}"
export EIP_ALLOC_2_ID="${EIP_ALLOC_2_ID}"
export EIP_ALLOC_3_ID="${EIP_ALLOC_3_ID}"

# Public Subnets (3 AZs)
export PUBLIC_SUBNET_1_ID="${PUBLIC_SUBNET_1_ID}"
export PUBLIC_SUBNET_2_ID="${PUBLIC_SUBNET_2_ID}"
export PUBLIC_SUBNET_3_ID="${PUBLIC_SUBNET_3_ID}"

# Private Subnets (3 AZs)
export PRIVATE_SUBNET_1_ID="${PRIVATE_SUBNET_1_ID}"
export PRIVATE_SUBNET_2_ID="${PRIVATE_SUBNET_2_ID}"
export PRIVATE_SUBNET_3_ID="${PRIVATE_SUBNET_3_ID}"

# Route Tables
export PUBLIC_RT_ID="${PUBLIC_RT_ID}"
export PRIVATE_RT_1_ID="${PRIVATE_RT_1_ID}"
export PRIVATE_RT_2_ID="${PRIVATE_RT_2_ID}"
export PRIVATE_RT_3_ID="${PRIVATE_RT_3_ID}"

# Security Groups
export ALB_SG_ID="${ALB_SG_ID}"
export ECS_SG_ID="${ECS_SG_ID}"
export RDS_SG_ID="${RDS_SG_ID}"
export REDIS_SG_ID="${REDIS_SG_ID}"
export VPCE_SG_ID="${VPCE_SG_ID}"
EOF

log "Resource IDs saved to vpc-outputs.env"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "VPC Created Successfully (Production)"
echo "============================================================================="
echo "VPC ID:              ${VPC_ID}"
echo "Internet Gateway:    ${IGW_ID}"
echo ""
echo "NAT Gateways (HA - one per AZ):"
echo "  - AZ1: ${NAT_GW_1_ID}"
echo "  - AZ2: ${NAT_GW_2_ID}"
echo "  - AZ3: ${NAT_GW_3_ID}"
echo ""
echo "Public Subnets (3 AZs):"
echo "  - ${PUBLIC_SUBNET_1_ID} (${AVAILABILITY_ZONE_1})"
echo "  - ${PUBLIC_SUBNET_2_ID} (${AVAILABILITY_ZONE_2})"
echo "  - ${PUBLIC_SUBNET_3_ID} (${AVAILABILITY_ZONE_3})"
echo ""
echo "Private Subnets (3 AZs):"
echo "  - ${PRIVATE_SUBNET_1_ID} (${AVAILABILITY_ZONE_1})"
echo "  - ${PRIVATE_SUBNET_2_ID} (${AVAILABILITY_ZONE_2})"
echo "  - ${PRIVATE_SUBNET_3_ID} (${AVAILABILITY_ZONE_3})"
echo ""
echo "Security Groups:"
echo "  - ALB:   ${ALB_SG_ID}"
echo "  - ECS:   ${ECS_SG_ID}"
echo "  - RDS:   ${RDS_SG_ID}"
echo "  - Redis: ${REDIS_SG_ID}"
echo "  - VPCE:  ${VPCE_SG_ID}"
echo ""
echo "VPC Endpoints Created:"
echo "  - S3 (Gateway)"
echo "  - DynamoDB (Gateway)"
echo "  - ECR API (Interface)"
echo "  - ECR Docker (Interface)"
echo "  - CloudWatch Logs (Interface)"
echo "  - SSM (Interface)"
echo "  - Secrets Manager (Interface)"
echo ""
echo "VPC Flow Logs: Enabled"
echo ""
echo "Next step: ./04-create-rds.sh"
echo "============================================================================="
