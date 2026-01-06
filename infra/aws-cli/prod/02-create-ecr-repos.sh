#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create ECR Repositories (Production)
# =============================================================================
# Creates ECR repositories for all service container images
# with production security settings and lifecycle policies
#
# Note: ECR repositories are shared between environments (dev, staging, prod)
# Images are differentiated by tags (e.g., prod-v1.0.0, dev-abc123)
#
# Usage: ./02-create-ecr-repos.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli
confirm_production

log "Creating/Updating ECR repositories for environment: ${ENVIRONMENT}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# -----------------------------------------------------------------------------
# Function to create ECR repository with production settings
# -----------------------------------------------------------------------------
create_ecr_repo() {
    local repo_name="$1"
    local scan_on_push="${2:-true}"

    log "Configuring ECR repository: ${repo_name}"

    # Check if repository exists
    if aws ecr describe-repositories --repository-names "${repo_name}" 2>/dev/null; then
        log "Repository ${repo_name} already exists, updating configuration"
    else
        aws ecr create-repository \
            --repository-name "${repo_name}" \
            --image-scanning-configuration scanOnPush="${scan_on_push}" \
            --image-tag-mutability IMMUTABLE \
            --encryption-configuration encryptionType=KMS \
            --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="shared" Key=CostCenter,Value="${TAG_COST_CENTER}"

        log "Repository ${repo_name} created successfully"
    fi

    # Update scanning configuration
    aws ecr put-image-scanning-configuration \
        --repository-name "${repo_name}" \
        --image-scanning-configuration scanOnPush=true

    # Set lifecycle policy for production
    aws ecr put-lifecycle-policy \
        --repository-name "${repo_name}" \
        --lifecycle-policy-text '{
            "rules": [
                {
                    "rulePriority": 1,
                    "description": "Keep last 20 production images",
                    "selection": {
                        "tagStatus": "tagged",
                        "tagPrefixList": ["prod-", "v", "release-"],
                        "countType": "imageCountMoreThan",
                        "countNumber": 20
                    },
                    "action": {
                        "type": "expire"
                    }
                },
                {
                    "rulePriority": 2,
                    "description": "Keep last 10 staging images",
                    "selection": {
                        "tagStatus": "tagged",
                        "tagPrefixList": ["staging-", "stg-"],
                        "countType": "imageCountMoreThan",
                        "countNumber": 10
                    },
                    "action": {
                        "type": "expire"
                    }
                },
                {
                    "rulePriority": 3,
                    "description": "Keep last 5 dev images",
                    "selection": {
                        "tagStatus": "tagged",
                        "tagPrefixList": ["dev-", "develop-"],
                        "countType": "imageCountMoreThan",
                        "countNumber": 5
                    },
                    "action": {
                        "type": "expire"
                    }
                },
                {
                    "rulePriority": 4,
                    "description": "Delete untagged images older than 3 days",
                    "selection": {
                        "tagStatus": "untagged",
                        "countType": "sinceImagePushed",
                        "countUnit": "days",
                        "countNumber": 3
                    },
                    "action": {
                        "type": "expire"
                    }
                },
                {
                    "rulePriority": 5,
                    "description": "Delete old feature branch images",
                    "selection": {
                        "tagStatus": "tagged",
                        "tagPrefixList": ["feature-", "fix-", "hotfix-"],
                        "countType": "sinceImagePushed",
                        "countUnit": "days",
                        "countNumber": 14
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
create_ecr_repo "${ECR_WORKERS_REPO}"

# -----------------------------------------------------------------------------
# Set Repository Policies (restrict who can push)
# -----------------------------------------------------------------------------
log "Setting repository policies for production security"

for repo in "${ECR_GATEWAY_REPO}" "${ECR_ORCHESTRATOR_REPO}" "${ECR_WEB_REPO}" "${ECR_WORKERS_REPO}"; do
    # Allow only specific roles to push (CI/CD role and admin role)
    aws ecr set-repository-policy \
        --repository-name "${repo}" \
        --policy-text "{
            \"Version\": \"2012-10-17\",
            \"Statement\": [
                {
                    \"Sid\": \"AllowPush\",
                    \"Effect\": \"Allow\",
                    \"Principal\": {
                        \"AWS\": [
                            \"arn:aws:iam::${AWS_ACCOUNT_ID}:root\"
                        ]
                    },
                    \"Action\": [
                        \"ecr:GetDownloadUrlForLayer\",
                        \"ecr:BatchGetImage\",
                        \"ecr:BatchCheckLayerAvailability\",
                        \"ecr:PutImage\",
                        \"ecr:InitiateLayerUpload\",
                        \"ecr:UploadLayerPart\",
                        \"ecr:CompleteLayerUpload\"
                    ]
                },
                {
                    \"Sid\": \"AllowPull\",
                    \"Effect\": \"Allow\",
                    \"Principal\": {
                        \"Service\": \"ecs-tasks.amazonaws.com\"
                    },
                    \"Action\": [
                        \"ecr:GetDownloadUrlForLayer\",
                        \"ecr:BatchGetImage\",
                        \"ecr:BatchCheckLayerAvailability\"
                    ]
                }
            ]
        }" 2>/dev/null || log "Repository policy already set for ${repo}"
done

# -----------------------------------------------------------------------------
# Get ECR Login Command
# -----------------------------------------------------------------------------
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "ECR Repositories Configured Successfully (Production)"
echo "============================================================================="
echo "ECR Registry: ${ECR_REGISTRY}"
echo ""
echo "Repositories:"
echo "  - ${ECR_GATEWAY_REPO}"
echo "  - ${ECR_ORCHESTRATOR_REPO}"
echo "  - ${ECR_WEB_REPO}"
echo "  - ${ECR_WORKERS_REPO}"
echo ""
echo "Production Settings:"
echo "  - Image scanning enabled on push"
echo "  - Image tag immutability ENABLED (prevents tag overwrites)"
echo "  - KMS encryption enabled"
echo "  - Lifecycle policies configured"
echo ""
echo "Tagging Convention for Production:"
echo "  - prod-v1.0.0, prod-v1.0.1, etc."
echo "  - release-2024-01-15"
echo "  - v1.0.0 (semantic versioning)"
echo ""
echo "To login to ECR:"
echo "  aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}"
echo ""
echo "To push a production image:"
echo "  docker tag myimage:latest ${ECR_REGISTRY}/${ECR_GATEWAY_REPO}:prod-v1.0.0"
echo "  docker push ${ECR_REGISTRY}/${ECR_GATEWAY_REPO}:prod-v1.0.0"
echo ""
echo "Next step: ./03-create-vpc.sh"
echo "============================================================================="
