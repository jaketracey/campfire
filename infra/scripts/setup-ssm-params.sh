#!/bin/bash
# =============================================================================
# Campfire Deployment Helper - Setup SSM Parameters
# =============================================================================
# Interactive script to create required SSM parameters for ECS services
#
# Usage: ./setup-ssm-params.sh <environment>
#
# Arguments:
#   environment - dev, staging, or prod
#
# Examples:
#   ./setup-ssm-params.sh dev
#   ./setup-ssm-params.sh staging
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Color Output
# -----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1" >&2
}

# -----------------------------------------------------------------------------
# Usage
# -----------------------------------------------------------------------------
usage() {
    echo "Usage: $0 <environment>"
    echo ""
    echo "Arguments:"
    echo "  environment - dev, staging, or prod"
    echo ""
    echo "Examples:"
    echo "  $0 dev"
    echo "  $0 staging"
    exit 1
}

# -----------------------------------------------------------------------------
# Validate Arguments
# -----------------------------------------------------------------------------
if [[ $# -lt 1 ]]; then
    log_error "Missing required arguments"
    usage
fi

ENVIRONMENT="$1"

VALID_ENVIRONMENTS=("dev" "staging" "prod")

if [[ ! " ${VALID_ENVIRONMENTS[*]} " =~ " ${ENVIRONMENT} " ]]; then
    log_error "Invalid environment: ${ENVIRONMENT}"
    log_error "Valid environments: ${VALID_ENVIRONMENTS[*]}"
    exit 1
fi

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
PROJECT_NAME="campfire"
RESOURCE_PREFIX="${PROJECT_NAME}-${ENVIRONMENT}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PARAM_PREFIX="/${RESOURCE_PREFIX}"

echo ""
echo -e "${CYAN}=============================================================================${NC}"
echo -e "${CYAN}            SSM Parameter Setup - ${ENVIRONMENT}${NC}"
echo -e "${CYAN}=============================================================================${NC}"
echo ""
echo "This script will help you create the required SSM parameters for Campfire."
echo "All parameters will be stored as SecureString (encrypted with AWS KMS)."
echo ""
echo "Parameter prefix: ${PARAM_PREFIX}"
echo ""

# -----------------------------------------------------------------------------
# Define Required Parameters
# -----------------------------------------------------------------------------
declare -A PARAMS
PARAMS=(
    ["database-url"]="PostgreSQL connection URL (e.g., postgresql://user:pass@host:5432/db)"
    ["redis-url"]="Redis connection URL (e.g., redis://host:6379)"
    ["jwt-secret"]="JWT signing secret (generate with: openssl rand -base64 32)"
    ["session-secret"]="Session encryption secret (generate with: openssl rand -base64 32)"
    ["anthropic-api-key"]="Anthropic API key (starts with sk-ant-)"
    ["openai-api-key"]="OpenAI API key (starts with sk-)"
    ["deepgram-api-key"]="Deepgram API key for speech-to-text"
    ["elevenlabs-api-key"]="ElevenLabs API key for text-to-speech"
    ["replicate-api-token"]="Replicate API token for ML models"
)

# Define which params are required vs optional
REQUIRED_PARAMS=("database-url" "redis-url" "jwt-secret" "session-secret")
OPTIONAL_PARAMS=("anthropic-api-key" "openai-api-key" "deepgram-api-key" "elevenlabs-api-key" "replicate-api-token")

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------
param_exists() {
    local param_name="$1"
    aws ssm get-parameter \
        --name "${PARAM_PREFIX}/${param_name}" \
        --region "${AWS_REGION}" > /dev/null 2>&1
}

get_param_value() {
    local param_name="$1"
    aws ssm get-parameter \
        --name "${PARAM_PREFIX}/${param_name}" \
        --with-decryption \
        --query 'Parameter.Value' \
        --output text \
        --region "${AWS_REGION}" 2>/dev/null || echo ""
}

create_or_update_param() {
    local param_name="$1"
    local param_value="$2"
    local description="$3"

    local full_param_name="${PARAM_PREFIX}/${param_name}"

    aws ssm put-parameter \
        --name "${full_param_name}" \
        --value "${param_value}" \
        --type "SecureString" \
        --description "${description}" \
        --overwrite \
        --region "${AWS_REGION}" \
        --tags "Key=Project,Value=${PROJECT_NAME}" "Key=Environment,Value=${ENVIRONMENT}" > /dev/null

    log_success "Parameter created/updated: ${full_param_name}"
}

# Mask value for display
mask_value() {
    local value="$1"
    local len=${#value}
    if [[ ${len} -le 8 ]]; then
        echo "********"
    else
        echo "${value:0:4}...${value: -4}"
    fi
}

# -----------------------------------------------------------------------------
# Check Existing Parameters
# -----------------------------------------------------------------------------
log_info "Checking existing parameters..."
echo ""

echo "Required Parameters:"
for param in "${REQUIRED_PARAMS[@]}"; do
    if param_exists "${param}"; then
        current_value=$(get_param_value "${param}")
        masked=$(mask_value "${current_value}")
        echo -e "  ${GREEN}[EXISTS]${NC} ${param}: ${masked}"
    else
        echo -e "  ${RED}[MISSING]${NC} ${param}"
    fi
done

echo ""
echo "Optional Parameters:"
for param in "${OPTIONAL_PARAMS[@]}"; do
    if param_exists "${param}"; then
        current_value=$(get_param_value "${param}")
        masked=$(mask_value "${current_value}")
        echo -e "  ${GREEN}[EXISTS]${NC} ${param}: ${masked}"
    else
        echo -e "  ${YELLOW}[MISSING]${NC} ${param}"
    fi
done

echo ""

# -----------------------------------------------------------------------------
# Interactive Setup
# -----------------------------------------------------------------------------
echo "============================================================================="
echo "Parameter Configuration"
echo "============================================================================="
echo ""
echo "For each parameter, you can:"
echo "  - Press ENTER to skip (keep existing value)"
echo "  - Enter a new value to create/update"
echo "  - Type 'generate' for secrets to auto-generate a value"
echo ""

CREATED_COUNT=0
SKIPPED_COUNT=0

# Process required parameters
echo -e "${MAGENTA}Required Parameters:${NC}"
echo ""

for param in "${REQUIRED_PARAMS[@]}"; do
    description="${PARAMS[$param]}"

    if param_exists "${param}"; then
        current=$(get_param_value "${param}")
        masked=$(mask_value "${current}")
        echo -e "${CYAN}${param}${NC}"
        echo "  Description: ${description}"
        echo "  Current value: ${masked}"
        read -p "  New value (ENTER to skip, 'generate' for auto): " new_value
    else
        echo -e "${CYAN}${param}${NC} ${RED}(REQUIRED)${NC}"
        echo "  Description: ${description}"
        read -p "  Value ('generate' for auto): " new_value
    fi

    if [[ -z "${new_value}" ]]; then
        if ! param_exists "${param}"; then
            log_warn "Skipping required parameter: ${param}"
        fi
        ((SKIPPED_COUNT++))
    elif [[ "${new_value}" == "generate" ]]; then
        if [[ "${param}" == "jwt-secret" ]] || [[ "${param}" == "session-secret" ]]; then
            new_value=$(openssl rand -base64 32)
            log_info "Generated: $(mask_value "${new_value}")"
            create_or_update_param "${param}" "${new_value}" "${description}"
            ((CREATED_COUNT++))
        else
            log_warn "Cannot auto-generate ${param}. Please provide a value."
            read -p "  Value: " new_value
            if [[ -n "${new_value}" ]]; then
                create_or_update_param "${param}" "${new_value}" "${description}"
                ((CREATED_COUNT++))
            fi
        fi
    else
        create_or_update_param "${param}" "${new_value}" "${description}"
        ((CREATED_COUNT++))
    fi
    echo ""
done

# Process optional parameters
echo ""
echo -e "${MAGENTA}Optional Parameters (API Keys):${NC}"
echo ""
read -p "Configure optional API key parameters? (y/N): " CONFIGURE_OPTIONAL

if [[ "${CONFIGURE_OPTIONAL}" =~ ^[Yy]$ ]]; then
    echo ""
    for param in "${OPTIONAL_PARAMS[@]}"; do
        description="${PARAMS[$param]}"

        if param_exists "${param}"; then
            current=$(get_param_value "${param}")
            masked=$(mask_value "${current}")
            echo -e "${CYAN}${param}${NC}"
            echo "  Description: ${description}"
            echo "  Current value: ${masked}"
            read -p "  New value (ENTER to skip): " new_value
        else
            echo -e "${CYAN}${param}${NC}"
            echo "  Description: ${description}"
            read -p "  Value (ENTER to skip): " new_value
        fi

        if [[ -z "${new_value}" ]]; then
            ((SKIPPED_COUNT++))
        else
            create_or_update_param "${param}" "${new_value}" "${description}"
            ((CREATED_COUNT++))
        fi
        echo ""
    done
else
    log_info "Skipping optional parameters"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo -e "${CYAN}SSM Parameter Setup Complete${NC}"
echo "============================================================================="
echo "Environment:      ${ENVIRONMENT}"
echo "Parameter Prefix: ${PARAM_PREFIX}"
echo "Created/Updated:  ${CREATED_COUNT}"
echo "Skipped:          ${SKIPPED_COUNT}"
echo ""

# Final verification
log_info "Final parameter status:"
echo ""

MISSING_REQUIRED=()
for param in "${REQUIRED_PARAMS[@]}"; do
    if param_exists "${param}"; then
        echo -e "  ${GREEN}[OK]${NC} ${param}"
    else
        echo -e "  ${RED}[MISSING]${NC} ${param}"
        MISSING_REQUIRED+=("${param}")
    fi
done

for param in "${OPTIONAL_PARAMS[@]}"; do
    if param_exists "${param}"; then
        echo -e "  ${GREEN}[OK]${NC} ${param}"
    else
        echo -e "  ${YELLOW}[OPTIONAL]${NC} ${param}"
    fi
done

echo ""

if [[ ${#MISSING_REQUIRED[@]} -gt 0 ]]; then
    log_warn "Missing required parameters: ${MISSING_REQUIRED[*]}"
    log_warn "ECS services may fail to start without these parameters"
else
    log_success "All required parameters are configured!"
fi

echo ""
echo "To view a parameter value:"
echo "  aws ssm get-parameter --name ${PARAM_PREFIX}/database-url --with-decryption --query 'Parameter.Value' --output text"
echo ""
echo "To list all parameters:"
echo "  aws ssm get-parameters-by-path --path ${PARAM_PREFIX} --recursive --query 'Parameters[*].Name'"
echo "============================================================================="
