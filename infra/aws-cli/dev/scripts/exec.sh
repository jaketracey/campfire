#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Execute Command in Container
# =============================================================================
# Opens an interactive shell or runs a command in an ECS container
#
# Usage: ./scripts/exec.sh <service_name> [command]
#
# Examples:
#   ./scripts/exec.sh gateway              # Opens /bin/sh shell
#   ./scripts/exec.sh gateway "ls -la"     # Runs command
#   ./scripts/exec.sh orchestrator "npm run migrate"
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../00-config.sh"
source "${SCRIPT_DIR}/../vpc-outputs.env"

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <service_name> [command]"
    echo ""
    echo "Services: gateway, orchestrator, web, workers"
    echo ""
    echo "Examples:"
    echo "  $0 gateway                    # Opens /bin/sh shell"
    echo "  $0 gateway 'ls -la'           # Runs command"
    echo "  $0 orchestrator 'npm run migrate'"
    exit 1
fi

SERVICE="$1"
COMMAND="${2:-/bin/sh}"

FULL_SERVICE_NAME="${RESOURCE_PREFIX}-${SERVICE}"

log "Finding running task for ${FULL_SERVICE_NAME}..."

# Get the running task ARN
TASK_ARN=$(aws ecs list-tasks \
    --cluster "${ECS_CLUSTER_NAME}" \
    --service-name "${FULL_SERVICE_NAME}" \
    --desired-status RUNNING \
    --query 'taskArns[0]' \
    --output text)

if [[ -z "${TASK_ARN}" || "${TASK_ARN}" == "None" ]]; then
    error "No running tasks found for service ${FULL_SERVICE_NAME}"
fi

# Extract task ID from ARN
TASK_ID="${TASK_ARN##*/}"

log "Found task: ${TASK_ID}"
log "Executing command: ${COMMAND}"

echo "============================================================================="
echo ""

# Execute command
aws ecs execute-command \
    --cluster "${ECS_CLUSTER_NAME}" \
    --task "${TASK_ID}" \
    --container "${SERVICE}" \
    --interactive \
    --command "${COMMAND}"
