#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create ECS Task Definitions (Production)
# =============================================================================
# Creates ECS Fargate task definitions with production resource allocations
# and security configurations
#
# Usage: ./06-create-task-definitions.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli
confirm_production

log "Creating ECS task definitions for environment: ${ENVIRONMENT}"

# Get AWS Account ID and ECR registry
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Get execution role ARN (will be created by 08-create-iam-roles.sh)
EXECUTION_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${RESOURCE_PREFIX}-ecs-execution-role"
TASK_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${RESOURCE_PREFIX}-ecs-task-role"

# Production image tag (should be updated for deployments)
IMAGE_TAG="${IMAGE_TAG:-prod-latest}"

# -----------------------------------------------------------------------------
# Gateway Task Definition (Production)
# -----------------------------------------------------------------------------
log "Creating Gateway task definition"

cat > /tmp/gateway-task-def.json << EOF
{
    "family": "${RESOURCE_PREFIX}-gateway",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "${GATEWAY_CPU}",
    "memory": "${GATEWAY_MEMORY}",
    "executionRoleArn": "${EXECUTION_ROLE_ARN}",
    "taskRoleArn": "${TASK_ROLE_ARN}",
    "runtimePlatform": {
        "cpuArchitecture": "ARM64",
        "operatingSystemFamily": "LINUX"
    },
    "containerDefinitions": [
        {
            "name": "gateway",
            "image": "${ECR_REGISTRY}/${ECR_GATEWAY_REPO}:${IMAGE_TAG}",
            "essential": true,
            "portMappings": [
                {
                    "containerPort": 4000,
                    "protocol": "tcp",
                    "name": "gateway-http"
                },
                {
                    "containerPort": 4001,
                    "protocol": "tcp",
                    "name": "gateway-ws"
                }
            ],
            "environment": [
                {"name": "NODE_ENV", "value": "production"},
                {"name": "PORT", "value": "4000"},
                {"name": "WS_PORT", "value": "4001"},
                {"name": "ORCHESTRATOR_URL", "value": "http://orchestrator.${SERVICE_DISCOVERY_NAMESPACE}:5000"},
                {"name": "LOG_LEVEL", "value": "info"},
                {"name": "ENABLE_METRICS", "value": "true"}
            ],
            "secrets": [
                {"name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/database-url"},
                {"name": "REDIS_URL", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/redis-url"},
                {"name": "JWT_SECRET", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/jwt-secret"},
                {"name": "SESSION_SECRET", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/session-secret"}
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "/ecs/${RESOURCE_PREFIX}/gateway",
                    "awslogs-region": "${AWS_REGION}",
                    "awslogs-stream-prefix": "ecs",
                    "awslogs-create-group": "true"
                }
            },
            "healthCheck": {
                "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1"],
                "interval": 30,
                "timeout": 5,
                "retries": 3,
                "startPeriod": 60
            },
            "ulimits": [
                {
                    "name": "nofile",
                    "softLimit": 65536,
                    "hardLimit": 65536
                }
            ],
            "linuxParameters": {
                "initProcessEnabled": true
            }
        }
    ],
    "tags": [
        {"key": "Project", "value": "${TAG_PROJECT}"},
        {"key": "Environment", "value": "${TAG_ENVIRONMENT}"},
        {"key": "Service", "value": "gateway"},
        {"key": "CostCenter", "value": "${TAG_COST_CENTER}"}
    ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/gateway-task-def.json
log "Gateway task definition registered"

# -----------------------------------------------------------------------------
# Orchestrator Task Definition (Production - higher resources for AI workloads)
# -----------------------------------------------------------------------------
log "Creating Orchestrator task definition"

cat > /tmp/orchestrator-task-def.json << EOF
{
    "family": "${RESOURCE_PREFIX}-orchestrator",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "${ORCHESTRATOR_CPU}",
    "memory": "${ORCHESTRATOR_MEMORY}",
    "executionRoleArn": "${EXECUTION_ROLE_ARN}",
    "taskRoleArn": "${TASK_ROLE_ARN}",
    "runtimePlatform": {
        "cpuArchitecture": "ARM64",
        "operatingSystemFamily": "LINUX"
    },
    "containerDefinitions": [
        {
            "name": "orchestrator",
            "image": "${ECR_REGISTRY}/${ECR_ORCHESTRATOR_REPO}:${IMAGE_TAG}",
            "essential": true,
            "portMappings": [
                {
                    "containerPort": 5000,
                    "protocol": "tcp",
                    "name": "orchestrator-http"
                }
            ],
            "environment": [
                {"name": "NODE_ENV", "value": "production"},
                {"name": "PORT", "value": "5000"},
                {"name": "S3_MEDIA_BUCKET", "value": "${S3_MEDIA_BUCKET}"},
                {"name": "S3_VAULT_BUCKET", "value": "${S3_VAULT_BUCKET}"},
                {"name": "AWS_REGION", "value": "${AWS_REGION}"},
                {"name": "LOG_LEVEL", "value": "info"},
                {"name": "ENABLE_METRICS", "value": "true"},
                {"name": "MAX_CONCURRENT_REQUESTS", "value": "50"}
            ],
            "secrets": [
                {"name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/database-url"},
                {"name": "REDIS_URL", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/redis-url"},
                {"name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/anthropic-api-key"},
                {"name": "OPENAI_API_KEY", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/openai-api-key"},
                {"name": "DEEPGRAM_API_KEY", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/deepgram-api-key"},
                {"name": "ELEVENLABS_API_KEY", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/elevenlabs-api-key"},
                {"name": "REPLICATE_API_TOKEN", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/replicate-api-token"}
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "/ecs/${RESOURCE_PREFIX}/orchestrator",
                    "awslogs-region": "${AWS_REGION}",
                    "awslogs-stream-prefix": "ecs",
                    "awslogs-create-group": "true"
                }
            },
            "healthCheck": {
                "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1"],
                "interval": 30,
                "timeout": 5,
                "retries": 3,
                "startPeriod": 90
            },
            "ulimits": [
                {
                    "name": "nofile",
                    "softLimit": 65536,
                    "hardLimit": 65536
                }
            ],
            "linuxParameters": {
                "initProcessEnabled": true
            }
        }
    ],
    "tags": [
        {"key": "Project", "value": "${TAG_PROJECT}"},
        {"key": "Environment", "value": "${TAG_ENVIRONMENT}"},
        {"key": "Service", "value": "orchestrator"},
        {"key": "CostCenter", "value": "${TAG_COST_CENTER}"}
    ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/orchestrator-task-def.json
log "Orchestrator task definition registered"

# -----------------------------------------------------------------------------
# Web Task Definition (Production)
# -----------------------------------------------------------------------------
log "Creating Web task definition"

cat > /tmp/web-task-def.json << EOF
{
    "family": "${RESOURCE_PREFIX}-web",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "${WEB_CPU}",
    "memory": "${WEB_MEMORY}",
    "executionRoleArn": "${EXECUTION_ROLE_ARN}",
    "taskRoleArn": "${TASK_ROLE_ARN}",
    "runtimePlatform": {
        "cpuArchitecture": "ARM64",
        "operatingSystemFamily": "LINUX"
    },
    "containerDefinitions": [
        {
            "name": "web",
            "image": "${ECR_REGISTRY}/${ECR_WEB_REPO}:${IMAGE_TAG}",
            "essential": true,
            "portMappings": [
                {
                    "containerPort": 3000,
                    "protocol": "tcp",
                    "name": "web-http"
                }
            ],
            "environment": [
                {"name": "NODE_ENV", "value": "production"},
                {"name": "PORT", "value": "3000"},
                {"name": "NEXT_TELEMETRY_DISABLED", "value": "1"}
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "/ecs/${RESOURCE_PREFIX}/web",
                    "awslogs-region": "${AWS_REGION}",
                    "awslogs-stream-prefix": "ecs",
                    "awslogs-create-group": "true"
                }
            },
            "healthCheck": {
                "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1"],
                "interval": 30,
                "timeout": 5,
                "retries": 3,
                "startPeriod": 120
            },
            "linuxParameters": {
                "initProcessEnabled": true
            }
        }
    ],
    "tags": [
        {"key": "Project", "value": "${TAG_PROJECT}"},
        {"key": "Environment", "value": "${TAG_ENVIRONMENT}"},
        {"key": "Service", "value": "web"},
        {"key": "CostCenter", "value": "${TAG_COST_CENTER}"}
    ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/web-task-def.json
log "Web task definition registered"

# -----------------------------------------------------------------------------
# Workers Task Definition (Production)
# -----------------------------------------------------------------------------
log "Creating Workers task definition"

cat > /tmp/workers-task-def.json << EOF
{
    "family": "${RESOURCE_PREFIX}-workers",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "${WORKERS_CPU}",
    "memory": "${WORKERS_MEMORY}",
    "executionRoleArn": "${EXECUTION_ROLE_ARN}",
    "taskRoleArn": "${TASK_ROLE_ARN}",
    "runtimePlatform": {
        "cpuArchitecture": "ARM64",
        "operatingSystemFamily": "LINUX"
    },
    "containerDefinitions": [
        {
            "name": "workers",
            "image": "${ECR_REGISTRY}/${ECR_WORKERS_REPO}:${IMAGE_TAG}",
            "essential": true,
            "portMappings": [
                {
                    "containerPort": 8080,
                    "protocol": "tcp",
                    "name": "workers-health"
                }
            ],
            "environment": [
                {"name": "NODE_ENV", "value": "production"},
                {"name": "HEALTH_PORT", "value": "8080"},
                {"name": "S3_MEDIA_BUCKET", "value": "${S3_MEDIA_BUCKET}"},
                {"name": "S3_VAULT_BUCKET", "value": "${S3_VAULT_BUCKET}"},
                {"name": "AWS_REGION", "value": "${AWS_REGION}"},
                {"name": "LOG_LEVEL", "value": "info"},
                {"name": "WORKER_CONCURRENCY", "value": "10"}
            ],
            "secrets": [
                {"name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/database-url"},
                {"name": "REDIS_URL", "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${RESOURCE_PREFIX}/redis-url"}
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "/ecs/${RESOURCE_PREFIX}/workers",
                    "awslogs-region": "${AWS_REGION}",
                    "awslogs-stream-prefix": "ecs",
                    "awslogs-create-group": "true"
                }
            },
            "healthCheck": {
                "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1"],
                "interval": 30,
                "timeout": 5,
                "retries": 3,
                "startPeriod": 60
            },
            "linuxParameters": {
                "initProcessEnabled": true
            }
        }
    ],
    "tags": [
        {"key": "Project", "value": "${TAG_PROJECT}"},
        {"key": "Environment", "value": "${TAG_ENVIRONMENT}"},
        {"key": "Service", "value": "workers"},
        {"key": "CostCenter", "value": "${TAG_COST_CENTER}"}
    ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/workers-task-def.json
log "Workers task definition registered"

# Clean up temp files
rm -f /tmp/*-task-def.json

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "ECS Task Definitions Created Successfully (Production)"
echo "============================================================================="
echo "Task Definitions:"
echo "  - ${RESOURCE_PREFIX}-gateway"
echo "      CPU: ${GATEWAY_CPU}, Memory: ${GATEWAY_MEMORY}"
echo "      Architecture: ARM64 (Graviton)"
echo ""
echo "  - ${RESOURCE_PREFIX}-orchestrator"
echo "      CPU: ${ORCHESTRATOR_CPU}, Memory: ${ORCHESTRATOR_MEMORY}"
echo "      Architecture: ARM64 (Graviton)"
echo ""
echo "  - ${RESOURCE_PREFIX}-web"
echo "      CPU: ${WEB_CPU}, Memory: ${WEB_MEMORY}"
echo "      Architecture: ARM64 (Graviton)"
echo ""
echo "  - ${RESOURCE_PREFIX}-workers"
echo "      CPU: ${WORKERS_CPU}, Memory: ${WORKERS_MEMORY}"
echo "      Architecture: ARM64 (Graviton)"
echo ""
echo "Production Features:"
echo "  - ARM64 architecture (20% cost savings)"
echo "  - Init process enabled (proper signal handling)"
echo "  - Increased file descriptor limits"
echo "  - CloudWatch Logs with auto-create"
echo ""
echo "Required SSM Parameters (create before deploying):"
echo "  - /${RESOURCE_PREFIX}/database-url"
echo "  - /${RESOURCE_PREFIX}/redis-url"
echo "  - /${RESOURCE_PREFIX}/jwt-secret"
echo "  - /${RESOURCE_PREFIX}/session-secret"
echo "  - /${RESOURCE_PREFIX}/anthropic-api-key"
echo "  - /${RESOURCE_PREFIX}/openai-api-key"
echo "  - /${RESOURCE_PREFIX}/deepgram-api-key"
echo "  - /${RESOURCE_PREFIX}/elevenlabs-api-key"
echo "  - /${RESOURCE_PREFIX}/replicate-api-token"
echo ""
echo "Next step: ./07-create-alb.sh"
echo "============================================================================="
