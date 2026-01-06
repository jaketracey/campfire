#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - View Service Logs
# =============================================================================
# Tail logs from ECS services via CloudWatch
#
# Usage: ./scripts/logs.sh <service_name> [--follow] [--since <time>]
#
# Examples:
#   ./scripts/logs.sh gateway               # View last 30 minutes of logs
#   ./scripts/logs.sh gateway --follow      # Tail logs in real-time
#   ./scripts/logs.sh gateway --since 1h    # View logs from last hour
#   ./scripts/logs.sh orchestrator --since 2024-01-01T00:00:00Z
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../00-config.sh"

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <service_name> [--follow] [--since <time>]"
    echo ""
    echo "Services: gateway, orchestrator, web, workers"
    echo ""
    echo "Options:"
    echo "  --follow, -f    Follow logs in real-time"
    echo "  --since         Start time (e.g., 30m, 1h, 2d, or ISO8601 timestamp)"
    echo "  --filter        Filter pattern for logs"
    echo ""
    echo "Examples:"
    echo "  $0 gateway"
    echo "  $0 gateway --follow"
    echo "  $0 orchestrator --since 1h"
    echo "  $0 web --filter ERROR"
    exit 1
fi

SERVICE="$1"
shift

# Default options
FOLLOW=""
SINCE="30m"
FILTER=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --follow|-f)
            FOLLOW="--follow"
            shift
            ;;
        --since)
            SINCE="$2"
            shift 2
            ;;
        --filter)
            FILTER="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

LOG_GROUP="/ecs/${RESOURCE_PREFIX}/${SERVICE}"

log "Viewing logs for ${SERVICE} from ${LOG_GROUP}"

# Build command
CMD="aws logs tail ${LOG_GROUP} --since ${SINCE}"

if [[ -n "${FOLLOW}" ]]; then
    CMD="${CMD} --follow"
fi

if [[ -n "${FILTER}" ]]; then
    CMD="${CMD} --filter-pattern \"${FILTER}\""
fi

echo "Executing: ${CMD}"
echo "============================================================================="
echo ""

eval "${CMD}"
