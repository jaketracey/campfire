#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - View Infrastructure Status
# =============================================================================
# Shows the status of all AWS resources
#
# Usage: ./scripts/status.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../00-config.sh"

check_aws_cli

echo ""
echo "============================================================================="
echo "Campfire Infrastructure Status - ${ENVIRONMENT}"
echo "============================================================================="
echo ""

# Load resource IDs if available
if [[ -f "${SCRIPT_DIR}/../vpc-outputs.env" ]]; then
    source "${SCRIPT_DIR}/../vpc-outputs.env"
fi

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# -----------------------------------------------------------------------------
# VPC Status
# -----------------------------------------------------------------------------
echo "VPC"
echo "---"
if [[ -n "${VPC_ID:-}" ]]; then
    VPC_STATE=$(aws ec2 describe-vpcs --vpc-ids "${VPC_ID}" --query 'Vpcs[0].State' --output text 2>/dev/null || echo "NOT FOUND")
    echo "  VPC ID:      ${VPC_ID} (${VPC_STATE})"
    echo "  NAT Gateway: ${NAT_GW_ID:-N/A}"
else
    echo "  VPC not created"
fi
echo ""

# -----------------------------------------------------------------------------
# ECS Status
# -----------------------------------------------------------------------------
echo "ECS Cluster"
echo "-----------"
CLUSTER_STATUS=$(aws ecs describe-clusters --clusters "${ECS_CLUSTER_NAME}" --query 'clusters[0].status' --output text 2>/dev/null || echo "NOT FOUND")
echo "  Cluster:     ${ECS_CLUSTER_NAME} (${CLUSTER_STATUS})"

if [[ "${CLUSTER_STATUS}" == "ACTIVE" ]]; then
    echo ""
    echo "  Services:"
    for service in gateway orchestrator web workers; do
        SERVICE_NAME="${RESOURCE_PREFIX}-${service}"
        SERVICE_INFO=$(aws ecs describe-services \
            --cluster "${ECS_CLUSTER_NAME}" \
            --services "${SERVICE_NAME}" \
            --query 'services[0].{status:status,desired:desiredCount,running:runningCount,pending:pendingCount}' \
            --output json 2>/dev/null || echo '{}')

        if [[ "${SERVICE_INFO}" != "{}" && "${SERVICE_INFO}" != "null" ]]; then
            STATUS=$(echo "${SERVICE_INFO}" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            DESIRED=$(echo "${SERVICE_INFO}" | grep -o '"desired":[0-9]*' | cut -d':' -f2)
            RUNNING=$(echo "${SERVICE_INFO}" | grep -o '"running":[0-9]*' | cut -d':' -f2)
            echo "    ${service}: ${RUNNING}/${DESIRED} running (${STATUS})"
        else
            echo "    ${service}: not deployed"
        fi
    done
fi
echo ""

# -----------------------------------------------------------------------------
# RDS Status
# -----------------------------------------------------------------------------
echo "RDS Database"
echo "------------"
if [[ -n "${RDS_INSTANCE_IDENTIFIER:-}" ]]; then
    RDS_INFO=$(aws rds describe-db-instances \
        --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" \
        --query 'DBInstances[0].{status:DBInstanceStatus,endpoint:Endpoint.Address,class:DBInstanceClass}' \
        --output json 2>/dev/null || echo '{}')

    if [[ "${RDS_INFO}" != "{}" && "${RDS_INFO}" != "null" ]]; then
        STATUS=$(echo "${RDS_INFO}" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        ENDPOINT=$(echo "${RDS_INFO}" | grep -o '"endpoint":"[^"]*"' | cut -d'"' -f4)
        CLASS=$(echo "${RDS_INFO}" | grep -o '"class":"[^"]*"' | cut -d'"' -f4)
        echo "  Instance:    ${RDS_INSTANCE_IDENTIFIER} (${STATUS})"
        echo "  Class:       ${CLASS}"
        echo "  Endpoint:    ${ENDPOINT:-pending}"
    else
        echo "  Instance:    ${RDS_INSTANCE_IDENTIFIER} (NOT FOUND)"
    fi
else
    echo "  RDS not created"
fi
echo ""

# -----------------------------------------------------------------------------
# ALB Status
# -----------------------------------------------------------------------------
echo "Application Load Balancer"
echo "-------------------------"
if [[ -n "${ALB_ARN:-}" ]]; then
    ALB_INFO=$(aws elbv2 describe-load-balancers \
        --load-balancer-arns "${ALB_ARN}" \
        --query 'LoadBalancers[0].{state:State.Code,dns:DNSName}' \
        --output json 2>/dev/null || echo '{}')

    if [[ "${ALB_INFO}" != "{}" && "${ALB_INFO}" != "null" ]]; then
        STATE=$(echo "${ALB_INFO}" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
        DNS=$(echo "${ALB_INFO}" | grep -o '"dns":"[^"]*"' | cut -d'"' -f4)
        echo "  Name:        ${ALB_NAME} (${STATE})"
        echo "  DNS:         ${DNS:-pending}"
        echo "  URL:         http://${DNS:-pending}"
    else
        echo "  ALB:         ${ALB_NAME} (NOT FOUND)"
    fi
else
    echo "  ALB not created"
fi
echo ""

# -----------------------------------------------------------------------------
# S3 Buckets
# -----------------------------------------------------------------------------
echo "S3 Buckets"
echo "----------"
for bucket in "${S3_MEDIA_BUCKET}" "${S3_VAULT_BUCKET}"; do
    if aws s3api head-bucket --bucket "${bucket}" 2>/dev/null; then
        SIZE=$(aws s3 ls "s3://${bucket}" --recursive --summarize 2>/dev/null | grep "Total Size" | awk '{print $3}')
        echo "  ${bucket}: exists (${SIZE:-0} bytes)"
    else
        echo "  ${bucket}: not found"
    fi
done
echo ""

# -----------------------------------------------------------------------------
# ECR Repositories
# -----------------------------------------------------------------------------
echo "ECR Repositories"
echo "----------------"
for repo in "${ECR_GATEWAY_REPO}" "${ECR_ORCHESTRATOR_REPO}" "${ECR_WEB_REPO}" "${ECR_WORKERS_REPO}"; do
    IMAGE_COUNT=$(aws ecr describe-images --repository-name "${repo}" --query 'length(imageDetails)' --output text 2>/dev/null || echo "N/A")
    echo "  ${repo}: ${IMAGE_COUNT} images"
done
echo ""

# -----------------------------------------------------------------------------
# CloudWatch Alarms
# -----------------------------------------------------------------------------
echo "CloudWatch Alarms"
echo "-----------------"
ALARM_SUMMARY=$(aws cloudwatch describe-alarms \
    --alarm-name-prefix "${RESOURCE_PREFIX}" \
    --query 'MetricAlarms[*].StateValue' \
    --output text 2>/dev/null | tr '\t' '\n' | sort | uniq -c | tr '\n' ' ')
echo "  ${ALARM_SUMMARY:-No alarms configured}"
echo ""

# -----------------------------------------------------------------------------
# Cost Estimate (last 30 days)
# -----------------------------------------------------------------------------
echo "Cost Summary (MTD)"
echo "------------------"
COST=$(aws ce get-cost-and-usage \
    --time-period Start=$(date -u -v-30d +%Y-%m-%d 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
    --granularity MONTHLY \
    --metrics BlendedCost \
    --filter "{\"Tags\":{\"Key\":\"Project\",\"Values\":[\"${TAG_PROJECT}\"]}}" \
    --query 'ResultsByTime[0].Total.BlendedCost.Amount' \
    --output text 2>/dev/null || echo "N/A")

if [[ "${COST}" != "N/A" && "${COST}" != "null" ]]; then
    echo "  Estimated cost: \$${COST}"
else
    echo "  Cost data not available (enable Cost Explorer)"
fi
echo ""

echo "============================================================================="
echo "Dashboard: https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${RESOURCE_PREFIX}-dashboard"
echo "============================================================================="
