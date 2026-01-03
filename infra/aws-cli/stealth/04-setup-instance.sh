#!/bin/bash
# Setup script to run ON the EC2 instance
# Configures SSH tunnels, clones repo, prepares for deployment

set -euo pipefail

# =============================================================================
# CONFIGURATION - Update these values
# =============================================================================
HOME_SERVER_HOST="${HOME_SERVER_HOST:-your-home.duckdns.org}"
HOME_SERVER_PORT="${HOME_SERVER_PORT:-2222}"
HOME_SERVER_USER="${HOME_SERVER_USER:-jake}"
REPO_URL="${REPO_URL:-git@github.com:your-org/campfire.git}"

# =============================================================================
# Ensure running as ec2-user or with sudo
# =============================================================================
if [[ $EUID -eq 0 ]]; then
    log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
    error() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; exit 1; }
else
    log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
    error() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; exit 1; }
fi

log "Setting up Campfire stealth instance..."

# =============================================================================
# Wait for user-data script to complete
# =============================================================================
log "Waiting for initial setup to complete..."
while [[ ! -f /var/log/user-data-complete ]]; do
    echo "Waiting for user-data script..."
    sleep 5
done
log "Initial setup complete"

# =============================================================================
# Verify Docker is running
# =============================================================================
if ! docker info &>/dev/null; then
    error "Docker is not running. Check 'sudo systemctl status docker'"
fi
log "Docker is running"

# =============================================================================
# Generate SSH Key for Home Server Tunnel
# =============================================================================
SSH_KEY_FILE="$HOME/.ssh/home_tunnel"

if [[ ! -f "$SSH_KEY_FILE" ]]; then
    log "Generating SSH key for home server tunnel..."
    ssh-keygen -t ed25519 -f "$SSH_KEY_FILE" -N "" -C "campfire-stealth-tunnel"

    log ""
    log "=========================================="
    log "IMPORTANT: Add this public key to your home server"
    log "=========================================="
    log ""
    cat "${SSH_KEY_FILE}.pub"
    log ""
    log "Add it to: ${HOME_SERVER_USER}@${HOME_SERVER_HOST}:~/.ssh/authorized_keys"
    log "=========================================="
    log ""
    read -p "Press Enter after adding the key to continue..."
else
    log "SSH key already exists: ${SSH_KEY_FILE}"
fi

# =============================================================================
# Test SSH Connection
# =============================================================================
log "Testing SSH connection to home server..."
if ssh -o BatchMode=yes -o ConnectTimeout=10 -i "$SSH_KEY_FILE" -p "$HOME_SERVER_PORT" \
    "${HOME_SERVER_USER}@${HOME_SERVER_HOST}" "echo 'Connection successful'" 2>/dev/null; then
    log "SSH connection successful"
else
    log "WARNING: Could not connect to home server"
    log "Make sure:"
    log "  1. The public key is added to authorized_keys"
    log "  2. Port ${HOME_SERVER_PORT} is accessible"
    log "  3. The hostname ${HOME_SERVER_HOST} resolves correctly"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# =============================================================================
# Create Systemd Service for SSH Tunnel
# =============================================================================
log "Creating SSH tunnel systemd service..."

sudo tee /etc/systemd/system/ollama-tunnel.service > /dev/null <<EOF
[Unit]
Description=SSH Tunnel to Ollama and ComfyUI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -N \
    -L 11434:localhost:11434 \
    -L 8188:localhost:8188 \
    -p ${HOME_SERVER_PORT} \
    ${HOME_SERVER_USER}@${HOME_SERVER_HOST} \
    -i ${SSH_KEY_FILE} \
    -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -o BatchMode=yes
Restart=always
RestartSec=10
User=ec2-user

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ollama-tunnel.service
sudo systemctl start ollama-tunnel.service

log "SSH tunnel service created and started"

# Check tunnel status
sleep 3
if sudo systemctl is-active --quiet ollama-tunnel.service; then
    log "Tunnel service is running"
else
    log "WARNING: Tunnel service failed to start. Check logs with:"
    log "  sudo journalctl -u ollama-tunnel.service -f"
fi

# =============================================================================
# Clone Repository (if not exists)
# =============================================================================
APP_DIR="/opt/campfire"

if [[ ! -d "${APP_DIR}/.git" ]]; then
    log "Cloning repository..."
    if [[ -d "$APP_DIR" ]]; then
        sudo rm -rf "$APP_DIR"
    fi

    # Check if we have deploy key setup
    if [[ -f "$HOME/.ssh/deploy_key" ]]; then
        GIT_SSH_COMMAND="ssh -i $HOME/.ssh/deploy_key -o StrictHostKeyChecking=accept-new" \
            git clone "$REPO_URL" "$APP_DIR"
    else
        log "No deploy key found. You may need to set up GitHub access."
        log "Options:"
        log "  1. Generate deploy key: ssh-keygen -t ed25519 -f ~/.ssh/deploy_key"
        log "  2. Add to GitHub repo as deploy key"
        log "  3. Clone manually: git clone ${REPO_URL} ${APP_DIR}"
    fi
else
    log "Repository already cloned at ${APP_DIR}"
fi

# =============================================================================
# Create .env file template
# =============================================================================
ENV_FILE="${APP_DIR}/.env.stealth"

if [[ ! -f "$ENV_FILE" ]]; then
    log "Creating environment file template..."
    cat > "$ENV_FILE" <<'ENVEOF'
# Campfire Stealth Environment
NODE_ENV=production

# Database (containerized)
DATABASE_URL=postgresql://campfire:campfire@postgres:5432/campfire
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Redis (containerized)
REDIS_URL=redis://redis:6379

# Ollama (via SSH tunnel to home server)
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=goekdenizguelmez/JOSIEFIED-Qwen3:8b
OLLAMA_FALLBACK_MODEL=goekdenizguelmez/JOSIEFIED-Qwen3:8b

# ComfyUI (via SSH tunnel to home server)
COMFYUI_ENABLED=true
COMFYUI_BASE_URL=http://host.docker.internal:8188
COMFYUI_DEFAULT_CHECKPOINT=Juggernaut-X-RunDiffusion-NSFW.safetensors

# Disable cloud AI providers (using self-hosted)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
ELEVENLABS_API_KEY=

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_MEDIA_BUCKET=campfire-stealth-media

# URLs
GATEWAY_URL=http://gateway:4000
NEXT_PUBLIC_GATEWAY_URL=https://campfire.noice.work

# JWT (generate a new secret!)
JWT_SECRET=CHANGE_ME_TO_RANDOM_SECRET
JWT_EXPIRES_IN=7d

# Session
SESSION_SECRET=CHANGE_ME_TO_RANDOM_SECRET

# Feature Flags
FEATURE_IMAGE_GENERATION=true
FEATURE_VOICE_CONVERSATIONS=true
FEATURE_KNOWLEDGE_GRAPH=false
FEATURE_VAULT_PROJECTION=false
ENVEOF

    log "Created ${ENV_FILE}"
    log "IMPORTANT: Edit this file with your actual secrets!"
else
    log "Environment file already exists: ${ENV_FILE}"
fi

# =============================================================================
# Summary
# =============================================================================
log ""
log "=========================================="
log "Instance Setup Complete"
log "=========================================="
log ""
log "SSH Tunnel Status:"
sudo systemctl status ollama-tunnel.service --no-pager | head -5
log ""
log "Next Steps:"
log "1. Edit /opt/campfire/.env.stealth with your secrets"
log "2. Run 05-deploy.sh to build and start the application"
log ""
log "Useful Commands:"
log "  Check tunnel: sudo systemctl status ollama-tunnel.service"
log "  View tunnel logs: sudo journalctl -u ollama-tunnel.service -f"
log "  Test Ollama: curl http://localhost:11434/api/version"
log "=========================================="
