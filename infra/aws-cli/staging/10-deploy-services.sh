#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Deploy Services to ECS (Staging)
# =============================================================================
# Creates ECS services and deploys containers with production-like settings
#
# Usage: ./10-deploy-services.sh [service_name]
#   If service_name is provided, only deploys that service
#   Otherwise deploys all services
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli

log "Deploying services for environment: ${ENVIRONMENT}"

SERVICE_TO_DEPLOY="${1:-all}"

# -----------------------------------------------------------------------------
# Helper function to create or update service
# -----------------------------------------------------------------------------
deploy_service() {
    local service_name="$1"
    local task_family="$2"
    local target_group_arn="$3"
    local container_name="$4"
    local container_port="$5"
    local desired_count="$6"
    local discovery_service_name="$7"

    local full_service_name="${RESOURCE_PREFIX}-${service_name}"

    log "Deploying service: ${full_service_name}"

    # Get the latest task definition revision
    TASK_DEF_ARN=$(aws ecs describe-task-definition \
        --task-definition "${task_family}" \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)

    log "Using task definition: ${TASK_DEF_ARN}"

    # Get service discovery service ARN
    DISCOVERY_SERVICE_ARN=$(aws servicediscovery list-services \
        --query "Services[?Name=='${discovery_service_name}'].Arn" \
        --output text)

    # Check if service exists
    if aws ecs describe-services --cluster "${ECS_CLUSTER_NAME}" --services "${full_service_name}" --query 'services[?status==`ACTIVE`].serviceName' --output text | grep -q "${full_service_name}"; then
        log "Service exists, updating..."

        aws ecs update-service \
            --cluster "${ECS_CLUSTER_NAME}" \
            --service "${full_service_name}" \
            --task-definition "${TASK_DEF_ARN}" \
            --desired-count "${desired_count}" \
            --force-new-deployment

        log "Service updated: ${full_service_name}"
    else
        log "Creating new service..."

        # Build load balancer config if target group is provided
        if [[ -n "${target_group_arn}" ]]; then
            LB_CONFIG="targetGroupArn=${target_group_arn},containerName=${container_name},containerPort=${container_port}"

            aws ecs create-service \
                --cluster "${ECS_CLUSTER_NAME}" \
                --service-name "${full_service_name}" \
                --task-definition "${TASK_DEF_ARN}" \
                --desired-count "${desired_count}" \
                --launch-type FARGATE \
                --platform-version "LATEST" \
                --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1_ID},${PRIVATE_SUBNET_2_ID}],securityGroups=[${ECS_SG_ID}],assignPublicIp=DISABLED}" \
                --load-balancers "${LB_CONFIG}" \
                --service-registries "registryArn=${DISCOVERY_SERVICE_ARN}" \
                --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}" \
                --enable-execute-command \
                --propagate-tags SERVICE \
                --tags key=Project,value="${TAG_PROJECT}" key=Environment,value="${TAG_ENVIRONMENT}" key=Service,value="${service_name}"
        else
            # Service without load balancer (e.g., workers)
            aws ecs create-service \
                --cluster "${ECS_CLUSTER_NAME}" \
                --service-name "${full_service_name}" \
                --task-definition "${TASK_DEF_ARN}" \
                --desired-count "${desired_count}" \
                --launch-type FARGATE \
                --platform-version "LATEST" \
                --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1_ID},${PRIVATE_SUBNET_2_ID}],securityGroups=[${ECS_SG_ID}],assignPublicIp=DISABLED}" \
                --service-registries "registryArn=${DISCOVERY_SERVICE_ARN}" \
                --deployment-configuration "minimumHealthyPercent=50,maximumPercent=100,deploymentCircuitBreaker={enable=true,rollback=true}" \
                --enable-execute-command \
                --propagate-tags SERVICE \
                --tags key=Project,value="${TAG_PROJECT}" key=Environment,value="${TAG_ENVIRONMENT}" key=Service,value="${service_name}"
        fi

        log "Service created: ${full_service_name}"
    fi
}

# -----------------------------------------------------------------------------
# Deploy Services
# -----------------------------------------------------------------------------

if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "gateway" ]]; then
    deploy_service "gateway" "${RESOURCE_PREFIX}-gateway" "${GATEWAY_TG_ARN}" "gateway" "4000" "${GATEWAY_DESIRED_COUNT}" "gateway"
fi

if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "orchestrator" ]]; then
    # Orchestrator doesn't need ALB (internal service)
    deploy_service "orchestrator" "${RESOURCE_PREFIX}-orchestrator" "" "orchestrator" "5000" "${ORCHESTRATOR_DESIRED_COUNT}" "orchestrator"
fi

if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "web" ]]; then
    deploy_service "web" "${RESOURCE_PREFIX}-web" "${WEB_TG_ARN}" "web" "3000" "${WEB_DESIRED_COUNT}" "web"
fi

if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "workers" ]]; then
    # Workers don't need ALB
    deploy_service "workers" "${RESOURCE_PREFIX}-workers" "" "workers" "8080" "${WORKERS_DESIRED_COUNT}" "workers"
fi

# -----------------------------------------------------------------------------
# Configure Auto Scaling (production-like)
# -----------------------------------------------------------------------------
if [[ "${AUTOSCALING_ENABLED}" == "true" ]]; then
    log "Configuring auto-scaling policies"

    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

    configure_autoscaling() {
        local service_name="$1"
        local min_count="$2"
        local max_count="$3"

        local full_service_name="${RESOURCE_PREFIX}-${service_name}"
        local resource_id="service/${ECS_CLUSTER_NAME}/${full_service_name}"

        log "Configuring auto-scaling for ${full_service_name}"

        # Register scalable target
        aws application-autoscaling register-scalable-target \
            --service-namespace ecs \
            --resource-id "${resource_id}" \
            --scalable-dimension ecs:service:DesiredCount \
            --min-capacity "${min_count}" \
            --max-capacity "${max_count}" \
            2>/dev/null || log "Scalable target already registered"

        # CPU-based scaling policy
        aws application-autoscaling put-scaling-policy \
            --service-namespace ecs \
            --resource-id "${resource_id}" \
            --scalable-dimension ecs:service:DesiredCount \
            --policy-name "${full_service_name}-cpu-scaling" \
            --policy-type TargetTrackingScaling \
            --target-tracking-scaling-policy-configuration "{
                \"TargetValue\": ${AUTOSCALING_CPU_TARGET},
                \"PredefinedMetricSpecification\": {
                    \"PredefinedMetricType\": \"ECSServiceAverageCPUUtilization\"
                },
                \"ScaleInCooldown\": ${AUTOSCALING_SCALE_IN_COOLDOWN},
                \"ScaleOutCooldown\": ${AUTOSCALING_SCALE_OUT_COOLDOWN}
            }"

        # Memory-based scaling policy
        aws application-autoscaling put-scaling-policy \
            --service-namespace ecs \
            --resource-id "${resource_id}" \
            --scalable-dimension ecs:service:DesiredCount \
            --policy-name "${full_service_name}-memory-scaling" \
            --policy-type TargetTrackingScaling \
            --target-tracking-scaling-policy-configuration "{
                \"TargetValue\": ${AUTOSCALING_MEMORY_TARGET},
                \"PredefinedMetricSpecification\": {
                    \"PredefinedMetricType\": \"ECSServiceAverageMemoryUtilization\"
                },
                \"ScaleInCooldown\": ${AUTOSCALING_SCALE_IN_COOLDOWN},
                \"ScaleOutCooldown\": ${AUTOSCALING_SCALE_OUT_COOLDOWN}
            }"

        log "Auto-scaling configured for ${full_service_name} (${min_count}-${max_count} tasks)"
    }

    if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "gateway" ]]; then
        configure_autoscaling "gateway" "${GATEWAY_MIN_COUNT}" "${GATEWAY_MAX_COUNT}"
    fi

    if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "orchestrator" ]]; then
        configure_autoscaling "orchestrator" "${ORCHESTRATOR_MIN_COUNT}" "${ORCHESTRATOR_MAX_COUNT}"
    fi

    if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "web" ]]; then
        configure_autoscaling "web" "${WEB_MIN_COUNT}" "${WEB_MAX_COUNT}"
    fi

    if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "workers" ]]; then
        configure_autoscaling "workers" "${WORKERS_MIN_COUNT}" "${WORKERS_MAX_COUNT}"
    fi
fi

# -----------------------------------------------------------------------------
# Wait for services to stabilize
# -----------------------------------------------------------------------------
log "Waiting for services to stabilize..."

if [[ "${SERVICE_TO_DEPLOY}" == "all" ]]; then
    SERVICES_TO_WAIT="${RESOURCE_PREFIX}-gateway ${RESOURCE_PREFIX}-orchestrator ${RESOURCE_PREFIX}-web ${RESOURCE_PREFIX}-workers"
else
    SERVICES_TO_WAIT="${RESOURCE_PREFIX}-${SERVICE_TO_DEPLOY}"
fi

# Note: This can take several minutes
aws ecs wait services-stable \
    --cluster "${ECS_CLUSTER_NAME}" \
    --services ${SERVICES_TO_WAIT}

log "All services are stable"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "Services Deployed Successfully"
echo "============================================================================="
echo "Cluster: ${ECS_CLUSTER_NAME}"
echo ""
echo "Services:"
aws ecs list-services --cluster "${ECS_CLUSTER_NAME}" --query 'serviceArns[*]' --output table
echo ""
echo "Application URL: http://${ALB_DNS}"
echo ""
echo "Production-like Features:"
echo "  - Minimum healthy percent: 100% (zero downtime deployments)"
echo "  - Deployment circuit breaker: Enabled with auto-rollback"
echo "  - ECS Exec: Enabled for debugging"
echo "  - Tag propagation: Enabled"
if [[ "${AUTOSCALING_ENABLED}" == "true" ]]; then
    echo "  - Auto-scaling: Enabled (CPU ${AUTOSCALING_CPU_TARGET}%, Memory ${AUTOSCALING_MEMORY_TARGET}%)"
fi
echo ""
echo "Useful commands:"
echo "  # View service status"
echo "  aws ecs describe-services --cluster ${ECS_CLUSTER_NAME} --services ${RESOURCE_PREFIX}-gateway"
echo ""
echo "  # View running tasks"
echo "  aws ecs list-tasks --cluster ${ECS_CLUSTER_NAME} --service-name ${RESOURCE_PREFIX}-gateway"
echo ""
echo "  # View logs"
echo "  aws logs tail /ecs/${RESOURCE_PREFIX}/gateway --follow"
echo ""
echo "  # Force new deployment"
echo "  aws ecs update-service --cluster ${ECS_CLUSTER_NAME} --service ${RESOURCE_PREFIX}-gateway --force-new-deployment"
echo ""
echo "  # Execute command in container (requires AWS Session Manager)"
echo "  TASK_ID=\$(aws ecs list-tasks --cluster ${ECS_CLUSTER_NAME} --service-name ${RESOURCE_PREFIX}-gateway --query 'taskArns[0]' --output text | cut -d'/' -f3)"
echo "  aws ecs execute-command --cluster ${ECS_CLUSTER_NAME} --task \$TASK_ID --container gateway --interactive --command \"/bin/sh\""
echo ""
echo "============================================================================="
