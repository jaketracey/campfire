#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create IAM Roles
# =============================================================================
# Creates IAM roles for ECS task execution and task runtime
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
            "Action": "sts:AssumeRole"
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

# Create custom policy for SSM Parameter Store access
cat > /tmp/ssm-secrets-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
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
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue"
            ],
            "Resource": [
                "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${RESOURCE_PREFIX}/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt"
            ],
            "Resource": [
                "arn:aws:kms:${AWS_REGION}:${AWS_ACCOUNT_ID}:key/*"
            ],
            "Condition": {
                "StringEquals": {
                    "kms:ViaService": "ssm.${AWS_REGION}.amazonaws.com"
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

# Create policy for S3 access
cat > /tmp/s3-access-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::${S3_MEDIA_BUCKET}",
                "arn:aws:s3:::${S3_MEDIA_BUCKET}/*",
                "arn:aws:s3:::${S3_VAULT_BUCKET}",
                "arn:aws:s3:::${S3_VAULT_BUCKET}/*"
            ]
        },
        {
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

# Create policy for CloudWatch Logs and Metrics
cat > /tmp/cloudwatch-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogStreams"
            ],
            "Resource": [
                "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/ecs/${RESOURCE_PREFIX}/*:*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "cloudwatch:PutMetricData"
            ],
            "Resource": "*",
            "Condition": {
                "StringEquals": {
                    "cloudwatch:namespace": "${RESOURCE_PREFIX}"
                }
            }
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
        --description "Allow ECS tasks to write to CloudWatch Logs and Metrics"
fi

aws iam attach-role-policy \
    --role-name "${TASK_ROLE_NAME}" \
    --policy-arn "${CW_POLICY_ARN}"

log "Task role configured with CloudWatch access"

# Create policy for SSM Parameter Store read access (runtime secrets)
cat > /tmp/ssm-read-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
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
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt"
            ],
            "Resource": [
                "arn:aws:kms:${AWS_REGION}:${AWS_ACCOUNT_ID}:key/*"
            ],
            "Condition": {
                "StringEquals": {
                    "kms:ViaService": "ssm.${AWS_REGION}.amazonaws.com"
                }
            }
        }
    ]
}
EOF

SSM_READ_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-ssm-read-policy"

if aws iam get-policy --policy-arn "${SSM_READ_POLICY_ARN}" 2>/dev/null; then
    aws iam create-policy-version \
        --policy-arn "${SSM_READ_POLICY_ARN}" \
        --policy-document file:///tmp/ssm-read-policy.json \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-ssm-read-policy" \
        --policy-document file:///tmp/ssm-read-policy.json \
        --description "Allow ECS tasks to read SSM parameters at runtime"
fi

aws iam attach-role-policy \
    --role-name "${TASK_ROLE_NAME}" \
    --policy-arn "${SSM_READ_POLICY_ARN}"

log "Task role configured with SSM read access"

# Create policy for X-Ray tracing (optional but recommended)
cat > /tmp/xray-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "xray:PutTraceSegments",
                "xray:PutTelemetryRecords",
                "xray:GetSamplingRules",
                "xray:GetSamplingTargets",
                "xray:GetSamplingStatisticSummaries"
            ],
            "Resource": "*"
        }
    ]
}
EOF

XRAY_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-xray-policy"

if aws iam get-policy --policy-arn "${XRAY_POLICY_ARN}" 2>/dev/null; then
    aws iam create-policy-version \
        --policy-arn "${XRAY_POLICY_ARN}" \
        --policy-document file:///tmp/xray-policy.json \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-xray-policy" \
        --policy-document file:///tmp/xray-policy.json \
        --description "Allow ECS tasks to send traces to X-Ray"
fi

aws iam attach-role-policy \
    --role-name "${TASK_ROLE_NAME}" \
    --policy-arn "${XRAY_POLICY_ARN}"

log "Task role configured with S3, CloudWatch, SSM, and X-Ray access"

# Create policy for Bedrock access (for LLM inference in staging/prod)
cat > /tmp/bedrock-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "BedrockInvokeModel",
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream"
            ],
            "Resource": [
                "arn:aws:bedrock:*::foundation-model/*"
            ]
        },
        {
            "Sid": "BedrockListModels",
            "Effect": "Allow",
            "Action": [
                "bedrock:ListFoundationModels",
                "bedrock:GetFoundationModel"
            ],
            "Resource": "*"
        }
    ]
}
EOF

BEDROCK_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-bedrock-policy"

if aws iam get-policy --policy-arn "${BEDROCK_POLICY_ARN}" 2>/dev/null; then
    aws iam create-policy-version \
        --policy-arn "${BEDROCK_POLICY_ARN}" \
        --policy-document file:///tmp/bedrock-policy.json \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-bedrock-policy" \
        --policy-document file:///tmp/bedrock-policy.json \
        --description "Allow ECS tasks to invoke Bedrock foundation models"
fi

aws iam attach-role-policy \
    --role-name "${TASK_ROLE_NAME}" \
    --policy-arn "${BEDROCK_POLICY_ARN}"

log "Task role configured with Bedrock access"

# Create policy for SageMaker endpoint access (for custom fine-tuned models)
cat > /tmp/sagemaker-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "SageMakerInvokeEndpoint",
            "Effect": "Allow",
            "Action": [
                "sagemaker:InvokeEndpoint",
                "sagemaker:InvokeEndpointWithResponseStream"
            ],
            "Resource": [
                "arn:aws:sagemaker:${AWS_REGION}:${AWS_ACCOUNT_ID}:endpoint/${RESOURCE_PREFIX}-*"
            ]
        },
        {
            "Sid": "SageMakerListEndpoints",
            "Effect": "Allow",
            "Action": [
                "sagemaker:DescribeEndpoint",
                "sagemaker:ListEndpoints"
            ],
            "Resource": "*"
        }
    ]
}
EOF

SAGEMAKER_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-sagemaker-policy"

if aws iam get-policy --policy-arn "${SAGEMAKER_POLICY_ARN}" 2>/dev/null; then
    aws iam create-policy-version \
        --policy-arn "${SAGEMAKER_POLICY_ARN}" \
        --policy-document file:///tmp/sagemaker-policy.json \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-sagemaker-policy" \
        --policy-document file:///tmp/sagemaker-policy.json \
        --description "Allow ECS tasks to invoke SageMaker endpoints for custom models"
fi

aws iam attach-role-policy \
    --role-name "${TASK_ROLE_NAME}" \
    --policy-arn "${SAGEMAKER_POLICY_ARN}"

log "Task role configured with SageMaker access"

# Create policy for Cost Explorer access (for cost tracking dashboards)
cat > /tmp/cost-explorer-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CostExplorerRead",
            "Effect": "Allow",
            "Action": [
                "ce:GetCostAndUsage",
                "ce:GetCostForecast",
                "ce:GetDimensionValues",
                "ce:GetTags"
            ],
            "Resource": "*"
        }
    ]
}
EOF

COST_EXPLORER_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-cost-explorer-policy"

if aws iam get-policy --policy-arn "${COST_EXPLORER_POLICY_ARN}" 2>/dev/null; then
    aws iam create-policy-version \
        --policy-arn "${COST_EXPLORER_POLICY_ARN}" \
        --policy-document file:///tmp/cost-explorer-policy.json \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "${RESOURCE_PREFIX}-cost-explorer-policy" \
        --policy-document file:///tmp/cost-explorer-policy.json \
        --description "Allow ECS tasks to read Cost Explorer data for cost dashboards"
fi

aws iam attach-role-policy \
    --role-name "${TASK_ROLE_NAME}" \
    --policy-arn "${COST_EXPLORER_POLICY_ARN}"

log "Task role configured with Cost Explorer access"

# Clean up temp files
rm -f /tmp/ecs-trust-policy.json /tmp/ssm-secrets-policy.json /tmp/s3-access-policy.json /tmp/cloudwatch-policy.json /tmp/ssm-read-policy.json /tmp/xray-policy.json /tmp/bedrock-policy.json /tmp/sagemaker-policy.json /tmp/cost-explorer-policy.json

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
echo "    - CloudWatch Logs write"
echo "    - SSM Parameter Store read (for container secrets)"
echo "    - Secrets Manager read"
echo "    - KMS decrypt (for encrypted parameters)"
echo ""
echo "Task Role: ${TASK_ROLE_NAME}"
echo "  ARN: ${TASK_ROLE_ARN}"
echo "  Permissions:"
echo "    - S3 media bucket read/write"
echo "    - S3 vault bucket read/write"
echo "    - CloudWatch Logs write"
echo "    - CloudWatch Metrics publish"
echo "    - SSM Parameter Store read (runtime access)"
echo "    - X-Ray tracing"
echo "    - Bedrock InvokeModel (for LLM inference)"
echo "    - SageMaker InvokeEndpoint (for custom models)"
echo "    - Cost Explorer read (for cost dashboards)"
echo ""
echo "Next step: ./09-create-cloudwatch.sh"
echo "============================================================================="
