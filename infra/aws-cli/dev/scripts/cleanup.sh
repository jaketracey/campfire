#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Cleanup Script
# =============================================================================
# Deletes all AWS resources created by the infrastructure scripts
#
# Usage: ./scripts/cleanup.sh [--force]
#
# WARNING: This will delete ALL resources including databases and S3 buckets.
# Data will be lost. Use with caution.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../00-config.sh"

FORCE="${1:-}"

check_aws_cli

log "Cleanup script for environment: ${ENVIRONMENT}"

# Load resource IDs
if [[ -f "${SCRIPT_DIR}/../vpc-outputs.env" ]]; then
    source "${SCRIPT_DIR}/../vpc-outputs.env"
else
    error "vpc-outputs.env not found. No resources to clean up."
fi

echo ""
echo "============================================================================="
echo "WARNING: DESTRUCTIVE OPERATION"
echo "============================================================================="
echo ""
echo "This script will DELETE the following resources:"
echo ""
echo "  - ECS Services and Cluster: ${ECS_CLUSTER_NAME:-not set}"
echo "  - Application Load Balancer: ${ALB_NAME:-not set}"
echo "  - RDS Instance: ${RDS_INSTANCE_IDENTIFIER:-not set}"
echo "  - VPC and all networking: ${VPC_ID:-not set}"
echo "  - S3 Buckets: ${S3_MEDIA_BUCKET:-not set}, ${S3_VAULT_BUCKET:-not set}"
echo "  - ECR Repositories"
echo "  - IAM Roles and Policies"
echo "  - CloudWatch Log Groups and Alarms"
echo "  - SNS Topics"
echo "  - SSM Parameters"
echo ""
echo "ALL DATA WILL BE LOST. This action CANNOT be undone."
echo ""
echo "============================================================================="

if [[ "${FORCE}" != "--force" ]]; then
    read -p "Type 'DELETE' to confirm: " confirmation
    if [[ "${confirmation}" != "DELETE" ]]; then
        echo "Cleanup cancelled."
        exit 0
    fi
fi

log "Starting cleanup..."

# -----------------------------------------------------------------------------
# 1. Stop and Delete ECS Services
# -----------------------------------------------------------------------------
log "Stopping ECS services..."

for service in gateway orchestrator web marketing workers; do
    SERVICE_NAME="${RESOURCE_PREFIX}-${service}"
    if aws ecs describe-services --cluster "${ECS_CLUSTER_NAME}" --services "${SERVICE_NAME}" --query 'services[0].status' --output text 2>/dev/null | grep -q "ACTIVE"; then
        log "Scaling down ${SERVICE_NAME}..."
        aws ecs update-service --cluster "${ECS_CLUSTER_NAME}" --service "${SERVICE_NAME}" --desired-count 0 2>/dev/null || true
    fi
done

# Wait for tasks to stop
log "Waiting for tasks to stop..."
sleep 30

for service in gateway orchestrator web marketing workers; do
    SERVICE_NAME="${RESOURCE_PREFIX}-${service}"
    log "Deleting service ${SERVICE_NAME}..."
    aws ecs delete-service --cluster "${ECS_CLUSTER_NAME}" --service "${SERVICE_NAME}" --force 2>/dev/null || true
done

# Delete service discovery services
log "Deleting service discovery services..."
for service in gateway orchestrator web marketing workers; do
    SERVICE_ID=$(aws servicediscovery list-services --query "Services[?Name=='${service}'].Id" --output text 2>/dev/null || echo "")
    if [[ -n "${SERVICE_ID}" && "${SERVICE_ID}" != "None" ]]; then
        aws servicediscovery delete-service --id "${SERVICE_ID}" 2>/dev/null || true
    fi
done

# Delete service discovery namespace
if [[ -n "${SERVICE_DISCOVERY_NAMESPACE_ID:-}" ]]; then
    log "Deleting service discovery namespace..."
    aws servicediscovery delete-namespace --id "${SERVICE_DISCOVERY_NAMESPACE_ID}" 2>/dev/null || true
fi

# Delete ECS cluster
log "Deleting ECS cluster..."
aws ecs delete-cluster --cluster "${ECS_CLUSTER_NAME}" 2>/dev/null || true

# -----------------------------------------------------------------------------
# 2. Delete ALB
# -----------------------------------------------------------------------------
if [[ -n "${ALB_ARN:-}" ]]; then
    log "Deleting Application Load Balancer..."

    # Delete listeners first
    LISTENERS=$(aws elbv2 describe-listeners --load-balancer-arn "${ALB_ARN}" --query 'Listeners[*].ListenerArn' --output text 2>/dev/null || echo "")
    for listener in ${LISTENERS}; do
        aws elbv2 delete-listener --listener-arn "${listener}" 2>/dev/null || true
    done

    # Delete ALB
    aws elbv2 delete-load-balancer --load-balancer-arn "${ALB_ARN}" 2>/dev/null || true

    # Wait for ALB deletion
    log "Waiting for ALB deletion..."
    sleep 30

    # Delete target groups
    for tg in "${GATEWAY_TG_ARN:-}" "${WEB_TG_ARN:-}" "${MARKETING_TG_ARN:-}" "${ORCHESTRATOR_TG_ARN:-}" "${WS_TG_ARN:-}"; do
        if [[ -n "${tg}" ]]; then
            aws elbv2 delete-target-group --target-group-arn "${tg}" 2>/dev/null || true
        fi
    done
fi

# -----------------------------------------------------------------------------
# 3. Delete RDS
# -----------------------------------------------------------------------------
if [[ -n "${RDS_INSTANCE_IDENTIFIER:-}" ]]; then
    log "Deleting RDS instance (this may take several minutes)..."
    aws rds delete-db-instance \
        --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" \
        --skip-final-snapshot \
        --delete-automated-backups 2>/dev/null || true

    log "Waiting for RDS deletion..."
    aws rds wait db-instance-deleted --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" 2>/dev/null || true

    # Delete subnet group
    aws rds delete-db-subnet-group --db-subnet-group-name "${DB_SUBNET_GROUP_NAME:-${RESOURCE_PREFIX}-db-subnet-group}" 2>/dev/null || true

    # Delete parameter group
    aws rds delete-db-parameter-group --db-parameter-group-name "${PARAMETER_GROUP_NAME:-${RESOURCE_PREFIX}-postgres-params}" 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# 4. Delete NAT Gateway and EIP
# -----------------------------------------------------------------------------
if [[ -n "${NAT_GW_ID:-}" ]]; then
    log "Deleting NAT Gateway..."
    aws ec2 delete-nat-gateway --nat-gateway-id "${NAT_GW_ID}" 2>/dev/null || true

    # Wait for NAT Gateway deletion
    log "Waiting for NAT Gateway deletion..."
    sleep 60
fi

if [[ -n "${EIP_ALLOC_ID:-}" ]]; then
    log "Releasing Elastic IP..."
    aws ec2 release-address --allocation-id "${EIP_ALLOC_ID}" 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# 5. Delete VPC Resources
# -----------------------------------------------------------------------------
if [[ -n "${VPC_ID:-}" ]]; then
    log "Deleting VPC resources..."

    # Delete security groups (except default)
    for sg in "${ALB_SG_ID:-}" "${ECS_SG_ID:-}" "${RDS_SG_ID:-}" "${REDIS_SG_ID:-}"; do
        if [[ -n "${sg}" ]]; then
            aws ec2 delete-security-group --group-id "${sg}" 2>/dev/null || true
        fi
    done

    # Delete subnets
    for subnet in "${PUBLIC_SUBNET_1_ID:-}" "${PUBLIC_SUBNET_2_ID:-}" "${PRIVATE_SUBNET_1_ID:-}" "${PRIVATE_SUBNET_2_ID:-}"; do
        if [[ -n "${subnet}" ]]; then
            aws ec2 delete-subnet --subnet-id "${subnet}" 2>/dev/null || true
        fi
    done

    # Delete route tables
    for rt in "${PUBLIC_RT_ID:-}" "${PRIVATE_RT_ID:-}"; do
        if [[ -n "${rt}" ]]; then
            aws ec2 delete-route-table --route-table-id "${rt}" 2>/dev/null || true
        fi
    done

    # Detach and delete internet gateway
    if [[ -n "${IGW_ID:-}" ]]; then
        aws ec2 detach-internet-gateway --internet-gateway-id "${IGW_ID}" --vpc-id "${VPC_ID}" 2>/dev/null || true
        aws ec2 delete-internet-gateway --internet-gateway-id "${IGW_ID}" 2>/dev/null || true
    fi

    # Delete VPC
    log "Deleting VPC..."
    aws ec2 delete-vpc --vpc-id "${VPC_ID}" 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# 6. Delete S3 Buckets
# -----------------------------------------------------------------------------
log "Deleting S3 buckets..."

for bucket in "${S3_MEDIA_BUCKET:-}" "${S3_VAULT_BUCKET:-}"; do
    if [[ -n "${bucket}" ]] && aws s3api head-bucket --bucket "${bucket}" 2>/dev/null; then
        log "Emptying bucket ${bucket}..."
        aws s3 rm "s3://${bucket}" --recursive 2>/dev/null || true

        # Delete all versions if versioning is enabled
        aws s3api list-object-versions --bucket "${bucket}" --query 'Versions[*].[Key,VersionId]' --output text 2>/dev/null | \
        while read key version; do
            if [[ -n "${key}" && -n "${version}" ]]; then
                aws s3api delete-object --bucket "${bucket}" --key "${key}" --version-id "${version}" 2>/dev/null || true
            fi
        done

        # Delete delete markers
        aws s3api list-object-versions --bucket "${bucket}" --query 'DeleteMarkers[*].[Key,VersionId]' --output text 2>/dev/null | \
        while read key version; do
            if [[ -n "${key}" && -n "${version}" ]]; then
                aws s3api delete-object --bucket "${bucket}" --key "${key}" --version-id "${version}" 2>/dev/null || true
            fi
        done

        log "Deleting bucket ${bucket}..."
        aws s3 rb "s3://${bucket}" 2>/dev/null || true
    fi
done

# -----------------------------------------------------------------------------
# 7. Delete ECR Repositories
# -----------------------------------------------------------------------------
log "Deleting ECR repositories..."

for repo in "${ECR_GATEWAY_REPO:-}" "${ECR_ORCHESTRATOR_REPO:-}" "${ECR_WEB_REPO:-}" "${ECR_MARKETING_REPO:-}" "${ECR_WORKERS_REPO:-}"; do
    if [[ -n "${repo}" ]]; then
        aws ecr delete-repository --repository-name "${repo}" --force 2>/dev/null || true
    fi
done

# -----------------------------------------------------------------------------
# 8. Delete IAM Roles and Policies
# -----------------------------------------------------------------------------
log "Deleting IAM roles and policies..."

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Detach and delete execution role
EXEC_ROLE="${RESOURCE_PREFIX}-ecs-execution-role"
aws iam detach-role-policy --role-name "${EXEC_ROLE}" --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>/dev/null || true
aws iam detach-role-policy --role-name "${EXEC_ROLE}" --policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-ssm-secrets-policy" 2>/dev/null || true
aws iam delete-role --role-name "${EXEC_ROLE}" 2>/dev/null || true

# Detach and delete task role
TASK_ROLE="${RESOURCE_PREFIX}-ecs-task-role"
for policy in s3-access-policy cloudwatch-policy ssm-read-policy xray-policy; do
    aws iam detach-role-policy --role-name "${TASK_ROLE}" --policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-${policy}" 2>/dev/null || true
done
aws iam delete-role --role-name "${TASK_ROLE}" 2>/dev/null || true

# Delete policies
for policy in ssm-secrets-policy s3-access-policy cloudwatch-policy ssm-read-policy xray-policy; do
    aws iam delete-policy --policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${RESOURCE_PREFIX}-${policy}" 2>/dev/null || true
done

# -----------------------------------------------------------------------------
# 9. Delete CloudWatch Resources
# -----------------------------------------------------------------------------
log "Deleting CloudWatch resources..."

# Delete log groups
for service in gateway orchestrator web marketing workers; do
    aws logs delete-log-group --log-group-name "/ecs/${RESOURCE_PREFIX}/${service}" 2>/dev/null || true
done

# Delete alarms
ALARMS=$(aws cloudwatch describe-alarms --alarm-name-prefix "${RESOURCE_PREFIX}" --query 'MetricAlarms[*].AlarmName' --output text 2>/dev/null || echo "")
if [[ -n "${ALARMS}" ]]; then
    aws cloudwatch delete-alarms --alarm-names ${ALARMS} 2>/dev/null || true
fi

# Delete dashboard
aws cloudwatch delete-dashboards --dashboard-names "${RESOURCE_PREFIX}-dashboard" 2>/dev/null || true

# Delete SNS topic
if [[ -n "${SNS_TOPIC_ARN:-}" ]]; then
    aws sns delete-topic --topic-arn "${SNS_TOPIC_ARN}" 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# 10. Delete SSM Parameters
# -----------------------------------------------------------------------------
log "Deleting SSM parameters..."

PARAMS=$(aws ssm describe-parameters --parameter-filters Key=Path,Option=Recursive,Values="/${RESOURCE_PREFIX}/" --query 'Parameters[*].Name' --output text 2>/dev/null || echo "")
for param in ${PARAMS}; do
    aws ssm delete-parameter --name "${param}" 2>/dev/null || true
done

# -----------------------------------------------------------------------------
# 11. Cleanup local files
# -----------------------------------------------------------------------------
log "Cleaning up local files..."

rm -f "${SCRIPT_DIR}/../vpc-outputs.env"
rm -f "${SCRIPT_DIR}/../.rds-password"
rm -f "${SCRIPT_DIR}/../.database-url"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "Cleanup Complete"
echo "============================================================================="
echo ""
echo "All resources for ${RESOURCE_PREFIX} have been deleted."
echo ""
echo "============================================================================="
