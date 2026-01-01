#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create RDS PostgreSQL Instance
# =============================================================================
# Creates RDS PostgreSQL instance with pgvector extension support
#
# Usage: ./04-create-rds.sh
#
# This script is idempotent - running it multiple times will not create
# duplicate resources. Existing resources will be detected and reused.
#
# Note: PostgreSQL 16.x is used as it's the latest major version with
# pgvector support on AWS RDS. Version is configured in 00-config.sh.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli

log "Creating RDS PostgreSQL instance for environment: ${ENVIRONMENT}"

# -----------------------------------------------------------------------------
# Generate or read database password
# -----------------------------------------------------------------------------
RDS_PASSWORD_FILE="${SCRIPT_DIR}/.rds-password"

if [[ -f "${RDS_PASSWORD_FILE}" ]]; then
    RDS_MASTER_PASSWORD=$(cat "${RDS_PASSWORD_FILE}")
    log "Using existing RDS password from ${RDS_PASSWORD_FILE}"
else
    # Generate a secure random password
    RDS_MASTER_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)
    echo "${RDS_MASTER_PASSWORD}" > "${RDS_PASSWORD_FILE}"
    chmod 600 "${RDS_PASSWORD_FILE}"
    log "Generated new RDS password and saved to ${RDS_PASSWORD_FILE}"
fi

# -----------------------------------------------------------------------------
# Create DB Subnet Group
# -----------------------------------------------------------------------------
log "Creating DB subnet group"

DB_SUBNET_GROUP_NAME="${RESOURCE_PREFIX}-db-subnet-group"

# Check if subnet group exists
EXISTING_SUBNET_GROUP=$(aws rds describe-db-subnet-groups \
    --db-subnet-group-name "${DB_SUBNET_GROUP_NAME}" \
    --query 'DBSubnetGroups[0].DBSubnetGroupName' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_SUBNET_GROUP}" != "None" && -n "${EXISTING_SUBNET_GROUP}" ]]; then
    log "DB subnet group already exists: ${DB_SUBNET_GROUP_NAME}"
else
    aws rds create-db-subnet-group \
        --db-subnet-group-name "${DB_SUBNET_GROUP_NAME}" \
        --db-subnet-group-description "Subnet group for Campfire RDS instances" \
        --subnet-ids "${PRIVATE_SUBNET_1_ID}" "${PRIVATE_SUBNET_2_ID}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"
    log "DB subnet group created: ${DB_SUBNET_GROUP_NAME}"
fi

# -----------------------------------------------------------------------------
# Create RDS Parameter Group (for pgvector)
# -----------------------------------------------------------------------------
log "Creating parameter group for pgvector support"

PARAMETER_GROUP_NAME="${RESOURCE_PREFIX}-postgres-params"
PARAMETER_GROUP_FAMILY="postgres16"

# Check if parameter group exists
EXISTING_PARAM_GROUP=$(aws rds describe-db-parameter-groups \
    --db-parameter-group-name "${PARAMETER_GROUP_NAME}" \
    --query 'DBParameterGroups[0].DBParameterGroupName' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_PARAM_GROUP}" != "None" && -n "${EXISTING_PARAM_GROUP}" ]]; then
    log "Parameter group already exists: ${PARAMETER_GROUP_NAME}"
else
    aws rds create-db-parameter-group \
        --db-parameter-group-name "${PARAMETER_GROUP_NAME}" \
        --db-parameter-group-family "${PARAMETER_GROUP_FAMILY}" \
        --description "Parameter group for Campfire PostgreSQL with pgvector" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"
    log "Parameter group created: ${PARAMETER_GROUP_NAME}"
fi

# Configure parameters for pgvector and performance
# Note: pgvector is installed by default in RDS PostgreSQL 15+
aws rds modify-db-parameter-group \
    --db-parameter-group-name "${PARAMETER_GROUP_NAME}" \
    --parameters \
        "ParameterName=shared_preload_libraries,ParameterValue=pg_stat_statements,ApplyMethod=pending-reboot" \
        "ParameterName=log_statement,ParameterValue=ddl,ApplyMethod=immediate" \
        "ParameterName=log_min_duration_statement,ParameterValue=1000,ApplyMethod=immediate" \
        "ParameterName=log_connections,ParameterValue=1,ApplyMethod=immediate" \
        "ParameterName=log_disconnections,ParameterValue=1,ApplyMethod=immediate" \
        "ParameterName=log_lock_waits,ParameterValue=1,ApplyMethod=immediate" \
        "ParameterName=idle_in_transaction_session_timeout,ParameterValue=300000,ApplyMethod=immediate"

log "Parameter group configured: ${PARAMETER_GROUP_NAME}"

# -----------------------------------------------------------------------------
# Create RDS Instance
# -----------------------------------------------------------------------------
log "Creating RDS PostgreSQL instance: ${RDS_INSTANCE_IDENTIFIER}"

# Check if instance already exists
EXISTING_RDS=$(aws rds describe-db-instances \
    --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" \
    --query 'DBInstances[0].DBInstanceIdentifier' \
    --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_RDS}" != "None" && -n "${EXISTING_RDS}" ]]; then
    log "RDS instance already exists: ${RDS_INSTANCE_IDENTIFIER}"
else
    aws rds create-db-instance \
        --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" \
        --db-instance-class "${RDS_INSTANCE_CLASS}" \
        --engine "${RDS_ENGINE}" \
        --engine-version "${RDS_ENGINE_VERSION}" \
        --master-username "${RDS_MASTER_USERNAME}" \
        --master-user-password "${RDS_MASTER_PASSWORD}" \
        --db-name "${RDS_DB_NAME}" \
        --allocated-storage "${RDS_ALLOCATED_STORAGE}" \
        --max-allocated-storage "${RDS_MAX_ALLOCATED_STORAGE}" \
        --storage-type gp3 \
        --storage-encrypted \
        --vpc-security-group-ids "${RDS_SG_ID}" \
        --db-subnet-group-name "${DB_SUBNET_GROUP_NAME}" \
        --db-parameter-group-name "${PARAMETER_GROUP_NAME}" \
        --backup-retention-period 7 \
        --preferred-backup-window "03:00-04:00" \
        --preferred-maintenance-window "Mon:04:00-Mon:05:00" \
        --publicly-accessible false \
        --enable-performance-insights \
        --performance-insights-retention-period 7 \
        --deletion-protection false \
        --copy-tags-to-snapshot \
        --enable-cloudwatch-logs-exports '["postgresql","upgrade"]' \
        --monitoring-interval 60 \
        --monitoring-role-arn "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/rds-monitoring-role" \
        --auto-minor-version-upgrade \
        --multi-az false \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" 2>/dev/null || \
    # Retry without enhanced monitoring if the role doesn't exist
    aws rds create-db-instance \
        --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" \
        --db-instance-class "${RDS_INSTANCE_CLASS}" \
        --engine "${RDS_ENGINE}" \
        --engine-version "${RDS_ENGINE_VERSION}" \
        --master-username "${RDS_MASTER_USERNAME}" \
        --master-user-password "${RDS_MASTER_PASSWORD}" \
        --db-name "${RDS_DB_NAME}" \
        --allocated-storage "${RDS_ALLOCATED_STORAGE}" \
        --max-allocated-storage "${RDS_MAX_ALLOCATED_STORAGE}" \
        --storage-type gp3 \
        --storage-encrypted \
        --vpc-security-group-ids "${RDS_SG_ID}" \
        --db-subnet-group-name "${DB_SUBNET_GROUP_NAME}" \
        --db-parameter-group-name "${PARAMETER_GROUP_NAME}" \
        --backup-retention-period 7 \
        --preferred-backup-window "03:00-04:00" \
        --preferred-maintenance-window "Mon:04:00-Mon:05:00" \
        --publicly-accessible false \
        --enable-performance-insights \
        --performance-insights-retention-period 7 \
        --deletion-protection false \
        --copy-tags-to-snapshot \
        --enable-cloudwatch-logs-exports '["postgresql","upgrade"]' \
        --auto-minor-version-upgrade \
        --multi-az false \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

    log "RDS instance creation initiated"
fi

# Wait for RDS instance to be available
log "Waiting for RDS instance to become available (this may take 5-10 minutes)..."
aws rds wait db-instance-available --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}"

# Get the endpoint
RDS_ENDPOINT=$(aws rds describe-db-instances \
    --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text)

RDS_PORT=$(aws rds describe-db-instances \
    --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" \
    --query 'DBInstances[0].Endpoint.Port' \
    --output text)

log "RDS instance is now available"

# -----------------------------------------------------------------------------
# Save RDS Configuration
# -----------------------------------------------------------------------------
cat >> "${SCRIPT_DIR}/vpc-outputs.env" << EOF

# RDS Resources - Generated by 04-create-rds.sh
export RDS_INSTANCE_IDENTIFIER="${RDS_INSTANCE_IDENTIFIER}"
export RDS_ENDPOINT="${RDS_ENDPOINT}"
export RDS_PORT="${RDS_PORT}"
export RDS_DB_NAME="${RDS_DB_NAME}"
export RDS_MASTER_USERNAME="${RDS_MASTER_USERNAME}"
export DB_SUBNET_GROUP_NAME="${DB_SUBNET_GROUP_NAME}"
export PARAMETER_GROUP_NAME="${PARAMETER_GROUP_NAME}"
EOF

# Create connection string file (for reference, not to be committed)
cat > "${SCRIPT_DIR}/.database-url" << EOF
DATABASE_URL=postgresql://${RDS_MASTER_USERNAME}:${RDS_MASTER_PASSWORD}@${RDS_ENDPOINT}:${RDS_PORT}/${RDS_DB_NAME}
EOF
chmod 600 "${SCRIPT_DIR}/.database-url"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "RDS PostgreSQL Instance Created Successfully"
echo "============================================================================="
echo "Instance Identifier: ${RDS_INSTANCE_IDENTIFIER}"
echo "Endpoint:            ${RDS_ENDPOINT}"
echo "Port:                ${RDS_PORT}"
echo "Database:            ${RDS_DB_NAME}"
echo "Username:            ${RDS_MASTER_USERNAME}"
echo "Engine:              PostgreSQL ${RDS_ENGINE_VERSION}"
echo "Instance Class:      ${RDS_INSTANCE_CLASS}"
echo ""
echo "Connection string saved to: ${SCRIPT_DIR}/.database-url"
echo ""
echo "IMPORTANT: After the instance is fully available, connect and enable pgvector:"
echo "  psql -h ${RDS_ENDPOINT} -U ${RDS_MASTER_USERNAME} -d ${RDS_DB_NAME}"
echo "  CREATE EXTENSION IF NOT EXISTS vector;"
echo ""
echo "Next step: ./05-create-ecs-cluster.sh"
echo "============================================================================="
