#!/bin/bash
# Create EC2 instance for stealth launch
# t4g.small with 30GB EBS, Elastic IP

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/00-config.sh"

check_aws_cli

log "Creating EC2 instance for stealth launch..."

# =============================================================================
# Get VPC Resources
# =============================================================================
SUBNET_ID=$(get_resource_id subnet "$SUBNET_NAME")
SG_ID=$(get_resource_id sg "$SG_NAME")

if [[ "$SUBNET_ID" == "None" || "$SG_ID" == "None" ]]; then
    error "VPC resources not found. Run 01-create-vpc.sh first."
fi

# =============================================================================
# Get Latest Amazon Linux 2023 ARM64 AMI
# =============================================================================
log "Finding latest Amazon Linux 2023 ARM64 AMI..."
AMI_ID=$(aws ec2 describe-images \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023*-arm64" \
              "Name=state,Values=available" \
              "Name=architecture,Values=arm64" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text)

if [[ -z "$AMI_ID" || "$AMI_ID" == "None" ]]; then
    error "Could not find Amazon Linux 2023 ARM64 AMI"
fi
log "Using AMI: ${AMI_ID}"

# =============================================================================
# Create or Use Existing Key Pair
# =============================================================================
KEY_FILE="${SCRIPT_DIR}/${KEY_NAME}.pem"

if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" &>/dev/null; then
    log "Creating key pair: ${KEY_NAME}"
    aws ec2 create-key-pair \
        --key-name "$KEY_NAME" \
        --query 'KeyMaterial' \
        --output text > "$KEY_FILE"
    chmod 400 "$KEY_FILE"
    log "Key pair saved to: ${KEY_FILE}"
else
    log "Key pair already exists: ${KEY_NAME}"
    if [[ ! -f "$KEY_FILE" ]]; then
        log "WARNING: Key file not found locally at ${KEY_FILE}"
        log "You may need to use an existing key or recreate the key pair"
    fi
fi

# =============================================================================
# User Data Script (runs on first boot)
# =============================================================================
USER_DATA=$(cat <<'EOF'
#!/bin/bash
set -e

# Update system
dnf update -y

# Install Docker
dnf install -y docker git

# Start Docker
systemctl enable docker
systemctl start docker

# Add ec2-user to docker group
usermod -aG docker ec2-user

# Install Docker Compose plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Create app directory
mkdir -p /opt/campfire
chown ec2-user:ec2-user /opt/campfire

# Signal completion
echo "User data script completed" > /var/log/user-data-complete
EOF
)

# =============================================================================
# Launch Instance
# =============================================================================
INSTANCE_ID=$(get_resource_id instance "$INSTANCE_NAME")

if [[ "$INSTANCE_ID" == "None" ]]; then
    log "Launching EC2 instance: ${INSTANCE_NAME}"
    INSTANCE_ID=$(aws ec2 run-instances \
        --image-id "$AMI_ID" \
        --instance-type "$INSTANCE_TYPE" \
        --key-name "$KEY_NAME" \
        --security-group-ids "$SG_ID" \
        --subnet-id "$SUBNET_ID" \
        --block-device-mappings "[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":${EBS_VOLUME_SIZE},\"VolumeType\":\"${EBS_VOLUME_TYPE}\",\"DeleteOnTermination\":true}}]" \
        --user-data "$USER_DATA" \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}},${TAGS}]" \
        --query 'Instances[0].InstanceId' \
        --output text)

    log "Instance launched: ${INSTANCE_ID}"
    wait_for_instance "$INSTANCE_ID"
else
    log "Instance already exists: ${INSTANCE_ID}"
fi

# =============================================================================
# Allocate and Associate Elastic IP
# =============================================================================
EIP_ALLOC_ID=$(get_resource_id eip "$EIP_NAME")

if [[ "$EIP_ALLOC_ID" == "None" ]]; then
    log "Allocating Elastic IP: ${EIP_NAME}"
    EIP_ALLOC_ID=$(aws ec2 allocate-address \
        --domain vpc \
        --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${EIP_NAME}},${TAGS}]" \
        --query 'AllocationId' \
        --output text)
    log "Allocated Elastic IP: ${EIP_ALLOC_ID}"
fi

# Get the public IP
PUBLIC_IP=$(aws ec2 describe-addresses \
    --allocation-ids "$EIP_ALLOC_ID" \
    --query 'Addresses[0].PublicIp' \
    --output text)

# Check if already associated
ASSOC_ID=$(aws ec2 describe-addresses \
    --allocation-ids "$EIP_ALLOC_ID" \
    --query 'Addresses[0].AssociationId' \
    --output text)

if [[ "$ASSOC_ID" == "None" || -z "$ASSOC_ID" ]]; then
    log "Associating Elastic IP with instance..."
    aws ec2 associate-address \
        --instance-id "$INSTANCE_ID" \
        --allocation-id "$EIP_ALLOC_ID"
    log "Associated Elastic IP: ${PUBLIC_IP}"
else
    log "Elastic IP already associated: ${PUBLIC_IP}"
fi

# =============================================================================
# Summary
# =============================================================================
log ""
log "=========================================="
log "EC2 Instance Summary"
log "=========================================="
log "Instance ID:     ${INSTANCE_ID}"
log "Instance Type:   ${INSTANCE_TYPE}"
log "AMI ID:          ${AMI_ID}"
log "Public IP:       ${PUBLIC_IP}"
log "Key File:        ${KEY_FILE}"
log "=========================================="
log ""
log "SSH Command:"
log "  ssh -i ${KEY_FILE} ec2-user@${PUBLIC_IP}"
log ""
log "Next steps:"
log "1. Wait 2-3 minutes for user-data script to complete"
log "2. Run 03-create-s3.sh to create media bucket"
log "3. SSH in and run 04-setup-instance.sh"
log ""
log "Point your DNS:"
log "  Cloudflare: ${DOMAIN} -> ${PUBLIC_IP} (Proxied)"
