#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Deploy Services to ECS (Production)
# =============================================================================
# Creates ECS services with auto-scaling and deploys containers
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
confirm_production

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
    local min_count="$7"
    local max_count="$8"
    local discovery_service_name="$9"
    local use_spot="${10:-false}"

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
        --filters Name=NAMESPACE_ID,Values="${SERVICE_DISCOVERY_NAMESPACE_ID}",Condition=EQ \
        --query "Services[?Name=='${discovery_service_name}'].Arn" \
        --output text)

    # Set capacity provider strategy based on criticality
    if [[ "${use_spot}" == "true" ]]; then
        CAPACITY_PROVIDER_STRATEGY="capacityProvider=FARGATE,weight=1,base=1 capacityProvider=FARGATE_SPOT,weight=3,base=0"
    else
        CAPACITY_PROVIDER_STRATEGY="capacityProvider=FARGATE,weight=1,base=${min_count}"
    fi

    # Check if service exists
    if aws ecs describe-services --cluster "${ECS_CLUSTER_NAME}" --services "${full_service_name}" --query 'services[?status==`ACTIVE`].serviceName' --output text | grep -q "${full_service_name}"; then
        log "Service exists, updating..."

        aws ecs update-service \
            --cluster "${ECS_CLUSTER_NAME}" \
            --service "${full_service_name}" \
            --task-definition "${TASK_DEF_ARN}" \
            --desired-count "${desired_count}" \
            --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}" \
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
                --capacity-provider-strategy ${CAPACITY_PROVIDER_STRATEGY} \
                --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1_ID},${PRIVATE_SUBNET_2_ID},${PRIVATE_SUBNET_3_ID}],securityGroups=[${ECS_SG_ID}],assignPublicIp=DISABLED}" \
                --load-balancers "${LB_CONFIG}" \
                --service-registries "registryArn=${DISCOVERY_SERVICE_ARN}" \
                --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}" \
                --deployment-controller type=ECS \
                --enable-execute-command \
                --propagate-tags SERVICE \
                --tags key=Project,value="${TAG_PROJECT}" key=Environment,value="${TAG_ENVIRONMENT}" key=Service,value="${service_name}" key=CostCenter,value="${TAG_COST_CENTER}"
        else
            # Service without load balancer (e.g., workers)
            aws ecs create-service \
                --cluster "${ECS_CLUSTER_NAME}" \
                --service-name "${full_service_name}" \
                --task-definition "${TASK_DEF_ARN}" \
                --desired-count "${desired_count}" \
                --capacity-provider-strategy ${CAPACITY_PROVIDER_STRATEGY} \
                --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1_ID},${PRIVATE_SUBNET_2_ID},${PRIVATE_SUBNET_3_ID}],securityGroups=[${ECS_SG_ID}],assignPublicIp=DISABLED}" \
                --service-registries "registryArn=${DISCOVERY_SERVICE_ARN}" \
                --deployment-configuration "minimumHealthyPercent=50,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}" \
                --deployment-controller type=ECS \
                --enable-execute-command \
                --propagate-tags SERVICE \
                --tags key=Project,value="${TAG_PROJECT}" key=Environment,value="${TAG_ENVIRONMENT}" key=Service,value="${service_name}" key=CostCenter,value="${TAG_COST_CENTER}"
        fi

        log "Service created: ${full_service_name}"
    fi

    # Configure auto-scaling
    log "Configuring auto-scaling for ${full_service_name}"

    # Register scalable target
    aws application-autoscaling register-scalable-target \
        --service-namespace ecs \
        --resource-id "service/${ECS_CLUSTER_NAME}/${full_service_name}" \
        --scalable-dimension ecs:service:DesiredCount \
        --min-capacity "${min_count}" \
        --max-capacity "${max_count}"

    # CPU-based scaling policy
    aws application-autoscaling put-scaling-policy \
        --service-namespace ecs \
        --resource-id "service/${ECS_CLUSTER_NAME}/${full_service_name}" \
        --scalable-dimension ecs:service:DesiredCount \
        --policy-name "${full_service_name}-cpu-scaling" \
        --policy-type TargetTrackingScaling \
        --target-tracking-scaling-policy-configuration "{
            \"TargetValue\": ${AUTOSCALING_TARGET_CPU},
            \"PredefinedMetricSpecification\": {
                \"PredefinedMetricType\": \"ECSServiceAverageCPUUtilization\"
            },
            \"ScaleInCooldown\": ${AUTOSCALING_SCALE_IN_COOLDOWN},
            \"ScaleOutCooldown\": ${AUTOSCALING_SCALE_OUT_COOLDOWN}
        }"

    # Memory-based scaling policy
    aws application-autoscaling put-scaling-policy \
        --service-namespace ecs \
        --resource-id "service/${ECS_CLUSTER_NAME}/${full_service_name}" \
        --scalable-dimension ecs:service:DesiredCount \
        --policy-name "${full_service_name}-memory-scaling" \
        --policy-type TargetTrackingScaling \
        --target-tracking-scaling-policy-configuration "{
            \"TargetValue\": ${AUTOSCALING_TARGET_MEMORY},
            \"PredefinedMetricSpecification\": {
                \"PredefinedMetricType\": \"ECSServiceAverageMemoryUtilization\"
            },
            \"ScaleInCooldown\": ${AUTOSCALING_SCALE_IN_COOLDOWN},
            \"ScaleOutCooldown\": ${AUTOSCALING_SCALE_OUT_COOLDOWN}
        }"

    log "Auto-scaling configured for ${full_service_name} (min: ${min_count}, max: ${max_count})"
}

# -----------------------------------------------------------------------------
# Deploy Services
# -----------------------------------------------------------------------------

if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "gateway" ]]; then
    deploy_service "gateway" "${RESOURCE_PREFIX}-gateway" "${GATEWAY_TG_ARN}" "gateway" "4000" \
        "${GATEWAY_DESIRED_COUNT}" "${GATEWAY_MIN_COUNT}" "${GATEWAY_MAX_COUNT}" "gateway" "false"
fi

if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "orchestrator" ]]; then
    # Orchestrator doesn't need ALB (internal service)
    deploy_service "orchestrator" "${RESOURCE_PREFIX}-orchestrator" "" "orchestrator" "5000" \
        "${ORCHESTRATOR_DESIRED_COUNT}" "${ORCHESTRATOR_MIN_COUNT}" "${ORCHESTRATOR_MAX_COUNT}" "orchestrator" "false"
fi

if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "web" ]]; then
    deploy_service "web" "${RESOURCE_PREFIX}-web" "${WEB_TG_ARN}" "web" "3000" \
        "${WEB_DESIRED_COUNT}" "${WEB_MIN_COUNT}" "${WEB_MAX_COUNT}" "web" "false"
fi

if [[ "${SERVICE_TO_DEPLOY}" == "all" || "${SERVICE_TO_DEPLOY}" == "workers" ]]; then
    # Workers can use SPOT for cost savings
    deploy_service "workers" "${RESOURCE_PREFIX}-workers" "" "workers" "8080" \
        "${WORKERS_DESIRED_COUNT}" "${WORKERS_MIN_COUNT}" "${WORKERS_MAX_COUNT}" "workers" "true"
fi

# -----------------------------------------------------------------------------
# Wait for services to stabilize
# -----------------------------------------------------------------------------
log "Waiting for services to stabilize (this may take several minutes)..."

if [[ "${SERVICE_TO_DEPLOY}" == "all" ]]; then
    SERVICES_TO_WAIT="${RESOURCE_PREFIX}-gateway ${RESOURCE_PREFIX}-orchestrator ${RESOURCE_PREFIX}-web ${RESOURCE_PREFIX}-workers"
else
    SERVICES_TO_WAIT="${RESOURCE_PREFIX}-${SERVICE_TO_DEPLOY}"
fi

# Wait with timeout
aws ecs wait services-stable \
    --cluster "${ECS_CLUSTER_NAME}" \
    --services ${SERVICES_TO_WAIT}

log "All services are stable"

# -----------------------------------------------------------------------------
# Verify deployment
# -----------------------------------------------------------------------------
log "Verifying deployment..."

for service in ${SERVICES_TO_WAIT}; do
    RUNNING_COUNT=$(aws ecs describe-services \
        --cluster "${ECS_CLUSTER_NAME}" \
        --services "${service}" \
        --query 'services[0].runningCount' \
        --output text)

    DESIRED_COUNT=$(aws ecs describe-services \
        --cluster "${ECS_CLUSTER_NAME}" \
        --services "${service}" \
        --query 'services[0].desiredCount' \
        --output text)

    if [[ "${RUNNING_COUNT}" == "${DESIRED_COUNT}" ]]; then
        log "${service}: OK (${RUNNING_COUNT}/${DESIRED_COUNT} tasks running)"
    else
        warn "${service}: DEGRADED (${RUNNING_COUNT}/${DESIRED_COUNT} tasks running)"
    fi
done

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "Services Deployed Successfully (Production)"
echo "============================================================================="
echo "Cluster: ${ECS_CLUSTER_NAME}"
echo ""
echo "Services:"
aws ecs list-services --cluster "${ECS_CLUSTER_NAME}" --query 'serviceArns[*]' --output table
echo ""
echo "Auto-Scaling Configuration:"
echo "  Target CPU:        ${AUTOSCALING_TARGET_CPU}%"
echo "  Target Memory:     ${AUTOSCALING_TARGET_MEMORY}%"
echo "  Scale-in Cooldown: ${AUTOSCALING_SCALE_IN_COOLDOWN}s"
echo "  Scale-out Cooldown: ${AUTOSCALING_SCALE_OUT_COOLDOWN}s"
echo ""
echo "Service Limits:"
echo "  Gateway:      min=${GATEWAY_MIN_COUNT}, max=${GATEWAY_MAX_COUNT}"
echo "  Orchestrator: min=${ORCHESTRATOR_MIN_COUNT}, max=${ORCHESTRATOR_MAX_COUNT}"
echo "  Web:          min=${WEB_MIN_COUNT}, max=${WEB_MAX_COUNT}"
echo "  Workers:      min=${WORKERS_MIN_COUNT}, max=${WORKERS_MAX_COUNT} (SPOT enabled)"
echo ""
if [[ -n "${HTTPS_LISTENER_ARN:-}" ]]; then
    echo "Application URL: https://${ALB_DNS}"
else
    echo "Application URL: http://${ALB_DNS}"
fi
echo ""
echo "Useful commands:"
echo ""
echo "  # View service status"
echo "  aws ecs describe-services --cluster ${ECS_CLUSTER_NAME} --services ${RESOURCE_PREFIX}-gateway"
echo ""
echo "  # View running tasks"
echo "  aws ecs list-tasks --cluster ${ECS_CLUSTER_NAME} --service-name ${RESOURCE_PREFIX}-gateway"
echo ""
echo "  # View logs (last 30 minutes)"
echo "  aws logs tail /ecs/${RESOURCE_PREFIX}/gateway --since 30m --follow"
echo ""
echo "  # Force new deployment (rolling update)"
echo "  aws ecs update-service --cluster ${ECS_CLUSTER_NAME} --service ${RESOURCE_PREFIX}-gateway --force-new-deployment"
echo ""
echo "  # Execute command in container (debugging)"
echo "  TASK_ID=\$(aws ecs list-tasks --cluster ${ECS_CLUSTER_NAME} --service-name ${RESOURCE_PREFIX}-gateway --query 'taskArns[0]' --output text | cut -d'/' -f3)"
echo "  aws ecs execute-command --cluster ${ECS_CLUSTER_NAME} --task \$TASK_ID --container gateway --interactive --command \"/bin/sh\""
echo ""
echo "  # Scale service manually"
echo "  aws ecs update-service --cluster ${ECS_CLUSTER_NAME} --service ${RESOURCE_PREFIX}-gateway --desired-count 5"
echo ""
echo "============================================================================="
echo ""
echo "PRODUCTION DEPLOYMENT COMPLETE"
echo ""
echo "Post-deployment checklist:"
echo "  [ ] Verify health checks passing in ALB target groups"
echo "  [ ] Check CloudWatch dashboard for any errors"
echo "  [ ] Verify SNS alert subscriptions are confirmed"
echo "  [ ] Run smoke tests against production URL"
echo "  [ ] Monitor for 15-30 minutes before considering deployment complete"
echo ""
echo "============================================================================="
