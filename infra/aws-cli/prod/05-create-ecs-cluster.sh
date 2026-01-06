#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create ECS Cluster (Production)
# =============================================================================
# Creates ECS cluster with Fargate capacity providers, service discovery,
# and production-grade configuration
#
# Usage: ./05-create-ecs-cluster.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli
confirm_production

log "Creating ECS cluster for environment: ${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# Create ECS Cluster with production settings
# -----------------------------------------------------------------------------
log "Creating ECS cluster: ${ECS_CLUSTER_NAME}"

# Check if cluster already exists
if aws ecs describe-clusters --clusters "${ECS_CLUSTER_NAME}" --query 'clusters[?status==`ACTIVE`].clusterName' --output text | grep -q "${ECS_CLUSTER_NAME}"; then
    log "ECS cluster already exists, updating configuration"

    # Update cluster settings
    aws ecs update-cluster-settings \
        --cluster "${ECS_CLUSTER_NAME}" \
        --settings name=containerInsights,value=enabled
else
    # Create cluster with production settings
    # For production, we primarily use FARGATE (not FARGATE_SPOT) for reliability
    aws ecs create-cluster \
        --cluster-name "${ECS_CLUSTER_NAME}" \
        --capacity-providers FARGATE FARGATE_SPOT \
        --default-capacity-provider-strategy \
            capacityProvider=FARGATE,weight=3,base=2 \
            capacityProvider=FARGATE_SPOT,weight=1,base=0 \
        --settings name=containerInsights,value=enabled \
        --configuration "executeCommandConfiguration={logging=OVERRIDE,logConfiguration={cloudWatchLogGroupName=/ecs/${RESOURCE_PREFIX}/exec-command,cloudWatchEncryptionEnabled=true}}" \
        --tags key=Project,value="${TAG_PROJECT}" key=Environment,value="${TAG_ENVIRONMENT}" key=CostCenter,value="${TAG_COST_CENTER}"

    log "ECS cluster created successfully"
fi

# Create log group for ECS Exec command logging
aws logs create-log-group \
    --log-group-name "/ecs/${RESOURCE_PREFIX}/exec-command" \
    --tags Project="${TAG_PROJECT}",Environment="${TAG_ENVIRONMENT}" \
    2>/dev/null || log "Exec command log group already exists"

aws logs put-retention-policy \
    --log-group-name "/ecs/${RESOURCE_PREFIX}/exec-command" \
    --retention-in-days "${LOG_RETENTION_DAYS}"

# -----------------------------------------------------------------------------
# Create Service Discovery Namespace (for service-to-service communication)
# -----------------------------------------------------------------------------
log "Creating service discovery namespace"

NAMESPACE_NAME="${RESOURCE_PREFIX}.local"

# Check if namespace exists
NAMESPACE_ID=$(aws servicediscovery list-namespaces \
    --query "Namespaces[?Name=='${NAMESPACE_NAME}'].Id" \
    --output text 2>/dev/null || echo "")

if [[ -z "${NAMESPACE_ID}" || "${NAMESPACE_ID}" == "None" ]]; then
    OPERATION_ID=$(aws servicediscovery create-private-dns-namespace \
        --name "${NAMESPACE_NAME}" \
        --vpc "${VPC_ID}" \
        --description "Production service discovery namespace for Campfire" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" \
        --query 'OperationId' \
        --output text)

    log "Namespace creation initiated with operation ID: ${OPERATION_ID}"

    # Wait for namespace creation
    log "Waiting for namespace to be created..."
    for i in {1..30}; do
        NAMESPACE_ID=$(aws servicediscovery list-namespaces \
            --query "Namespaces[?Name=='${NAMESPACE_NAME}'].Id" \
            --output text 2>/dev/null || echo "")

        if [[ -n "${NAMESPACE_ID}" && "${NAMESPACE_ID}" != "None" ]]; then
            break
        fi
        sleep 5
    done

    log "Namespace created: ${NAMESPACE_ID}"
else
    log "Namespace already exists: ${NAMESPACE_ID}"
fi

# -----------------------------------------------------------------------------
# Create Service Discovery Services for each component
# -----------------------------------------------------------------------------
create_discovery_service() {
    local service_name="$1"
    local port="$2"

    log "Creating service discovery for: ${service_name}"

    # Check if service exists
    EXISTING_SERVICE=$(aws servicediscovery list-services \
        --filters Name=NAMESPACE_ID,Values="${NAMESPACE_ID}",Condition=EQ \
        --query "Services[?Name=='${service_name}'].Id" \
        --output text 2>/dev/null || echo "")

    if [[ -z "${EXISTING_SERVICE}" || "${EXISTING_SERVICE}" == "None" ]]; then
        aws servicediscovery create-service \
            --name "${service_name}" \
            --namespace-id "${NAMESPACE_ID}" \
            --dns-config "NamespaceId=${NAMESPACE_ID},DnsRecords=[{Type=A,TTL=10},{Type=SRV,TTL=10}]" \
            --health-check-custom-config FailureThreshold=1 \
            --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

        log "Service discovery created for ${service_name}"
    else
        log "Service discovery for ${service_name} already exists"
    fi
}

create_discovery_service "gateway" "4000"
create_discovery_service "orchestrator" "5000"
create_discovery_service "web" "3000"
create_discovery_service "workers" "8080"

# -----------------------------------------------------------------------------
# Create Capacity Provider Configuration
# -----------------------------------------------------------------------------
log "Configuring capacity providers for production workloads"

# Note: Fargate Spot is used for cost optimization on non-critical workloads
# Critical services use regular FARGATE for reliability

# -----------------------------------------------------------------------------
# Save ECS Configuration
# -----------------------------------------------------------------------------
cat >> "${SCRIPT_DIR}/vpc-outputs.env" << EOF

# ECS Resources - Generated by 05-create-ecs-cluster.sh
export ECS_CLUSTER_NAME="${ECS_CLUSTER_NAME}"
export SERVICE_DISCOVERY_NAMESPACE_ID="${NAMESPACE_ID}"
export SERVICE_DISCOVERY_NAMESPACE="${NAMESPACE_NAME}"
EOF

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "ECS Cluster Created Successfully (Production)"
echo "============================================================================="
echo "Cluster Name:           ${ECS_CLUSTER_NAME}"
echo ""
echo "Capacity Providers:"
echo "  - FARGATE (primary, weight: 3, base: 2)"
echo "  - FARGATE_SPOT (cost optimization, weight: 1)"
echo ""
echo "Production Features:"
echo "  - Container Insights: Enabled"
echo "  - ECS Exec: Enabled with CloudWatch logging"
echo ""
echo "Service Discovery:"
echo "  Namespace:            ${NAMESPACE_NAME}"
echo "  Namespace ID:         ${NAMESPACE_ID}"
echo ""
echo "Services can communicate using DNS:"
echo "  - gateway.${NAMESPACE_NAME}:4000"
echo "  - orchestrator.${NAMESPACE_NAME}:5000"
echo "  - web.${NAMESPACE_NAME}:3000"
echo "  - workers.${NAMESPACE_NAME}:8080"
echo ""
echo "Next step: ./06-create-task-definitions.sh"
echo "============================================================================="
