#!/bin/bash
# Deploy application to EC2 instance
# Can be run locally (SSHs into instance) or on the instance itself

set -euo pipefail

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; exit 1; }

APP_DIR="/opt/campfire"
COMPOSE_FILE="infra/docker/docker-compose.stealth.yml"
ENV_FILE=".env.stealth"

# =============================================================================
# Check if running on EC2 or locally
# =============================================================================
if [[ -d "$APP_DIR" ]]; then
    log "Running on EC2 instance..."
    cd "$APP_DIR"
else
    error "App directory not found. Are you running this on the EC2 instance?"
fi

# =============================================================================
# Check environment file
# =============================================================================
if [[ ! -f "$ENV_FILE" ]]; then
    error "Environment file not found: ${ENV_FILE}"
    error "Run 04-setup-instance.sh first and configure the environment"
fi

# Check for placeholder values
if grep -q "CHANGE_ME" "$ENV_FILE"; then
    error "Environment file contains placeholder values. Edit ${ENV_FILE} first."
fi

# =============================================================================
# Pull latest code
# =============================================================================
log "Pulling latest code..."
if git pull 2>/dev/null; then
    log "Code updated"
else
    log "Could not pull (maybe not a git repo or no upstream)"
fi

# =============================================================================
# Check SSH tunnel
# =============================================================================
log "Checking SSH tunnel to home server..."
if curl -s --max-time 5 http://localhost:11434/api/version &>/dev/null; then
    log "Ollama tunnel is working"
else
    log "WARNING: Cannot reach Ollama. Check tunnel with:"
    log "  sudo systemctl status ollama-tunnel.service"
fi

# =============================================================================
# Build and deploy
# =============================================================================
log "Building containers (this may take a few minutes on first run)..."

# Export environment variables
set -a
source "$ENV_FILE"
set +a

# Pull base images
docker compose -f "$COMPOSE_FILE" pull postgres redis nginx 2>/dev/null || true

# Build application images
docker compose -f "$COMPOSE_FILE" build

# Stop existing containers
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

# Start containers
log "Starting containers..."
docker compose -f "$COMPOSE_FILE" up -d

# =============================================================================
# Wait for services to be healthy
# =============================================================================
log "Waiting for services to become healthy..."

# Wait for postgres
log "Waiting for PostgreSQL..."
until docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U campfire &>/dev/null; do
    sleep 2
done
log "PostgreSQL is ready"

# Wait for Redis
log "Waiting for Redis..."
until docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping &>/dev/null; do
    sleep 2
done
log "Redis is ready"

# Wait for Gateway
log "Waiting for Gateway..."
for i in {1..30}; do
    if curl -s http://localhost:4000/health &>/dev/null; then
        log "Gateway is healthy"
        break
    fi
    sleep 2
done

# Wait for Web
log "Waiting for Web app..."
for i in {1..30}; do
    if curl -s http://localhost:3000/api/health &>/dev/null; then
        log "Web app is healthy"
        break
    fi
    sleep 2
done

# =============================================================================
# Run database migrations
# =============================================================================
log "Running database migrations..."
docker compose -f "$COMPOSE_FILE" exec -T gateway npm run db:migrate || log "Migrations may have already run"

# =============================================================================
# Summary
# =============================================================================
log ""
log "=========================================="
log "Deployment Complete!"
log "=========================================="
log ""
log "Services Status:"
docker compose -f "$COMPOSE_FILE" ps
log ""
log "Access your application:"
log "  Local:  http://localhost:3000"
log "  Domain: https://campfire.noice.work (after DNS setup)"
log ""
log "Useful Commands:"
log "  View logs:     docker compose -f ${COMPOSE_FILE} logs -f"
log "  View service:  docker compose -f ${COMPOSE_FILE} logs -f gateway"
log "  Restart:       docker compose -f ${COMPOSE_FILE} restart"
log "  Stop:          docker compose -f ${COMPOSE_FILE} down"
log "  Shell:         docker compose -f ${COMPOSE_FILE} exec gateway sh"
log "=========================================="
