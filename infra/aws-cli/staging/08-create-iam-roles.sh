#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create IAM Roles (Staging)
# =============================================================================
# Creates IAM roles for ECS task execution and task runtime
# with production-like least-privilege policies
#
# Usage: ./08-create-iam-roles.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli

log "Creating IAM roles for environment: ${ENVIRONMENT}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# -----------------------------------------------------------------------------
# ECS Task Execution Role
# This role is used by the ECS agent to pull images and write logs
# -----------------------------------------------------------------------------
EXECUTION_ROLE_NAME="${RESOURCE_PREFIX}-ecs-execution-role"

log "Creating ECS Task Execution Role: ${EXECUTION_ROLE_NAME}"

# Create trust policy for ECS tasks
cat > /tmp/ecs-trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "ecs-tasks.amazonaws.com"
            },
            "Action": "sts:AssumeRole",
            "Condition": {
                "ArnLike": {
                    "aws:SourceArn": "arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:*"
                },
                "StringEquals": {
                    "aws:SourceAccount": "${AWS_ACCOUNT_ID}"
                }
            }
        }
    ]
}
EOF

# Check if role exists
if aws iam get-role --role-name "${EXECUTION_ROLE_NAME}" 2>/dev/null; then
    log "Execution role already exists, updating..."
else
    aws iam create-role \
        --role-name "${EXECUTION_ROLE_NAME}" \
        --assume-role-policy-document file:///tmp/ecs-trust-policy.json \
        --description "ECS task execution role for Campfire ${ENVIRONMENT}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Execution role created"
fi

# Attach AWS managed policy for ECS task execution
aws iam attach-role-policy \
    --role-name "${EXECUTION_ROLE_NAME}" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"

# Create custom policy for SSM Parameter Store access (least privilege)
cat > /tmp/ssm-secrets-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "SSMParameterAccess",
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameters",
                "ssm:GetParameter",
                "ssm:GetParametersByPath"
            ],
            "Resource": [
                "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/*"
            ]
        },
        {
            "Sid": "SecretsManagerAccess",
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue"
            ],
            "Resource": [
                "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${RESOURCE_PREFIX}/*"
            ]
        },
        {
            "Sid": "KMSDecrypt",
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt"
            ],
            "Resource": [
                "arn:aws:kms:${AWS_REGION}:${AWS_ACCOUNT_ID}:key/*"
            ],
            "Condition": {
                "StringEquals": {
                    "kms:ViaService": [
                        "ssm.${AWS_REGION}.amazonaws.com",
                        "secretsmanager.${AWS_REGION}.amazonaws.com"
                    ]
                }
            }
        }
    ]
}
EOF

# Create or update SSM policy
SECRETS_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-ssm-secrets-policy"

if aws iam get-policy --policy-arn "${SECRETS_POLICY_ARN}" 2>/dev/null; then
    # Create new version
    aws iam create-policy-version \
        --policy-arn "${SECRETS_POLICY_ARN}" \
        --policy-document file:///tmp/ssm-secrets-policy.json \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-ssm-secrets-policy" \
        --policy-document file:///tmp/ssm-secrets-policy.json \
        --description "Allow ECS tasks to read SSM parameters and secrets"
fi

aws iam attach-role-policy \
    --role-name "${EXECUTION_ROLE_NAME}" \
    --policy-arn "${SECRETS_POLICY_ARN}"

log "Execution role configured with SSM access"

# -----------------------------------------------------------------------------
# ECS Task Role
# This role is used by the application running in the container
# -----------------------------------------------------------------------------
TASK_ROLE_NAME="${RESOURCE_PREFIX}-ecs-task-role"

log "Creating ECS Task Role: ${TASK_ROLE_NAME}"

if aws iam get-role --role-name "${TASK_ROLE_NAME}" 2>/dev/null; then
    log "Task role already exists, updating..."
else
    aws iam create-role \
        --role-name "${TASK_ROLE_NAME}" \
        --assume-role-policy-document file:///tmp/ecs-trust-policy.json \
        --description "ECS task role for Campfire ${ENVIRONMENT} applications" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "Task role created"
fi

# Create policy for S3 access (least privilege - specific buckets only)
cat > /tmp/s3-access-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "S3BucketAccess",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket",
                "s3:GetObjectVersion"
            ],
            "Resource": [
                "arn:aws:s3:::${S3_MEDIA_BUCKET}",
                "arn:aws:s3:::${S3_MEDIA_BUCKET}/*",
                "arn:aws:s3:::${S3_VAULT_BUCKET}",
                "arn:aws:s3:::${S3_VAULT_BUCKET}/*"
            ]
        },
        {
            "Sid": "S3BucketLocation",
            "Effect": "Allow",
            "Action": [
                "s3:GetBucketLocation"
            ],
            "Resource": [
                "arn:aws:s3:::${S3_MEDIA_BUCKET}",
                "arn:aws:s3:::${S3_VAULT_BUCKET}"
            ]
        }
    ]
}
EOF

S3_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-s3-access-policy"

if aws iam get-policy --policy-arn "${S3_POLICY_ARN}" 2>/dev/null; then
    aws iam create-policy-version \
        --policy-arn "${S3_POLICY_ARN}" \
        --policy-document file:///tmp/s3-access-policy.json \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-s3-access-policy" \
        --policy-document file:///tmp/s3-access-policy.json \
        --description "Allow ECS tasks to access S3 buckets"
fi

aws iam attach-role-policy \
    --role-name "${TASK_ROLE_NAME}" \
    --policy-arn "${S3_POLICY_ARN}"

# Create policy for CloudWatch Logs
cat > /tmp/cloudwatch-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CloudWatchLogs",
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": [
                "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/ecs/${RESOURCE_PREFIX}/*:*"
            ]
        }
    ]
}
EOF

CW_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-cloudwatch-policy"

if aws iam get-policy --policy-arn "${CW_POLICY_ARN}" 2>/dev/null; then
    aws iam create-policy-version \
        --policy-arn "${CW_POLICY_ARN}" \
        --policy-document file:///tmp/cloudwatch-policy.json \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-cloudwatch-policy" \
        --policy-document file:///tmp/cloudwatch-policy.json \
        --description "Allow ECS tasks to write to CloudWatch Logs"
fi

aws iam attach-role-policy \
    --role-name "${TASK_ROLE_NAME}" \
    --policy-arn "${CW_POLICY_ARN}"

# Create policy for ECS Exec (production-like debugging capability)
cat > /tmp/ecs-exec-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "ECSExec",
            "Effect": "Allow",
            "Action": [
                "ssmmessages:CreateControlChannel",
                "ssmmessages:CreateDataChannel",
                "ssmmessages:OpenControlChannel",
                "ssmmessages:OpenDataChannel"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ECSExecLogs",
            "Effect": "Allow",
            "Action": [
                "logs:DescribeLogGroups"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ECSExecLogsWrite",
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogStream",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/ecs/${RESOURCE_PREFIX}/execute-command:*"
        }
    ]
}
EOF

EXEC_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-ecs-exec-policy"

if aws iam get-policy --policy-arn "${EXEC_POLICY_ARN}" 2>/dev/null; then
    aws iam create-policy-version \
        --policy-arn "${EXEC_POLICY_ARN}" \
        --policy-document file:///tmp/ecs-exec-policy.json \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-ecs-exec-policy" \
        --policy-document file:///tmp/ecs-exec-policy.json \
        --description "Allow ECS Execute Command for debugging"
fi

aws iam attach-role-policy \
    --role-name "${TASK_ROLE_NAME}" \
    --policy-arn "${EXEC_POLICY_ARN}"

log "Task role configured with S3, CloudWatch, and ECS Exec access"

# Clean up temp files
rm -f /tmp/ecs-trust-policy.json /tmp/ssm-secrets-policy.json /tmp/s3-access-policy.json /tmp/cloudwatch-policy.json /tmp/ecs-exec-policy.json

# -----------------------------------------------------------------------------
# Save IAM Configuration
# -----------------------------------------------------------------------------
EXECUTION_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${EXECUTION_ROLE_NAME}"
TASK_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${TASK_ROLE_NAME}"

cat >> "${SCRIPT_DIR}/vpc-outputs.env" << EOF

# IAM Resources - Generated by 08-create-iam-roles.sh
export EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME}"
export EXECUTION_ROLE_ARN="${EXECUTION_ROLE_ARN}"
export TASK_ROLE_NAME="${TASK_ROLE_NAME}"
export TASK_ROLE_ARN="${TASK_ROLE_ARN}"
EOF

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "IAM Roles Created Successfully"
echo "============================================================================="
echo "Execution Role: ${EXECUTION_ROLE_NAME}"
echo "  ARN: ${EXECUTION_ROLE_ARN}"
echo "  Permissions:"
echo "    - ECR image pull"
echo "    - CloudWatch Logs"
echo "    - SSM Parameter Store read (${RESOURCE_PREFIX}/* only)"
echo "    - Secrets Manager read (${RESOURCE_PREFIX}/* only)"
echo "    - KMS decrypt (via SSM/Secrets Manager)"
echo ""
echo "Task Role: ${TASK_ROLE_NAME}"
echo "  ARN: ${TASK_ROLE_ARN}"
echo "  Permissions:"
echo "    - S3 media bucket read/write"
echo "    - S3 vault bucket read/write"
echo "    - CloudWatch Logs write"
echo "    - ECS Execute Command (for debugging)"
echo ""
echo "Production-like Features:"
echo "  - Least privilege policies (specific resources only)"
echo "  - Trust policy with source account/ARN conditions"
echo "  - ECS Exec enabled for production debugging"
echo ""
echo "Next step: ./09-create-cloudwatch.sh"
echo "============================================================================="
