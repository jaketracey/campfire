#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create SSM Parameters
# =============================================================================
# Creates SSM parameters required for ECS task definitions
#
# Usage: ./scripts/create-ssm-params.sh
#
# This script will prompt for sensitive values or you can set environment
# variables before running:
#   export DATABASE_URL="postgresql://..."
#   export REDIS_URL="redis://..."
#   etc.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../00-config.sh"

check_aws_cli

log "Creating SSM parameters for environment: ${ENVIRONMENT}"

# Helper function to create or update parameter
create_param() {
    local name="$1"
    local value="$2"
    local description="$3"
    local type="${4:-SecureString}"

    if [[ -z "${value}" ]]; then
        log "Skipping ${name} - no value provided"
        return 0
    fi

    log "Creating parameter: ${name}"
    aws ssm put-parameter \
        --name "/${RESOURCE_PREFIX}/${name}" \
        --value "${value}" \
        --type "${type}" \
        --description "${description}" \
        --overwrite \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" 2>/dev/null || \
    aws ssm put-parameter \
        --name "/${RESOURCE_PREFIX}/${name}" \
        --value "${value}" \
        --type "${type}" \
        --description "${description}" \
        --overwrite

    log "Parameter created: /${RESOURCE_PREFIX}/${name}"
}

# Prompt for value if not set
prompt_value() {
    local var_name="$1"
    local prompt="$2"
    local current_value="${!var_name:-}"

    if [[ -z "${current_value}" ]]; then
        read -sp "${prompt}: " value
        echo ""
        echo "${value}"
    else
        echo "${current_value}"
    fi
}

echo "============================================================================="
echo "SSM Parameter Setup"
echo "============================================================================="
echo ""
echo "This script will create the required SSM parameters for the application."
echo "You can either:"
echo "  1. Set environment variables before running this script"
echo "  2. Enter values when prompted"
echo ""
echo "Required parameters:"
echo "  - DATABASE_URL (PostgreSQL connection string)"
echo "  - REDIS_URL (Redis connection string)"
echo "  - JWT_SECRET (JWT signing secret)"
echo "  - SESSION_SECRET (Session encryption secret)"
echo ""
echo "Optional API keys:"
echo "  - ANTHROPIC_API_KEY"
echo "  - OPENAI_API_KEY"
echo "  - DEEPGRAM_API_KEY"
echo "  - ELEVENLABS_API_KEY"
echo "  - REPLICATE_API_TOKEN"
echo ""
echo "============================================================================="
echo ""

# Check if vpc-outputs.env exists for database URL
if [[ -f "${SCRIPT_DIR}/../vpc-outputs.env" ]]; then
    source "${SCRIPT_DIR}/../vpc-outputs.env"
fi

# Database URL
if [[ -z "${DATABASE_URL:-}" ]]; then
    if [[ -f "${SCRIPT_DIR}/../.database-url" ]]; then
        source "${SCRIPT_DIR}/../.database-url"
        log "Loaded DATABASE_URL from .database-url file"
    else
        DATABASE_URL=$(prompt_value "DATABASE_URL" "Enter DATABASE_URL (postgresql://user:pass@host:5432/db)")
    fi
fi
create_param "database-url" "${DATABASE_URL:-}" "PostgreSQL database connection URL"

# Redis URL
REDIS_URL="${REDIS_URL:-}"
if [[ -z "${REDIS_URL}" ]]; then
    read -p "Enter REDIS_URL (redis://host:6379) [skip]: " REDIS_URL
fi
create_param "redis-url" "${REDIS_URL:-}" "Redis connection URL"

# JWT Secret
JWT_SECRET="${JWT_SECRET:-}"
if [[ -z "${JWT_SECRET}" ]]; then
    JWT_SECRET=$(openssl rand -base64 32)
    log "Generated random JWT secret"
fi
create_param "jwt-secret" "${JWT_SECRET}" "JWT signing secret"

# Session Secret
SESSION_SECRET="${SESSION_SECRET:-}"
if [[ -z "${SESSION_SECRET}" ]]; then
    SESSION_SECRET=$(openssl rand -base64 32)
    log "Generated random session secret"
fi
create_param "session-secret" "${SESSION_SECRET}" "Session encryption secret"

# Optional API Keys
echo ""
echo "Optional API Keys (press Enter to skip):"
echo ""

ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
if [[ -z "${ANTHROPIC_API_KEY}" ]]; then
    read -sp "Enter ANTHROPIC_API_KEY [skip]: " ANTHROPIC_API_KEY
    echo ""
fi
create_param "anthropic-api-key" "${ANTHROPIC_API_KEY:-}" "Anthropic API key"

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
if [[ -z "${OPENAI_API_KEY}" ]]; then
    read -sp "Enter OPENAI_API_KEY [skip]: " OPENAI_API_KEY
    echo ""
fi
create_param "openai-api-key" "${OPENAI_API_KEY:-}" "OpenAI API key"

DEEPGRAM_API_KEY="${DEEPGRAM_API_KEY:-}"
if [[ -z "${DEEPGRAM_API_KEY}" ]]; then
    read -sp "Enter DEEPGRAM_API_KEY [skip]: " DEEPGRAM_API_KEY
    echo ""
fi
create_param "deepgram-api-key" "${DEEPGRAM_API_KEY:-}" "Deepgram API key"

ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-}"
if [[ -z "${ELEVENLABS_API_KEY}" ]]; then
    read -sp "Enter ELEVENLABS_API_KEY [skip]: " ELEVENLABS_API_KEY
    echo ""
fi
create_param "elevenlabs-api-key" "${ELEVENLABS_API_KEY:-}" "ElevenLabs API key"

REPLICATE_API_TOKEN="${REPLICATE_API_TOKEN:-}"
if [[ -z "${REPLICATE_API_TOKEN}" ]]; then
    read -sp "Enter REPLICATE_API_TOKEN [skip]: " REPLICATE_API_TOKEN
    echo ""
fi
create_param "replicate-api-token" "${REPLICATE_API_TOKEN:-}" "Replicate API token"

# Summary
echo ""
echo "============================================================================="
echo "SSM Parameters Created"
echo "============================================================================="
echo ""
echo "Parameters created in: /${RESOURCE_PREFIX}/"
aws ssm describe-parameters \
    --parameter-filters Key=Path,Option=Recursive,Values="/${RESOURCE_PREFIX}/" \
    --query 'Parameters[*].[Name,Type]' \
    --output table
echo ""
echo "To view a parameter value:"
echo "  aws ssm get-parameter --name /${RESOURCE_PREFIX}/database-url --with-decryption"
echo ""
echo "============================================================================="
