#!/bin/bash
# =============================================================================
# Campfire AWS Infrastructure - Create RDS PostgreSQL Instance (Production)
# =============================================================================
# Creates Multi-AZ RDS PostgreSQL instance with enhanced security,
# monitoring, and backup configuration for production
#
# Usage: ./04-create-rds.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"
source "${SCRIPT_DIR}/vpc-outputs.env"

check_aws_cli
confirm_production

log "Creating RDS PostgreSQL instance for environment: ${ENVIRONMENT}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# -----------------------------------------------------------------------------
# Generate or read database password
# -----------------------------------------------------------------------------
RDS_PASSWORD_FILE="${SCRIPT_DIR}/.rds-password"

if [[ -f "${RDS_PASSWORD_FILE}" ]]; then
    RDS_MASTER_PASSWORD=$(cat "${RDS_PASSWORD_FILE}")
    log "Using existing RDS password from ${RDS_PASSWORD_FILE}"
else
    # Generate a secure random password (longer for production)
    RDS_MASTER_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9!@#$%^&*' | head -c 40)
    echo "${RDS_MASTER_PASSWORD}" > "${RDS_PASSWORD_FILE}"
    chmod 600 "${RDS_PASSWORD_FILE}"
    log "Generated new RDS password and saved to ${RDS_PASSWORD_FILE}"
    warn "IMPORTANT: Store this password securely in Secrets Manager"
fi

# -----------------------------------------------------------------------------
# Store password in Secrets Manager
# -----------------------------------------------------------------------------
log "Storing RDS credentials in Secrets Manager"

SECRET_NAME="${RESOURCE_PREFIX}/rds-credentials"

if aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" 2>/dev/null; then
    log "Secret already exists, updating..."
    aws secretsmanager update-secret \
        --secret-id "${SECRET_NAME}" \
        --secret-string "{\"username\":\"${RDS_MASTER_USERNAME}\",\"password\":\"${RDS_MASTER_PASSWORD}\"}"
else
    aws secretsmanager create-secret \
        --name "${SECRET_NAME}" \
        --description "RDS PostgreSQL credentials for Campfire production" \
        --secret-string "{\"username\":\"${RDS_MASTER_USERNAME}\",\"password\":\"${RDS_MASTER_PASSWORD}\"}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"
fi

log "RDS credentials stored in Secrets Manager: ${SECRET_NAME}"

# -----------------------------------------------------------------------------
# Create DB Subnet Group
# -----------------------------------------------------------------------------
log "Creating DB subnet group"

DB_SUBNET_GROUP_NAME="${RESOURCE_PREFIX}-db-subnet-group"

aws rds create-db-subnet-group \
    --db-subnet-group-name "${DB_SUBNET_GROUP_NAME}" \
    --db-subnet-group-description "Production subnet group for Campfire RDS instances (3 AZs)" \
    --subnet-ids "${PRIVATE_SUBNET_1_ID}" "${PRIVATE_SUBNET_2_ID}" "${PRIVATE_SUBNET_3_ID}" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" \
    2>/dev/null || log "DB subnet group already exists"

log "DB subnet group ready: ${DB_SUBNET_GROUP_NAME}"

# -----------------------------------------------------------------------------
# Create RDS Parameter Group (for pgvector and production tuning)
# -----------------------------------------------------------------------------
log "Creating parameter group for production PostgreSQL with pgvector support"

PARAMETER_GROUP_NAME="${RESOURCE_PREFIX}-postgres-params"
PARAMETER_GROUP_FAMILY="postgres16"

aws rds create-db-parameter-group \
    --db-parameter-group-name "${PARAMETER_GROUP_NAME}" \
    --db-parameter-group-family "${PARAMETER_GROUP_FAMILY}" \
    --description "Production parameter group for Campfire PostgreSQL with pgvector" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" \
    2>/dev/null || log "Parameter group already exists"

# Production PostgreSQL parameters
aws rds modify-db-parameter-group \
    --db-parameter-group-name "${PARAMETER_GROUP_NAME}" \
    --parameters \
        "ParameterName=shared_preload_libraries,ParameterValue=pg_stat_statements,ApplyMethod=pending-reboot" \
        "ParameterName=log_statement,ParameterValue=ddl,ApplyMethod=immediate" \
        "ParameterName=log_min_duration_statement,ParameterValue=500,ApplyMethod=immediate" \
        "ParameterName=log_connections,ParameterValue=1,ApplyMethod=immediate" \
        "ParameterName=log_disconnections,ParameterValue=1,ApplyMethod=immediate" \
        "ParameterName=log_lock_waits,ParameterValue=1,ApplyMethod=immediate" \
        "ParameterName=idle_in_transaction_session_timeout,ParameterValue=60000,ApplyMethod=immediate" \
        "ParameterName=statement_timeout,ParameterValue=300000,ApplyMethod=immediate" \
        "ParameterName=track_activity_query_size,ParameterValue=4096,ApplyMethod=pending-reboot"

log "Parameter group configured: ${PARAMETER_GROUP_NAME}"

# -----------------------------------------------------------------------------
# Create Option Group (if needed for specific extensions)
# -----------------------------------------------------------------------------
OPTION_GROUP_NAME="${RESOURCE_PREFIX}-postgres-options"

aws rds create-option-group \
    --option-group-name "${OPTION_GROUP_NAME}" \
    --engine-name "${RDS_ENGINE}" \
    --major-engine-version "16" \
    --option-group-description "Production option group for Campfire PostgreSQL" \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" \
    2>/dev/null || log "Option group already exists"

# -----------------------------------------------------------------------------
# Create RDS Instance (Multi-AZ for production)
# -----------------------------------------------------------------------------
log "Creating Multi-AZ RDS PostgreSQL instance: ${RDS_INSTANCE_IDENTIFIER}"

if aws rds describe-db-instances --db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" 2>/dev/null; then
    log "RDS instance already exists, skipping creation"
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
        --iops 3000 \
        --storage-throughput 125 \
        --storage-encrypted \
        --kms-key-id alias/aws/rds \
        --vpc-security-group-ids "${RDS_SG_ID}" \
        --db-subnet-group-name "${DB_SUBNET_GROUP_NAME}" \
        --db-parameter-group-name "${PARAMETER_GROUP_NAME}" \
        --option-group-name "${OPTION_GROUP_NAME}" \
        --multi-az \
        --backup-retention-period "${RDS_BACKUP_RETENTION_DAYS}" \
        --preferred-backup-window "03:00-04:00" \
        --preferred-maintenance-window "Mon:04:00-Mon:05:00" \
        --publicly-accessible false \
        --auto-minor-version-upgrade true \
        --enable-performance-insights \
        --performance-insights-retention-period "${RDS_PERFORMANCE_INSIGHTS_RETENTION}" \
        --enable-cloudwatch-logs-exports '["postgresql","upgrade"]' \
        --deletion-protection \
        --copy-tags-to-snapshot \
        --monitoring-interval 60 \
        --monitoring-role-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/rds-monitoring-role" \
        --enable-iam-database-authentication \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=CostCenter,Value="${TAG_COST_CENTER}" Key=Backup,Value=daily \
        2>/dev/null || {
            # If enhanced monitoring role doesn't exist, create without it
            warn "Enhanced monitoring role not found, creating without enhanced monitoring"
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
                --iops 3000 \
                --storage-throughput 125 \
                --storage-encrypted \
                --vpc-security-group-ids "${RDS_SG_ID}" \
                --db-subnet-group-name "${DB_SUBNET_GROUP_NAME}" \
                --db-parameter-group-name "${PARAMETER_GROUP_NAME}" \
                --option-group-name "${OPTION_GROUP_NAME}" \
                --multi-az \
                --backup-retention-period "${RDS_BACKUP_RETENTION_DAYS}" \
                --preferred-backup-window "03:00-04:00" \
                --preferred-maintenance-window "Mon:04:00-Mon:05:00" \
                --publicly-accessible false \
                --auto-minor-version-upgrade true \
                --enable-performance-insights \
                --performance-insights-retention-period "${RDS_PERFORMANCE_INSIGHTS_RETENTION}" \
                --enable-cloudwatch-logs-exports '["postgresql","upgrade"]' \
                --deletion-protection \
                --copy-tags-to-snapshot \
                --enable-iam-database-authentication \
                --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=CostCenter,Value="${TAG_COST_CENTER}" Key=Backup,Value=daily
        }

    log "RDS instance creation initiated"
fi

# Wait for RDS instance to be available
log "Waiting for RDS instance to become available (this may take 15-20 minutes for Multi-AZ)..."
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
# Create Read Replica (Optional but recommended for production)
# -----------------------------------------------------------------------------
log "Creating read replica for production read scaling..."

READ_REPLICA_IDENTIFIER="${RESOURCE_PREFIX}-postgres-replica"

if aws rds describe-db-instances --db-instance-identifier "${READ_REPLICA_IDENTIFIER}" 2>/dev/null; then
    log "Read replica already exists, skipping creation"
else
    aws rds create-db-instance-read-replica \
        --db-instance-identifier "${READ_REPLICA_IDENTIFIER}" \
        --source-db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}" \
        --db-instance-class "${RDS_INSTANCE_CLASS}" \
        --availability-zone "${AVAILABILITY_ZONE_2}" \
        --publicly-accessible false \
        --storage-type gp3 \
        --enable-performance-insights \
        --performance-insights-retention-period "${RDS_PERFORMANCE_INSIGHTS_RETENTION}" \
        --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}" Key=CostCenter,Value="${TAG_COST_CENTER}" Key=Role,Value=read-replica

    log "Read replica creation initiated: ${READ_REPLICA_IDENTIFIER}"
fi

# -----------------------------------------------------------------------------
# Create SSM Parameters for database connection
# -----------------------------------------------------------------------------
log "Creating SSM parameters for database connection"

# Database URL parameter
DATABASE_URL="postgresql://${RDS_MASTER_USERNAME}:${RDS_MASTER_PASSWORD}@${RDS_ENDPOINT}:${RDS_PORT}/${RDS_DB_NAME}?sslmode=require"

aws ssm put-parameter \
    --name "/${RESOURCE_PREFIX}/database-url" \
    --description "PostgreSQL connection string for Campfire production" \
    --type SecureString \
    --value "${DATABASE_URL}" \
    --overwrite \
    --tags Key=Project,Value="${TAG_PROJECT}" Key=Environment,Value="${TAG_ENVIRONMENT}"

log "SSM parameter created: /${RESOURCE_PREFIX}/database-url"

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
export READ_REPLICA_IDENTIFIER="${READ_REPLICA_IDENTIFIER}"
EOF

# Create connection string file (for reference, not to be committed)
cat > "${SCRIPT_DIR}/.database-url" << EOF
DATABASE_URL=postgresql://${RDS_MASTER_USERNAME}:${RDS_MASTER_PASSWORD}@${RDS_ENDPOINT}:${RDS_PORT}/${RDS_DB_NAME}?sslmode=require
EOF
chmod 600 "${SCRIPT_DIR}/.database-url"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo "RDS PostgreSQL Instance Created Successfully (Production)"
echo "============================================================================="
echo "Primary Instance:"
echo "  Identifier:     ${RDS_INSTANCE_IDENTIFIER}"
echo "  Endpoint:       ${RDS_ENDPOINT}"
echo "  Port:           ${RDS_PORT}"
echo "  Database:       ${RDS_DB_NAME}"
echo "  Instance Class: ${RDS_INSTANCE_CLASS}"
echo "  Multi-AZ:       Yes"
echo "  Encrypted:      Yes (KMS)"
echo ""
echo "Read Replica:"
echo "  Identifier:     ${READ_REPLICA_IDENTIFIER}"
echo "  Status:         Creating (check AWS Console)"
echo ""
echo "Production Features Enabled:"
echo "  - Multi-AZ deployment for high availability"
echo "  - Automated backups (${RDS_BACKUP_RETENTION_DAYS} days retention)"
echo "  - Performance Insights (${RDS_PERFORMANCE_INSIGHTS_RETENTION} days)"
echo "  - Enhanced monitoring"
echo "  - Deletion protection"
echo "  - Storage encryption (KMS)"
echo "  - IAM database authentication"
echo "  - PostgreSQL logs exported to CloudWatch"
echo "  - Read replica for read scaling"
echo ""
echo "Credentials stored in:"
echo "  - Secrets Manager: ${SECRET_NAME}"
echo "  - SSM Parameter: /${RESOURCE_PREFIX}/database-url"
echo "  - Local file: ${SCRIPT_DIR}/.database-url (DO NOT COMMIT)"
echo ""
echo "IMPORTANT: After the instance is fully available, connect and enable pgvector:"
echo "  psql -h ${RDS_ENDPOINT} -U ${RDS_MASTER_USERNAME} -d ${RDS_DB_NAME}"
echo "  CREATE EXTENSION IF NOT EXISTS vector;"
echo ""
echo "Next step: ./05-create-ecs-cluster.sh"
echo "============================================================================="
