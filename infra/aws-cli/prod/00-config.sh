#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Production Environment Configuration
# =============================================================================
# This file contains all configuration variables for the production environment.
# Source this file before running any other scripts.
#
# IMPORTANT: Production environment - review all settings before deployment!
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# AWS Configuration
# -----------------------------------------------------------------------------
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_PROFILE="${AWS_PROFILE:-campfire-prod}"

# -----------------------------------------------------------------------------
# Project Configuration
# -----------------------------------------------------------------------------
export PROJECT_NAME="campfire"
export ENVIRONMENT="prod"
export RESOURCE_PREFIX="${PROJECT_NAME}-${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# VPC Configuration (Production uses different CIDR to avoid conflicts)
# -----------------------------------------------------------------------------
export VPC_CIDR="10.1.0.0/16"
export PUBLIC_SUBNET_1_CIDR="10.1.1.0/24"
export PUBLIC_SUBNET_2_CIDR="10.1.2.0/24"
export PUBLIC_SUBNET_3_CIDR="10.1.3.0/24"
export PRIVATE_SUBNET_1_CIDR="10.1.10.0/24"
export PRIVATE_SUBNET_2_CIDR="10.1.11.0/24"
export PRIVATE_SUBNET_3_CIDR="10.1.12.0/24"
export AVAILABILITY_ZONE_1="${AWS_REGION}a"
export AVAILABILITY_ZONE_2="${AWS_REGION}b"
export AVAILABILITY_ZONE_3="${AWS_REGION}c"

# -----------------------------------------------------------------------------
# S3 Bucket Names
# -----------------------------------------------------------------------------
export S3_MEDIA_BUCKET="${RESOURCE_PREFIX}-media"
export S3_VAULT_BUCKET="${RESOURCE_PREFIX}-vault"
export S3_LOGS_BUCKET="${RESOURCE_PREFIX}-logs"
export S3_BACKUPS_BUCKET="${RESOURCE_PREFIX}-backups"

# -----------------------------------------------------------------------------
# ECR Repository Names (shared between environments)
# -----------------------------------------------------------------------------
export ECR_GATEWAY_REPO="${PROJECT_NAME}/gateway"
export ECR_ORCHESTRATOR_REPO="${PROJECT_NAME}/orchestrator"
export ECR_WEB_REPO="${PROJECT_NAME}/web"
export ECR_MARKETING_REPO="${PROJECT_NAME}/marketing"
export ECR_WORKERS_REPO="${PROJECT_NAME}/workers"

# -----------------------------------------------------------------------------
# RDS Configuration (Production - Multi-AZ, larger instance)
# -----------------------------------------------------------------------------
export RDS_INSTANCE_CLASS="db.r6g.large"
export RDS_ENGINE="postgres"
export RDS_ENGINE_VERSION="16.4"
export RDS_DB_NAME="campfire"
export RDS_MASTER_USERNAME="campfire_admin"
export RDS_ALLOCATED_STORAGE="100"
export RDS_MAX_ALLOCATED_STORAGE="500"
export RDS_INSTANCE_IDENTIFIER="${RESOURCE_PREFIX}-postgres"
export RDS_MULTI_AZ="true"
export RDS_BACKUP_RETENTION_DAYS="30"
export RDS_PERFORMANCE_INSIGHTS_RETENTION="31"
export RDS_DELETION_PROTECTION="true"

# -----------------------------------------------------------------------------
# ElastiCache Redis Configuration (Production)
# -----------------------------------------------------------------------------
export REDIS_NODE_TYPE="cache.r6g.large"
export REDIS_NUM_CACHE_CLUSTERS="2"
export REDIS_REPLICATION_GROUP_ID="${RESOURCE_PREFIX}-redis"

# -----------------------------------------------------------------------------
# ECS Configuration (Production - higher resources)
# -----------------------------------------------------------------------------
export ECS_CLUSTER_NAME="${RESOURCE_PREFIX}-cluster"

# Service-specific resource allocations (Production values)
export GATEWAY_CPU="512"
export GATEWAY_MEMORY="1024"
export GATEWAY_DESIRED_COUNT="3"
export GATEWAY_MIN_COUNT="2"
export GATEWAY_MAX_COUNT="10"

export ORCHESTRATOR_CPU="1024"
export ORCHESTRATOR_MEMORY="2048"
export ORCHESTRATOR_DESIRED_COUNT="3"
export ORCHESTRATOR_MIN_COUNT="2"
export ORCHESTRATOR_MAX_COUNT="10"

export WEB_CPU="512"
export WEB_MEMORY="1024"
export WEB_DESIRED_COUNT="3"
export WEB_MIN_COUNT="2"
export WEB_MAX_COUNT="10"

export MARKETING_CPU="256"
export MARKETING_MEMORY="512"
export MARKETING_DESIRED_COUNT="2"
export MARKETING_MIN_COUNT="1"
export MARKETING_MAX_COUNT="5"

export WORKERS_CPU="512"
export WORKERS_MEMORY="1024"
export WORKERS_DESIRED_COUNT="2"
export WORKERS_MIN_COUNT="1"
export WORKERS_MAX_COUNT="10"

# -----------------------------------------------------------------------------
# ALB Configuration
# -----------------------------------------------------------------------------
export ALB_NAME="${RESOURCE_PREFIX}-alb"
export ALB_INTERNAL="false"
export ALB_IDLE_TIMEOUT="60"
export ALB_ENABLE_HTTP2="true"
export ALB_ENABLE_WAF="true"

# SSL/TLS Configuration
# IMPORTANT: Update this with your actual ACM certificate ARN
export ACM_CERTIFICATE_ARN="${ACM_CERTIFICATE_ARN:-}"
export SSL_POLICY="ELBSecurityPolicy-TLS13-1-2-2021-06"

# Domain Configuration
export DOMAIN_NAME="${DOMAIN_NAME:-}"
export API_DOMAIN_NAME="${API_DOMAIN_NAME:-}"

# -----------------------------------------------------------------------------
# CloudWatch Configuration (Production - longer retention)
# -----------------------------------------------------------------------------
export LOG_RETENTION_DAYS="90"

# -----------------------------------------------------------------------------
# Auto Scaling Configuration
# -----------------------------------------------------------------------------
export AUTOSCALING_TARGET_CPU="70"
export AUTOSCALING_TARGET_MEMORY="80"
export AUTOSCALING_SCALE_IN_COOLDOWN="300"
export AUTOSCALING_SCALE_OUT_COOLDOWN="60"

# -----------------------------------------------------------------------------
# Tags (Production includes cost allocation tags)
# -----------------------------------------------------------------------------
export TAG_PROJECT="${PROJECT_NAME}"
export TAG_ENVIRONMENT="${ENVIRONMENT}"
export TAG_MANAGED_BY="aws-cli"
export TAG_COST_CENTER="${COST_CENTER:-engineering}"
export TAG_OWNER="${OWNER:-platform-team}"

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

# Confirm production deployment
confirm_production() {
    if [[ "${SKIP_CONFIRMATION:-false}" != "true" ]]; then
        echo ""
        echo "=========================================="
        echo "  WARNING: PRODUCTION ENVIRONMENT"
        echo "=========================================="
        echo ""
        echo "You are about to make changes to the PRODUCTION environment."
        echo "Region: ${AWS_REGION}"
        echo "Account: $(aws sts get-caller-identity --query Account --output text)"
        echo ""
        read -p "Are you sure you want to continue? (type 'yes' to confirm): " confirmation
        if [[ "${confirmation}" != "yes" ]]; then
            error "Deployment cancelled by user"
        fi
    fi
}

# Generate common tags JSON
get_tags() {
    cat <<EOF
[
    {"Key": "Project", "Value": "${TAG_PROJECT}"},
    {"Key": "Environment", "Value": "${TAG_ENVIRONMENT}"},
    {"Key": "ManagedBy", "Value": "${TAG_MANAGED_BY}"},
    {"Key": "CostCenter", "Value": "${TAG_COST_CENTER}"},
    {"Key": "Owner", "Value": "${TAG_OWNER}"}
]
EOF
}

# Generate common tags for CLI commands
get_tags_cli() {
    echo "Key=Project,Value=${TAG_PROJECT} Key=Environment,Value=${TAG_ENVIRONMENT} Key=ManagedBy,Value=${TAG_MANAGED_BY} Key=CostCenter,Value=${TAG_COST_CENTER} Key=Owner,Value=${TAG_OWNER}"
}

# Wait for resource to be available
wait_for_resource() {
    local resource_type="$1"
    local resource_id="$2"
    local max_attempts="${3:-60}"
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
            "elasticache")
                status=$(aws elasticache describe-replication-groups \
                    --replication-group-id "${resource_id}" \
                    --query 'ReplicationGroups[0].Status' \
                    --output text 2>/dev/null || echo "creating")
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

# Check if SSL certificate is configured
check_ssl_certificate() {
    if [[ -z "${ACM_CERTIFICATE_ARN}" ]]; then
        warn "ACM_CERTIFICATE_ARN is not set. HTTPS listener will not be created."
        warn "Set ACM_CERTIFICATE_ARN environment variable to enable HTTPS."
        return 1
    fi
    return 0
}

log "Configuration loaded for environment: ${ENVIRONMENT}"
log "IMPORTANT: This is the PRODUCTION environment configuration"
