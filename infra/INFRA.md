# Campfire Stealth Infrastructure

## Overview

Campfire runs on a single AWS EC2 instance with Docker Compose, fronted by Cloudflare for SSL termination and DDoS protection.

**Live URL:** https://ignite.cam

## AWS Resources

| Resource | ID/Name | Details |
|----------|---------|---------|
| VPC | vpc-00db3e9e80bc4007c | 10.0.0.0/16 |
| EC2 Instance | i-06018e1001a843b55 | t4g.medium (ARM64, 2 vCPU, 4GB RAM) |
| Elastic IP | 44.206.75.97 | Static public IP |
| S3 Bucket | campfire-stealth-media | Media storage |
| Region | us-east-1 | N. Virginia |

**Estimated Cost:** ~$30/month

## SSH Access

```bash
# SSH to EC2 instance
ssh -i /Users/jake/Projects/campfire/infra/aws-cli/stealth/campfire-stealth-key.pem ec2-user@44.206.75.97

# Quick alias (add to ~/.zshrc or ~/.bashrc)
alias campfire-ssh='ssh -i ~/Projects/campfire/infra/aws-cli/stealth/campfire-stealth-key.pem ec2-user@44.206.75.97'
```

**SSH Key Location:** `/Users/jake/Projects/campfire/infra/aws-cli/stealth/campfire-stealth-key.pem`

## Directory Structure on EC2

```
/opt/campfire/
├── .env.stealth              # Environment variables
├── infra/
│   └── docker/
│       ├── docker-compose.stealth.yml
│       └── nginx/
│           ├── nginx.stealth.conf
│           └── ssl/
│               ├── nginx.crt    # Self-signed cert
│               └── nginx.key    # Private key
└── packages/
    ├── gateway/
    ├── orchestrator/
    ├── web/
    ├── workers/
    └── shared/
```

## Docker Services

| Service | Container Name | Internal Port | External Port | Health |
|---------|---------------|---------------|---------------|--------|
| Nginx | campfire-nginx | 80, 443 | 80, 443 | `/nginx-health` |
| Gateway API | campfire-gateway | 4000, 4001 (WS) | - | `/health` |
| Web (Next.js) | campfire-web | 3000 | - | `/api/health` |
| Orchestrator | campfire-orchestrator | 5000 | - | `/health` |
| Workers | campfire-workers | 8080 | - | `/health` |
| PostgreSQL | campfire-postgres | 5432 | - | `pg_isready` |
| Redis | campfire-redis | 6379 | - | `redis-cli ping` |

## Common Commands

### Check Service Status
```bash
# On EC2 instance
cd /opt/campfire/infra/docker
docker compose -f docker-compose.stealth.yml ps

# View logs
docker logs campfire-gateway -f --tail 100
docker logs campfire-orchestrator -f --tail 100
docker logs campfire-web -f --tail 100
docker logs campfire-workers -f --tail 100
```

### Restart Services
```bash
cd /opt/campfire/infra/docker

# Restart all
docker compose -f docker-compose.stealth.yml --env-file /opt/campfire/.env.stealth restart

# Restart specific service
docker compose -f docker-compose.stealth.yml --env-file /opt/campfire/.env.stealth restart gateway
```

### Rebuild and Deploy
```bash
cd /opt/campfire/infra/docker

# Rebuild specific service
docker compose -f docker-compose.stealth.yml --env-file /opt/campfire/.env.stealth build gateway
docker compose -f docker-compose.stealth.yml --env-file /opt/campfire/.env.stealth up -d gateway

# Rebuild all
docker compose -f docker-compose.stealth.yml --env-file /opt/campfire/.env.stealth build
docker compose -f docker-compose.stealth.yml --env-file /opt/campfire/.env.stealth up -d
```

### Database Access
```bash
# Connect to PostgreSQL
docker exec -it campfire-postgres psql -U campfire -d campfire

# Run migrations (from gateway container)
docker exec -it campfire-gateway node dist/db/migrate.js
```

### Sync Files from Local
```bash
# Sync a single file
rsync -avz -e "ssh -i /Users/jake/Projects/campfire/infra/aws-cli/stealth/campfire-stealth-key.pem" \
  /Users/jake/Projects/campfire/path/to/file \
  ec2-user@44.206.75.97:/opt/campfire/path/to/file

# Sync docker-compose
rsync -avz -e "ssh -i /Users/jake/Projects/campfire/infra/aws-cli/stealth/campfire-stealth-key.pem" \
  /Users/jake/Projects/campfire/infra/docker/docker-compose.stealth.yml \
  ec2-user@44.206.75.97:/opt/campfire/infra/docker/
```

## Environment Variables

Environment file: `/opt/campfire/.env.stealth`

Key variables:
- `POSTGRES_PASSWORD` - Database password
- `JWT_SECRET` - JWT signing secret
- `SESSION_SECRET` - Session encryption secret
- `INTERNAL_SERVICE_KEY` - Inter-service auth key
- `PROVIDER_KEY_ENCRYPTION_SECRET` - API key encryption
- `DOMAIN` - campfire.noice.work
- `S3_MEDIA_BUCKET` - campfire-stealth-media
- `OLLAMA_ENABLED` - Enable Ollama integration
- `COMFYUI_ENABLED` - Enable ComfyUI integration

## Network Architecture

```
Internet
    │
    ▼
Cloudflare (SSL, DDoS protection)
    │
    ▼ HTTPS (port 443)
┌─────────────────────────────────────────────┐
│  EC2 Instance (44.206.75.97)                │
│  ┌─────────────────────────────────────┐    │
│  │  Nginx (ports 80, 443)              │    │
│  │    ├─ /api/* → gateway:4000         │    │
│  │    ├─ /ws    → gateway:4001         │    │
│  │    └─ /*     → web:3000             │    │
│  └─────────────────────────────────────┘    │
│           │              │                   │
│           ▼              ▼                   │
│  ┌─────────────┐  ┌─────────────┐           │
│  │   Gateway   │  │     Web     │           │
│  │  (Fastify)  │  │  (Next.js)  │           │
│  └─────────────┘  └─────────────┘           │
│           │                                  │
│           ▼                                  │
│  ┌─────────────┐  ┌─────────────┐           │
│  │ Orchestrator│  │   Workers   │           │
│  │  (FastAPI)  │  │  (BullMQ)   │           │
│  └─────────────┘  └─────────────┘           │
│           │              │                   │
│           ▼              ▼                   │
│  ┌─────────────┐  ┌─────────────┐           │
│  │  PostgreSQL │  │    Redis    │           │
│  │  (pgvector) │  │             │           │
│  └─────────────┘  └─────────────┘           │
└─────────────────────────────────────────────┘
           │
           ▼ SSH Tunnel (pending)
┌─────────────────────────────────────────────┐
│  Home Server (home.noice.work:2222)         │
│  ├─ Ollama (localhost:11434)                │
│  └─ ComfyUI (localhost:8188)                │
└─────────────────────────────────────────────┘
```

## SSH Tunnel to Home Server (Pending Setup)

The EC2 instance can tunnel to a home server for free LLM inference via Ollama and image generation via ComfyUI.

### Setup Steps

1. **Add EC2 public key to home server:**
   ```bash
   # On home server (home.noice.work:2222)
   echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDo0LMZTi/mHMArT6gtmDDhb2WSz2FZbbvYRMe9cS5T2 campfire-ec2-tunnel' >> ~/.ssh/authorized_keys
   ```

2. **Enable tunnel service on EC2:**
   ```bash
   sudo systemctl enable --now ollama-tunnel
   ```

3. **Verify tunnel:**
   ```bash
   curl http://localhost:11434/api/tags  # Ollama
   curl http://localhost:8188/system_stats  # ComfyUI
   ```

### Tunnel Service

Service file: `/etc/systemd/system/ollama-tunnel.service`

```ini
[Unit]
Description=SSH Tunnel to Ollama and ComfyUI on home server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -N -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 11434:localhost:11434 -L 8188:localhost:8188 -p 2222 jake@home.noice.work -i /home/ec2-user/.ssh/home_tunnel
Restart=always
RestartSec=10
User=ec2-user

[Install]
WantedBy=multi-user.target
```

## Troubleshooting

### Service won't start
```bash
# Check logs
docker logs campfire-<service> --tail 100

# Check if port is in use
docker ps -a

# Force recreate
docker compose -f docker-compose.stealth.yml --env-file /opt/campfire/.env.stealth up -d --force-recreate <service>
```

### Database connection issues
```bash
# Check postgres is healthy
docker exec campfire-postgres pg_isready -U campfire

# Check connection from gateway
docker exec campfire-gateway wget -qO- http://localhost:4000/health
```

### Out of memory
```bash
# Check memory usage
docker stats --no-stream

# Free up space
docker system prune -af
```

### SSL/HTTPS issues
```bash
# Test direct HTTP (should redirect)
curl -I http://44.206.75.97

# Test HTTPS locally
curl -k https://44.206.75.97

# Check nginx config
docker exec campfire-nginx nginx -t
```

## Deployment Scripts

Located in `/Users/jake/Projects/campfire/infra/aws-cli/stealth/`:

| Script | Purpose |
|--------|---------|
| `00-config.sh` | Configuration variables |
| `01-create-vpc.sh` | Create VPC, subnets, security groups |
| `02-create-ec2.sh` | Launch EC2 instance |
| `03-create-s3.sh` | Create S3 bucket |
| `04-setup-instance.sh` | Install Docker, clone repo |
| `05-deploy.sh` | Build and start containers |
| `99-teardown.sh` | Destroy all resources |

## Security Notes

- SSH key is required for EC2 access (no password auth)
- All services run in Docker with non-root users
- Nginx handles SSL termination with self-signed cert (Cloudflare provides public SSL)
- Database is not exposed externally
- Redis runs with `allkeys-lru` eviction (warning in logs is expected)
- Inter-service communication uses `INTERNAL_SERVICE_KEY`
