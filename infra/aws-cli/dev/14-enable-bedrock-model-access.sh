#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Enable Bedrock Model Access
# =============================================================================
# Enables access to foundation models in AWS Bedrock.
# NOTE: Model access must also be enabled in the AWS Console at:
#   https://{region}.console.aws.amazon.com/bedrock/home#/modelaccess
#
# Usage: ./14-enable-bedrock-model-access.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "Configuring Bedrock model access for environment: ${ENVIRONMENT}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# -----------------------------------------------------------------------------
# List Available Models
# -----------------------------------------------------------------------------
log "Checking available Bedrock foundation models..."

echo ""
echo "Available Foundation Models in ${AWS_REGION}:"
echo "============================================="

aws bedrock list-foundation-models \
    --output table \
    --query 'modelSummaries[?contains(modelId, `anthropic`) || contains(modelId, `meta`) || contains(modelId, `mistral`)].{ModelId:modelId,Provider:providerName,Status:modelLifecycle.status}' \
    2>/dev/null || echo "Unable to list models. Please check AWS Console."

echo ""
echo "============================================================================="
echo "IMPORTANT: Model Access Configuration Required"
echo "============================================================================="
echo ""
echo "You must enable model access in the AWS Console before using Bedrock models."
echo "This is a one-time manual step that cannot be automated."
echo ""
echo "1. Visit the Bedrock Model Access page:"
echo "   https://${AWS_REGION}.console.aws.amazon.com/bedrock/home?region=${AWS_REGION}#/modelaccess"
echo ""
echo "2. Click 'Manage model access'"
echo ""
echo "3. Enable the following models for Campfire:"
echo "   - Anthropic: Claude 3.5 Sonnet, Claude 3 Haiku"
echo "   - Meta: Llama 3.1 70B Instruct, Llama 3.1 8B Instruct"
echo "   - Mistral: Mistral Large"
echo "   - Amazon: Titan Text Lite, Titan Text Express (optional)"
echo ""
echo "4. Accept the Terms of Service for each model provider"
echo ""
echo "5. Wait for access to be granted (usually immediate)"
echo ""
echo "============================================================================="
echo "Recommended Models by Use Case:"
echo "============================================================================="
echo ""
echo "Primary (quality): anthropic.claude-3-5-sonnet-20241022-v2:0"
echo "  - Best for: Complex conversations, emotional intelligence"
echo "  - Cost: \$3.00/\$15.00 per 1M tokens (input/output)"
echo ""
echo "Fast/Cheap: anthropic.claude-3-haiku-20240307-v1:0"
echo "  - Best for: Quick responses, simple tasks, high volume"
echo "  - Cost: \$0.25/\$1.25 per 1M tokens (input/output)"
echo ""
echo "Open Source: meta.llama3-1-70b-instruct-v1:0"
echo "  - Best for: Cost-effective quality, no vendor lock-in"
echo "  - Cost: \$0.99/\$0.99 per 1M tokens (input/output)"
echo ""
echo "============================================================================="
echo ""
echo "After enabling model access, update your environment configuration:"
echo ""
echo "For staging/production, set in 00-config.sh or environment:"
echo "  export AI_INFERENCE_PROVIDER=bedrock"
echo "  export BEDROCK_ENABLED=true"
echo "  export BEDROCK_DEFAULT_MODEL=anthropic.claude-3-5-sonnet-20241022-v2:0"
echo ""
echo "============================================================================="
