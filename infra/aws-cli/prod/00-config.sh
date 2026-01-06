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
# Shared Helpers
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../_shared/common.sh"

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
