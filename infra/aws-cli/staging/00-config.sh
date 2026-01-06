#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Staging Environment Configuration
# =============================================================================
# This file contains all configuration variables for the staging environment.
# Staging mirrors production as closely as possible while keeping costs lower.
# Source this file before running any other scripts.
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# AWS Configuration
# -----------------------------------------------------------------------------
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_PROFILE="${AWS_PROFILE:-campfire-staging}"

# -----------------------------------------------------------------------------
# Project Configuration
# -----------------------------------------------------------------------------
export PROJECT_NAME="campfire"
export ENVIRONMENT="staging"
export RESOURCE_PREFIX="${PROJECT_NAME}-${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# VPC Configuration
# Uses different CIDR range to avoid conflicts if peering with dev/prod
# -----------------------------------------------------------------------------
export VPC_CIDR="10.1.0.0/16"
export PUBLIC_SUBNET_1_CIDR="10.1.1.0/24"
export PUBLIC_SUBNET_2_CIDR="10.1.2.0/24"
export PRIVATE_SUBNET_1_CIDR="10.1.10.0/24"
export PRIVATE_SUBNET_2_CIDR="10.1.11.0/24"
export AVAILABILITY_ZONE_1="${AWS_REGION}a"
export AVAILABILITY_ZONE_2="${AWS_REGION}b"

# -----------------------------------------------------------------------------
# S3 Bucket Names (separate from dev for data isolation)
# -----------------------------------------------------------------------------
export S3_MEDIA_BUCKET="${RESOURCE_PREFIX}-media"
export S3_VAULT_BUCKET="${RESOURCE_PREFIX}-vault"

# -----------------------------------------------------------------------------
# ECR Repository Names (separate from dev for image isolation)
# -----------------------------------------------------------------------------
export ECR_GATEWAY_REPO="${RESOURCE_PREFIX}/gateway"
export ECR_ORCHESTRATOR_REPO="${RESOURCE_PREFIX}/orchestrator"
export ECR_WEB_REPO="${RESOURCE_PREFIX}/web"
export ECR_WORKERS_REPO="${RESOURCE_PREFIX}/workers"

# -----------------------------------------------------------------------------
# RDS Configuration (larger than dev, production-like settings)
# -----------------------------------------------------------------------------
export RDS_INSTANCE_CLASS="db.t3.large"
export RDS_ENGINE="postgres"
export RDS_ENGINE_VERSION="16.4"
export RDS_DB_NAME="campfire"
export RDS_MASTER_USERNAME="campfire_admin"
export RDS_ALLOCATED_STORAGE="50"
export RDS_MAX_ALLOCATED_STORAGE="200"
export RDS_INSTANCE_IDENTIFIER="${RESOURCE_PREFIX}-postgres"
export RDS_MULTI_AZ="false"  # Set to true for production-like HA testing
export RDS_BACKUP_RETENTION="14"  # Longer retention than dev

# -----------------------------------------------------------------------------
# ECS Configuration (slightly higher resources than dev)
# -----------------------------------------------------------------------------
export ECS_CLUSTER_NAME="${RESOURCE_PREFIX}-cluster"
export ECS_TASK_CPU="512"
export ECS_TASK_MEMORY="1024"

# Service-specific resource allocations (higher than dev)
export GATEWAY_CPU="512"
export GATEWAY_MEMORY="1024"
export GATEWAY_DESIRED_COUNT="2"
export GATEWAY_MIN_COUNT="2"
export GATEWAY_MAX_COUNT="6"

export ORCHESTRATOR_CPU="1024"
export ORCHESTRATOR_MEMORY="2048"
export ORCHESTRATOR_DESIRED_COUNT="2"
export ORCHESTRATOR_MIN_COUNT="2"
export ORCHESTRATOR_MAX_COUNT="8"

export WEB_CPU="512"
export WEB_MEMORY="1024"
export WEB_DESIRED_COUNT="2"
export WEB_MIN_COUNT="2"
export WEB_MAX_COUNT="6"

export WORKERS_CPU="512"
export WORKERS_MEMORY="1024"
export WORKERS_DESIRED_COUNT="2"
export WORKERS_MIN_COUNT="1"
export WORKERS_MAX_COUNT="6"

# -----------------------------------------------------------------------------
# ALB Configuration
# -----------------------------------------------------------------------------
export ALB_NAME="${RESOURCE_PREFIX}-alb"
export ALB_INTERNAL="false"
export ALB_DELETION_PROTECTION="true"  # Production-like protection

# -----------------------------------------------------------------------------
# CloudWatch Configuration (longer retention than dev)
# -----------------------------------------------------------------------------
export LOG_RETENTION_DAYS="30"

# -----------------------------------------------------------------------------
# Security Configuration (production-like settings)
# -----------------------------------------------------------------------------
export ENABLE_WAF="true"
export ENABLE_SHIELD="false"  # Shield Advanced is expensive
export ENABLE_GUARD_DUTY="true"
export SSL_POLICY="ELBSecurityPolicy-TLS13-1-2-2021-06"

# -----------------------------------------------------------------------------
# Auto-scaling Configuration
# -----------------------------------------------------------------------------
export AUTOSCALING_ENABLED="true"
export AUTOSCALING_CPU_TARGET="70"
export AUTOSCALING_MEMORY_TARGET="70"
export AUTOSCALING_SCALE_IN_COOLDOWN="300"
export AUTOSCALING_SCALE_OUT_COOLDOWN="60"

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------
export TAG_PROJECT="${PROJECT_NAME}"
export TAG_ENVIRONMENT="${ENVIRONMENT}"
export TAG_MANAGED_BY="aws-cli"
export TAG_COST_CENTER="staging-infrastructure"

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

# Print a formatted message
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Print error message and exit
error() {
    echo "[ERROR] $1" >&2
    exit 1
}

# Print warning message
warn() {
    echo "[WARN] $1" >&2
}

# Check if AWS CLI is configured
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        error "AWS CLI is not installed. Please install it first."
    fi

    if ! aws sts get-caller-identity &> /dev/null; then
        error "AWS CLI is not configured. Please run 'aws configure' first."
    fi

    log "AWS CLI configured for account: $(aws sts get-caller-identity --query Account --output text)"
}

# Generate common tags JSON
get_tags() {
    cat <<EOF
[
    {"Key": "Project", "Value": "${TAG_PROJECT}"},
    {"Key": "Environment", "Value": "${TAG_ENVIRONMENT}"},
    {"Key": "ManagedBy", "Value": "${TAG_MANAGED_BY}"},
    {"Key": "CostCenter", "Value": "${TAG_COST_CENTER}"}
]
EOF
}

# Wait for resource to be available
wait_for_resource() {
    local resource_type="$1"
    local resource_id="$2"
    local max_attempts="${3:-30}"
    local sleep_time="${4:-10}"

    log "Waiting for ${resource_type} ${resource_id} to be available..."

    for ((i=1; i<=max_attempts; i++)); do
        case "${resource_type}" in
            "rds")
                status=$(aws rds describe-db-instances \
                    --db-instance-identifier "${resource_id}" \
                    --query 'DBInstances[0].DBInstanceStatus' \
                    --output text 2>/dev/null || echo "pending")
                ;;
            *)
                status="available"
                ;;
        esac

        if [[ "${status}" == "available" ]]; then
            log "${resource_type} ${resource_id} is now available"
            return 0
        fi

        log "Status: ${status}. Attempt ${i}/${max_attempts}. Waiting ${sleep_time}s..."
        sleep "${sleep_time}"
    done

    error "Timeout waiting for ${resource_type} ${resource_id}"
}

# Confirm action before proceeding (for destructive operations)
confirm_action() {
    local message="$1"
    read -p "[CONFIRM] ${message} (y/N): " response
    case "${response}" in
        [yY][eE][sS]|[yY])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

log "Configuration loaded for environment: ${ENVIRONMENT}"
log "Resource prefix: ${RESOURCE_PREFIX}"
