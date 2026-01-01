#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create GitHub Actions IAM Role
# =============================================================================
# Creates an IAM role for GitHub Actions to deploy via OIDC authentication.
# This eliminates the need to store long-lived AWS credentials in GitHub secrets.
#
# Prerequisites:
#   - GitHub OIDC provider must be configured in AWS (one-time per account)
#   - Repository must be configured in the role's trust policy
#
# Usage: ./11-create-github-actions-role.sh
#
# Required environment variables:
#   - GITHUB_ORG: GitHub organization or username
#   - GITHUB_REPO: Repository name (e.g., "campfire")
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

# Configuration
GITHUB_ORG="${GITHUB_ORG:-your-org}"
GITHUB_REPO="${GITHUB_REPO:-campfire}"
ROLE_NAME="github-actions-deploy"
OIDC_PROVIDER="token.actions.githubusercontent.com"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

log "Creating GitHub Actions deployment role for environment: ${ENVIRONMENT}"
log "GitHub Repository: ${GITHUB_ORG}/${GITHUB_REPO}"

# -----------------------------------------------------------------------------
# Step 1: Create OIDC Identity Provider (if not exists)
# -----------------------------------------------------------------------------
log "Checking for existing OIDC provider..."

OIDC_PROVIDER_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"

if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "${OIDC_PROVIDER_ARN}" 2>/dev/null; then
    log "OIDC provider already exists"
else
    log "Creating OIDC identity provider for GitHub Actions..."

    # Get GitHub's OIDC thumbprint
    # Note: GitHub's thumbprint is stable and can be hardcoded
    # See: https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/

    aws iam create-open-id-connect-provider \
        --url "https://${OIDC_PROVIDER}" \
        --client-id-list "sts.amazonaws.com" \
        --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Purpose,Value="GitHub Actions OIDC"

    log "OIDC provider created"
fi

# -----------------------------------------------------------------------------
# Step 2: Create Trust Policy
# -----------------------------------------------------------------------------
log "Creating trust policy for GitHub Actions..."

# Trust policy allows GitHub Actions from specific repo and branches
cat > /tmp/github-actions-trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "${OIDC_PROVIDER}:aud": "sts.amazonaws.com"
                },
                "StringLike": {
                    "${OIDC_PROVIDER}:sub": [
                        "repo:${GITHUB_ORG}/${GITHUB_REPO}:ref:refs/heads/main",
                        "repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:dev",
                        "repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:staging",
                        "repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:prod",
                        "repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:production",
                        "repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:production-rollback"
                    ]
                }
            }
        }
    ]
}
EOF

# -----------------------------------------------------------------------------
# Step 3: Create Permissions Policy
# -----------------------------------------------------------------------------
log "Creating permissions policy..."

cat > /tmp/github-actions-permissions-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "ECRLogin",
            "Effect": "Allow",
            "Action": [
                "ecr:GetAuthorizationToken"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ECRPushPull",
            "Effect": "Allow",
            "Action": [
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:CompleteLayerUpload",
                "ecr:DescribeImages",
                "ecr:DescribeRepositories",
                "ecr:GetDownloadUrlForLayer",
                "ecr:InitiateLayerUpload",
                "ecr:ListImages",
                "ecr:PutImage",
                "ecr:UploadLayerPart"
            ],
            "Resource": [
                "arn:aws:ecr:${AWS_REGION}:${AWS_ACCOUNT_ID}:repository/${PROJECT_NAME}-*"
            ]
        },
        {
            "Sid": "ECSDeployment",
            "Effect": "Allow",
            "Action": [
                "ecs:DescribeServices",
                "ecs:DescribeTaskDefinition",
                "ecs:DescribeTasks",
                "ecs:ListServices",
                "ecs:ListTaskDefinitions",
                "ecs:ListTasks",
                "ecs:RegisterTaskDefinition",
                "ecs:UpdateService",
                "ecs:CreateService",
                "ecs:TagResource"
            ],
            "Resource": "*",
            "Condition": {
                "StringEquals": {
                    "aws:ResourceTag/Project": "${PROJECT_NAME}"
                }
            }
        },
        {
            "Sid": "ECSClusterAccess",
            "Effect": "Allow",
            "Action": [
                "ecs:DescribeClusters"
            ],
            "Resource": [
                "arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/${PROJECT_NAME}-*"
            ]
        },
        {
            "Sid": "ECSTaskDefinitionAccess",
            "Effect": "Allow",
            "Action": [
                "ecs:DescribeTaskDefinition",
                "ecs:RegisterTaskDefinition",
                "ecs:ListTaskDefinitions"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ECSServiceAccess",
            "Effect": "Allow",
            "Action": [
                "ecs:DescribeServices",
                "ecs:UpdateService",
                "ecs:ListServices"
            ],
            "Resource": [
                "arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:service/${PROJECT_NAME}-*/*"
            ]
        },
        {
            "Sid": "IAMPassRole",
            "Effect": "Allow",
            "Action": [
                "iam:PassRole"
            ],
            "Resource": [
                "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${PROJECT_NAME}-*-ecs-*"
            ],
            "Condition": {
                "StringEquals": {
                    "iam:PassedToService": "ecs-tasks.amazonaws.com"
                }
            }
        },
        {
            "Sid": "CloudWatchLogs",
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogStream",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
                "logs:GetLogEvents",
                "logs:PutLogEvents",
                "logs:PutSequenceToken"
            ],
            "Resource": [
                "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/${PROJECT_NAME}/*",
                "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/ecs/${PROJECT_NAME}/*"
            ]
        },
        {
            "Sid": "CloudWatchLogsStream",
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": [
                "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/${PROJECT_NAME}/*:log-stream:*",
                "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/ecs/${PROJECT_NAME}/*:log-stream:*"
            ]
        },
        {
            "Sid": "LoadBalancerDescribe",
            "Effect": "Allow",
            "Action": [
                "elasticloadbalancing:DescribeLoadBalancers",
                "elasticloadbalancing:DescribeTargetGroups",
                "elasticloadbalancing:DescribeTargetHealth"
            ],
            "Resource": "*"
        },
        {
            "Sid": "SecretsManagerRead",
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue"
            ],
            "Resource": [
                "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${PROJECT_NAME}-*"
            ]
        },
        {
            "Sid": "SSMParameterRead",
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameter",
                "ssm:GetParameters",
                "ssm:GetParametersByPath"
            ],
            "Resource": [
                "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${PROJECT_NAME}/*"
            ]
        }
    ]
}
EOF

# -----------------------------------------------------------------------------
# Step 4: Create or Update IAM Role
# -----------------------------------------------------------------------------
log "Creating/updating IAM role: ${ROLE_NAME}"

if aws iam get-role --role-name "${ROLE_NAME}" 2>/dev/null; then
    log "Role exists, updating trust policy..."

    aws iam update-assume-role-policy \
        --role-name "${ROLE_NAME}" \
        --policy-document file:///tmp/github-actions-trust-policy.json
else
    log "Creating new role..."

    aws iam create-role \
        --role-name "${ROLE_NAME}" \
        --assume-role-policy-document file:///tmp/github-actions-trust-policy.json \
        --description "GitHub Actions deployment role for Campfire" \
        --max-session-duration 3600 \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Purpose,Value="GitHub Actions Deployment"
fi

# -----------------------------------------------------------------------------
# Step 5: Attach Permissions Policy
# -----------------------------------------------------------------------------
POLICY_NAME="${PROJECT_NAME}-github-actions-deploy-policy"
POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${POLICY_NAME}"

log "Creating/updating permissions policy: ${POLICY_NAME}"

# Check if policy exists
if aws iam get-policy --policy-arn "${POLICY_ARN}" 2>/dev/null; then
    log "Policy exists, creating new version..."

    # Delete oldest version if we're at the limit (5 versions)
    VERSIONS=$(aws iam list-policy-versions --policy-arn "${POLICY_ARN}" --query 'Versions[?IsDefaultVersion==`false`].VersionId' --output text)
    VERSION_COUNT=$(echo "${VERSIONS}" | wc -w)

    if [[ ${VERSION_COUNT} -ge 4 ]]; then
        OLDEST_VERSION=$(aws iam list-policy-versions --policy-arn "${POLICY_ARN}" --query 'Versions[-1].VersionId' --output text)
        aws iam delete-policy-version --policy-arn "${POLICY_ARN}" --version-id "${OLDEST_VERSION}"
    fi

    aws iam create-policy-version \
        --policy-arn "${POLICY_ARN}" \
        --policy-document file:///tmp/github-actions-permissions-policy.json \
        --set-as-default
else
    log "Creating new policy..."

    aws iam create-policy \
        --policy-name "${POLICY_NAME}" \
        --policy-document file:///tmp/github-actions-permissions-policy.json \
        --description "Permissions for GitHub Actions to deploy Campfire" \
        --tags Key=Project,Value="${TAG_PROJECT}"
fi

# Attach policy to role
aws iam attach-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-arn "${POLICY_ARN}"

log "Policy attached to role"

# -----------------------------------------------------------------------------
# Cleanup
# -----------------------------------------------------------------------------
rm -f /tmp/github-actions-trust-policy.json /tmp/github-actions-permissions-policy.json

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${ROLE_NAME}"

echo ""
echo "============================================================================="
echo "GitHub Actions IAM Role Created Successfully"
echo "============================================================================="
echo ""
echo "Role ARN: ${ROLE_ARN}"
echo ""
echo "Add the following secrets to your GitHub repository:"
echo ""
echo "  AWS_ACCOUNT_ID: ${AWS_ACCOUNT_ID}"
echo ""
echo "The workflow uses OIDC authentication, so no AWS access keys are needed."
echo ""
echo "GitHub Repository Settings -> Secrets and variables -> Actions:"
echo "  - AWS_ACCOUNT_ID = ${AWS_ACCOUNT_ID}"
echo ""
echo "GitHub Repository Settings -> Environments:"
echo "  - Create environments: dev, staging, prod, production, production-rollback"
echo "  - Add protection rules for prod/production environments"
echo ""
echo "Workflow usage:"
echo "  - name: Configure AWS credentials"
echo "    uses: aws-actions/configure-aws-credentials@v4"
echo "    with:"
echo "      role-to-assume: ${ROLE_ARN}"
echo "      aws-region: ${AWS_REGION}"
echo ""
echo "============================================================================="
