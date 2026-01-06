#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Logging helpers
# -----------------------------------------------------------------------------
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

warn() {
  echo "[WARN] $1" >&2
}

error() {
  echo "[ERROR] $1" >&2
  exit 1
}

# -----------------------------------------------------------------------------
# AWS CLI checks
# -----------------------------------------------------------------------------
check_aws_cli() {
  if ! command -v aws &> /dev/null; then
    error "AWS CLI is not installed. Please install it first."
  fi

  if ! aws sts get-caller-identity &> /dev/null; then
    error "AWS CLI is not configured. Please run 'aws configure' first."
  fi

  log "AWS CLI configured for account: $(aws sts get-caller-identity --query Account --output text)"
}

# -----------------------------------------------------------------------------
# Confirmations
# -----------------------------------------------------------------------------
confirm_action() {
  local message="$1"
  read -r -p "[CONFIRM] ${message} (y/N): " response
  case "${response}" in
    [yY][eE][sS]|[yY]) return 0 ;;
    *) return 1 ;;
  esac
}

confirm_production() {
  if [[ "${ENVIRONMENT:-}" != "prod" ]]; then
    return 0
  fi

  if [[ "${SKIP_CONFIRMATION:-false}" == "true" ]]; then
    return 0
  fi

  echo ""
  echo "=========================================="
  echo "  WARNING: PRODUCTION ENVIRONMENT"
  echo "=========================================="
  echo ""
  echo "You are about to make changes to the PRODUCTION environment."
  echo "Region: ${AWS_REGION:-}"
  echo "Account: $(aws sts get-caller-identity --query Account --output text)"
  echo ""
  read -r -p "Are you sure you want to continue? (type 'yes' to confirm): " confirmation
  if [[ "${confirmation}" != "yes" ]]; then
    error "Deployment cancelled by user"
  fi
}

# -----------------------------------------------------------------------------
# Tags helpers
# -----------------------------------------------------------------------------
get_tags() {
  local tags=(
    "{\"Key\": \"Project\", \"Value\": \"${TAG_PROJECT}\"}"
    "{\"Key\": \"Environment\", \"Value\": \"${TAG_ENVIRONMENT}\"}"
    "{\"Key\": \"ManagedBy\", \"Value\": \"${TAG_MANAGED_BY}\"}"
  )

  if [[ -n "${TAG_COST_CENTER:-}" ]]; then
    tags+=("{\"Key\": \"CostCenter\", \"Value\": \"${TAG_COST_CENTER}\"}")
  fi
  if [[ -n "${TAG_OWNER:-}" ]]; then
    tags+=("{\"Key\": \"Owner\", \"Value\": \"${TAG_OWNER}\"}")
  fi

  printf '[\n'
  local i
  for ((i = 0; i < ${#tags[@]}; i++)); do
    if [[ $i -lt $((${#tags[@]} - 1)) ]]; then
      printf '  %s,\n' "${tags[$i]}"
    else
      printf '  %s\n' "${tags[$i]}"
    fi
  done
  printf ']\n'
}

get_tags_cli() {
  local tags=(
    "Key=Project,Value=${TAG_PROJECT}"
    "Key=Environment,Value=${TAG_ENVIRONMENT}"
    "Key=ManagedBy,Value=${TAG_MANAGED_BY}"
  )
  if [[ -n "${TAG_COST_CENTER:-}" ]]; then
    tags+=("Key=CostCenter,Value=${TAG_COST_CENTER}")
  fi
  if [[ -n "${TAG_OWNER:-}" ]]; then
    tags+=("Key=Owner,Value=${TAG_OWNER}")
  fi

  echo "${tags[*]}"
}

# -----------------------------------------------------------------------------
# Wait helpers
# -----------------------------------------------------------------------------
wait_for_resource() {
  local resource_type="$1"
  local resource_id="$2"
  local max_attempts="${3:-60}"
  local sleep_time="${4:-10}"

  log "Waiting for ${resource_type} ${resource_id} to be available..."

  local status
  local i
  for ((i = 1; i <= max_attempts; i++)); do
    case "${resource_type}" in
      "rds")
        status=$(aws rds describe-db-instances \
          --db-instance-identifier "${resource_id}" \
          --query 'DBInstances[0].DBInstanceStatus' \
          --output text 2>/dev/null || echo "pending")
        ;;
      "elasticache")
        status=$(aws elasticache describe-replication-groups \
          --replication-group-id "${resource_id}" \
          --query 'ReplicationGroups[0].Status' \
          --output text 2>/dev/null || echo "creating")
        ;;
      *)
        status="available"
        ;;
    esac

    if [[ "${status}" == "available" ]]; then
      log "${resource_type} ${resource_id} is now available"
      return 0
    fi

    log "Status: ${status}. Attempt ${i}/${max_attempts}. Waiting ${sleep_time}s..."
    sleep "${sleep_time}"
  done

  error "Timeout waiting for ${resource_type} ${resource_id}"
}
