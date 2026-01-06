#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Development Environment Configuration
# =============================================================================
# This file contains all configuration variables for the dev environment.
# Source this file before running any other scripts.
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# AWS Configuration
# -----------------------------------------------------------------------------
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_PROFILE="${AWS_PROFILE:-campfire-dev}"

# -----------------------------------------------------------------------------
# Project Configuration
# -----------------------------------------------------------------------------
export PROJECT_NAME="campfire"
export ENVIRONMENT="dev"
export RESOURCE_PREFIX="${PROJECT_NAME}-${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# VPC Configuration
# -----------------------------------------------------------------------------
export VPC_CIDR="10.0.0.0/16"
export PUBLIC_SUBNET_1_CIDR="10.0.1.0/24"
export PUBLIC_SUBNET_2_CIDR="10.0.2.0/24"
export PRIVATE_SUBNET_1_CIDR="10.0.10.0/24"
export PRIVATE_SUBNET_2_CIDR="10.0.11.0/24"
export AVAILABILITY_ZONE_1="${AWS_REGION}a"
export AVAILABILITY_ZONE_2="${AWS_REGION}b"

# -----------------------------------------------------------------------------
# S3 Bucket Names
# -----------------------------------------------------------------------------
export S3_MEDIA_BUCKET="${RESOURCE_PREFIX}-media"
export S3_VAULT_BUCKET="${RESOURCE_PREFIX}-vault"

# -----------------------------------------------------------------------------
# ECR Repository Names
# -----------------------------------------------------------------------------
export ECR_GATEWAY_REPO="${RESOURCE_PREFIX}/gateway"
export ECR_ORCHESTRATOR_REPO="${RESOURCE_PREFIX}/orchestrator"
export ECR_WEB_REPO="${RESOURCE_PREFIX}/web"
export ECR_WORKERS_REPO="${RESOURCE_PREFIX}/workers"

# -----------------------------------------------------------------------------
# RDS Configuration
# -----------------------------------------------------------------------------
export RDS_INSTANCE_CLASS="db.t3.medium"
export RDS_ENGINE="postgres"
export RDS_ENGINE_VERSION="16.4"  # Using 16.4 as closest available to 18.1
export RDS_DB_NAME="campfire"
export RDS_MASTER_USERNAME="campfire_admin"
export RDS_ALLOCATED_STORAGE="20"
export RDS_MAX_ALLOCATED_STORAGE="100"
export RDS_INSTANCE_IDENTIFIER="${RESOURCE_PREFIX}-postgres"

# -----------------------------------------------------------------------------
# ECS Configuration
# -----------------------------------------------------------------------------
export ECS_CLUSTER_NAME="${RESOURCE_PREFIX}-cluster"
export ECS_TASK_CPU="256"
export ECS_TASK_MEMORY="512"

# Service-specific resource allocations
export GATEWAY_CPU="256"
export GATEWAY_MEMORY="512"
export GATEWAY_DESIRED_COUNT="2"

export ORCHESTRATOR_CPU="512"
export ORCHESTRATOR_MEMORY="1024"
export ORCHESTRATOR_DESIRED_COUNT="2"

export WEB_CPU="256"
export WEB_MEMORY="512"
export WEB_DESIRED_COUNT="2"

export WORKERS_CPU="256"
export WORKERS_MEMORY="512"
export WORKERS_DESIRED_COUNT="1"

# -----------------------------------------------------------------------------
# ALB Configuration
# -----------------------------------------------------------------------------
export ALB_NAME="${RESOURCE_PREFIX}-alb"
export ALB_INTERNAL="false"

# -----------------------------------------------------------------------------
# CloudWatch Configuration
# -----------------------------------------------------------------------------
export LOG_RETENTION_DAYS="14"

# -----------------------------------------------------------------------------
# AI Inference Configuration
# -----------------------------------------------------------------------------
# Provider: ollama (local dev), bedrock (staging/prod)
export AI_INFERENCE_PROVIDER="${AI_INFERENCE_PROVIDER:-ollama}"
export BEDROCK_ENABLED="${BEDROCK_ENABLED:-false}"
export SAGEMAKER_ENABLED="${SAGEMAKER_ENABLED:-false}"

# Cost alert thresholds (USD)
export COST_ALERT_DAILY_THRESHOLD="${COST_ALERT_DAILY_THRESHOLD:-50}"
export COST_ALERT_MONTHLY_THRESHOLD="${COST_ALERT_MONTHLY_THRESHOLD:-500}"

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------
export TAG_PROJECT="${PROJECT_NAME}"
export TAG_ENVIRONMENT="${ENVIRONMENT}"
export TAG_MANAGED_BY="aws-cli"

# -----------------------------------------------------------------------------
# Shared Helpers
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../_shared/common.sh"

log "Configuration loaded for environment: ${ENVIRONMENT}"
