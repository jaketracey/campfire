#!/bin/bash
# Campfire Stealth Launch Configuration
# ~$15/month single EC2 instance deployment

set -euo pipefail

# =============================================================================
# ENVIRONMENT
# =============================================================================
export ENV="stealth"
export PROJECT_NAME="campfire"
export AWS_REGION="${AWS_REGION:-us-east-1}"

# =============================================================================
# NETWORKING
# =============================================================================
export VPC_CIDR="10.100.0.0/16"
export PUBLIC_SUBNET_CIDR="10.100.1.0/24"
export AVAILABILITY_ZONE="${AWS_REGION}a"

# =============================================================================
# EC2 INSTANCE
# =============================================================================
# t4g.medium: 2 vCPU, 4GB RAM, ARM64 - $24.53/month
export INSTANCE_TYPE="t4g.medium"
export EBS_VOLUME_SIZE="30"  # GB
export EBS_VOLUME_TYPE="gp3"
# Amazon Linux 2023 ARM64 - will be resolved dynamically
export AMI_FILTER="al2023-ami-*-arm64"

# =============================================================================
# S3 STORAGE
# =============================================================================
export S3_MEDIA_BUCKET="${PROJECT_NAME}-${ENV}-media"

# =============================================================================
# SSH TUNNEL TO HOME SERVER
# =============================================================================
# Replace with your actual dynamic DNS hostname
export HOME_SERVER_HOST="${HOME_SERVER_HOST:-jake.home.duckdns.org}"
export HOME_SERVER_PORT="${HOME_SERVER_PORT:-2222}"
export HOME_SERVER_USER="${HOME_SERVER_USER:-jake}"

# =============================================================================
# APPLICATION PORTS
# =============================================================================
export GATEWAY_PORT="4000"
export GATEWAY_WS_PORT="4001"
export WEB_PORT="3000"
export WORKERS_PORT="8080"
export POSTGRES_PORT="5432"
export REDIS_PORT="6379"

# Ollama/ComfyUI (tunneled from home server)
export OLLAMA_PORT="11434"
export COMFYUI_PORT="8188"

# =============================================================================
# DOMAIN & SSL
# =============================================================================
# SSL handled by Cloudflare, Nginx handles HTTP only
export DOMAIN="campfire.noice.work"

# =============================================================================
# RESOURCE TAGS
# =============================================================================
# Tags as JSON array format for --tag-specifications
export TAGS="{Key=Project,Value=${PROJECT_NAME}},{Key=Environment,Value=${ENV}}"

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
    exit 1
}

check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        error "AWS CLI is not installed. Please install it first."
    fi

    if ! aws sts get-caller-identity &> /dev/null; then
        error "AWS credentials not configured. Run 'aws configure' first."
    fi

    log "AWS CLI configured for account: $(aws sts get-caller-identity --query Account --output text)"
}

get_resource_id() {
    local resource_type=$1
    local name=$2

    case $resource_type in
        vpc)
            aws ec2 describe-vpcs \
                --filters "Name=tag:Name,Values=${name}" \
                --query 'Vpcs[0].VpcId' \
                --output text 2>/dev/null || echo "None"
            ;;
        subnet)
            aws ec2 describe-subnets \
                --filters "Name=tag:Name,Values=${name}" \
                --query 'Subnets[0].SubnetId' \
                --output text 2>/dev/null || echo "None"
            ;;
        igw)
            aws ec2 describe-internet-gateways \
                --filters "Name=tag:Name,Values=${name}" \
                --query 'InternetGateways[0].InternetGatewayId' \
                --output text 2>/dev/null || echo "None"
            ;;
        sg)
            aws ec2 describe-security-groups \
                --filters "Name=tag:Name,Values=${name}" \
                --query 'SecurityGroups[0].GroupId' \
                --output text 2>/dev/null || echo "None"
            ;;
        instance)
            aws ec2 describe-instances \
                --filters "Name=tag:Name,Values=${name}" "Name=instance-state-name,Values=running,pending" \
                --query 'Reservations[0].Instances[0].InstanceId' \
                --output text 2>/dev/null || echo "None"
            ;;
        eip)
            aws ec2 describe-addresses \
                --filters "Name=tag:Name,Values=${name}" \
                --query 'Addresses[0].AllocationId' \
                --output text 2>/dev/null || echo "None"
            ;;
    esac
}

wait_for_instance() {
    local instance_id=$1
    log "Waiting for instance ${instance_id} to be running..."
    aws ec2 wait instance-running --instance-ids "$instance_id"
    log "Instance is running"

    log "Waiting for instance status checks..."
    aws ec2 wait instance-status-ok --instance-ids "$instance_id"
    log "Instance status checks passed"
}

# =============================================================================
# NAMING CONVENTION
# =============================================================================
export VPC_NAME="${PROJECT_NAME}-${ENV}-vpc"
export SUBNET_NAME="${PROJECT_NAME}-${ENV}-public"
export IGW_NAME="${PROJECT_NAME}-${ENV}-igw"
export RTB_NAME="${PROJECT_NAME}-${ENV}-rtb"
export SG_NAME="${PROJECT_NAME}-${ENV}-sg"
export INSTANCE_NAME="${PROJECT_NAME}-${ENV}-instance"
export EIP_NAME="${PROJECT_NAME}-${ENV}-eip"
export KEY_NAME="${PROJECT_NAME}-${ENV}-key"

log "Loaded configuration for ${PROJECT_NAME} ${ENV} environment"
log "Region: ${AWS_REGION}, Instance: ${INSTANCE_TYPE}"
