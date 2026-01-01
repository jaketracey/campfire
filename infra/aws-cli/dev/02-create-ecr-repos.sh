#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create ECR Repositories
# =============================================================================
# Creates ECR repositories for all service container images
#
# Usage: ./02-create-ecr-repos.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "Creating ECR repositories for environment: ${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# Function to create ECR repository
# -----------------------------------------------------------------------------
create_ecr_repo() {
    local repo_name="$1"
    local scan_on_push="${2:-true}"

    log "Creating ECR repository: ${repo_name}"

    # Check if repository exists
    if aws ecr describe-repositories --repository-names "${repo_name}" 2>/dev/null; then
        log "Repository ${repo_name} already exists, skipping creation"
    else
        aws ecr create-repository \
            --repository-name "${repo_name}" \
            --image-scanning-configuration scanOnPush="${scan_on_push}" \
            --image-tag-mutability MUTABLE \
            --encryption-configuration encryptionType=AES256 \
            --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

        log "Repository ${repo_name} created successfully"
    fi

    # Set lifecycle policy to clean up old images
    aws ecr put-lifecycle-policy \
        --repository-name "${repo_name}" \
        --lifecycle-policy-text '{
            "rules": [
                {
                    "rulePriority": 1,
                    "description": "Keep last 10 production images",
                    "selection": {
                        "tagStatus": "tagged",
                        "tagPrefixList": ["prod-", "v"],
                        "countType": "imageCountMoreThan",
                        "countNumber": 10
                    },
                    "action": {
                        "type": "expire"
                    }
                },
                {
                    "rulePriority": 2,
                    "description": "Keep last 5 dev images",
                    "selection": {
                        "tagStatus": "tagged",
                        "tagPrefixList": ["dev-", "staging-"],
                        "countType": "imageCountMoreThan",
                        "countNumber": 5
                    },
                    "action": {
                        "type": "expire"
                    }
                },
                {
                    "rulePriority": 3,
                    "description": "Delete untagged images older than 7 days",
                    "selection": {
                        "tagStatus": "untagged",
                        "countType": "sinceImagePushed",
                        "countUnit": "days",
                        "countNumber": 7
                    },
                    "action": {
                        "type": "expire"
                    }
                }
            ]
        }'

    log "Lifecycle policy applied to ${repo_name}"
}

# -----------------------------------------------------------------------------
# Create Repositories for Each Service
# -----------------------------------------------------------------------------

create_ecr_repo "${ECR_GATEWAY_REPO}"
create_ecr_repo "${ECR_ORCHESTRATOR_REPO}"
create_ecr_repo "${ECR_WEB_REPO}"
create_ecr_repo "${ECR_MARKETING_REPO}"
create_ecr_repo "${ECR_WORKERS_REPO}"

# -----------------------------------------------------------------------------
# Get ECR Login Command
# -----------------------------------------------------------------------------
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "ECR Repositories Created Successfully"
echo "============================================================================="
echo "ECR Registry: ${ECR_REGISTRY}"
echo ""
echo "Repositories:"
echo "  - ${ECR_GATEWAY_REPO}"
echo "  - ${ECR_ORCHESTRATOR_REPO}"
echo "  - ${ECR_WEB_REPO}"
echo "  - ${ECR_MARKETING_REPO}"
echo "  - ${ECR_WORKERS_REPO}"
echo ""
echo "To login to ECR:"
echo "  aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}"
echo ""
echo "To push an image:"
echo "  docker tag <image>:latest ${ECR_REGISTRY}/${ECR_GATEWAY_REPO}:latest"
echo "  docker push ${ECR_REGISTRY}/${ECR_GATEWAY_REPO}:latest"
echo ""
echo "Next step: ./03-create-vpc.sh"
echo "============================================================================="
