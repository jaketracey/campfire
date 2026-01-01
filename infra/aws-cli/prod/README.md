# Campfire AWS Infrastructure - Production Environment

This directory contains AWS CLI scripts to provision and manage the Campfire infrastructure in the **production environment**.

## Important Security Notice

These scripts deploy to a **PRODUCTION** environment. All scripts require confirmation before making changes. Review all changes carefully before deploying.

## Prerequisites

1. **AWS CLI v2** installed and configured
2. **AWS credentials** with appropriate permissions (admin or equivalent for initial setup)
3. **ACM SSL Certificate** for HTTPS (required for production)
4. **Domain name** configured in Route 53 (recommended)

```bash
# Install AWS CLI (macOS)
brew install awscli

# Configure AWS credentials for production
aws configure --profile campfire-prod

# Verify access
aws sts get-caller-identity --profile campfire-prod
```

## Architecture Overview

```
                                   +------------------+
                                   |   CloudFront     |
                                   |   (Optional)     |
                                   +--------+---------+
                                            |
                                   +--------v---------+
                              +--->|   WAF Web ACL    |
                              |    +--------+---------+
                              |             |
                    Internet  |    +--------v---------+
                              +--->| Application LB   |
                                   | (3 AZs, HTTPS)   |
                                   +--------+---------+
                                            |
                +---------------------------+---------------------------+
                |                           |                           |
       +--------v--------+         +--------v--------+         +--------v--------+
       |  ECS Fargate    |         |  ECS Fargate    |         |  ECS Fargate    |
       |  (Gateway)      |         |  (Web)          |         |  (Orchestrator) |
       |  Min: 2, Max: 10|         |  Min: 2, Max: 10|         |  Min: 2, Max: 10|
       +-----------------+         +-----------------+         +-----------------+
                |                           |                           |
                +---------------------------+---------------------------+
                                            |
                              +-------------+-------------+
                              |                           |
                     +--------v--------+         +--------v--------+
                     |  RDS PostgreSQL |         |  ElastiCache    |
                     |  (Multi-AZ)     |         |  Redis Cluster  |
                     +-----------------+         +-----------------+
```

## Quick Start

Run scripts in order to set up the complete infrastructure:

```bash
cd infra/aws-cli/prod

# Make scripts executable
chmod +x *.sh

# Set required environment variables
export AWS_PROFILE=campfire-prod
export AWS_REGION=us-east-1
export ACM_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789:certificate/xxx

# 1. Create S3 buckets
./01-create-s3-buckets.sh

# 2. Create ECR repositories (shared with dev)
./02-create-ecr-repos.sh

# 3. Create VPC with 3-AZ deployment
./03-create-vpc.sh

# 4. Create Multi-AZ RDS PostgreSQL
./04-create-rds.sh

# 5. Create ECS cluster
./05-create-ecs-cluster.sh

# 6. Create ECS task definitions
./06-create-task-definitions.sh

# 7. Create ALB with HTTPS and WAF
./07-create-alb.sh

# 8. Create IAM roles with least-privilege
./08-create-iam-roles.sh

# 9. Create CloudWatch monitoring and alerts
./09-create-cloudwatch.sh

# 10. Deploy services with auto-scaling
./10-deploy-services.sh
```

## Script Reference

| Script | Description | Duration |
|--------|-------------|----------|
| `00-config.sh` | Production configuration variables | - |
| `01-create-s3-buckets.sh` | S3 buckets with encryption and lifecycle | ~2 min |
| `02-create-ecr-repos.sh` | ECR with immutable tags and scanning | ~2 min |
| `03-create-vpc.sh` | 3-AZ VPC with NAT per AZ, VPC endpoints | ~10 min |
| `04-create-rds.sh` | Multi-AZ RDS with read replica | ~25-30 min |
| `05-create-ecs-cluster.sh` | ECS Fargate cluster with service discovery | ~3 min |
| `06-create-task-definitions.sh` | Task definitions (ARM64 Graviton) | ~2 min |
| `07-create-alb.sh` | ALB with HTTPS, WAF, access logs | ~5 min |
| `08-create-iam-roles.sh` | IAM roles with least-privilege policies | ~2 min |
| `09-create-cloudwatch.sh` | Dashboards, alarms, SNS topics | ~3 min |
| `10-deploy-services.sh` | Deploy services with auto-scaling | ~10-15 min |

**Total estimated time:** 60-75 minutes

## Production Configuration

Key production settings in `00-config.sh`:

```bash
# VPC - Different CIDR from dev
VPC_CIDR=10.1.0.0/16

# RDS - Multi-AZ with larger instance
RDS_INSTANCE_CLASS=db.r6g.large
RDS_MULTI_AZ=true
RDS_BACKUP_RETENTION_DAYS=30

# ECS - Higher resource allocations
GATEWAY_CPU=512
GATEWAY_MEMORY=1024
GATEWAY_MIN_COUNT=2
GATEWAY_MAX_COUNT=10

# CloudWatch - Longer retention
LOG_RETENTION_DAYS=90

# Auto-scaling
AUTOSCALING_TARGET_CPU=70
AUTOSCALING_TARGET_MEMORY=80
```

## Key Differences from Development

| Feature | Development | Production |
|---------|-------------|------------|
| VPC CIDR | 10.0.0.0/16 | 10.1.0.0/16 |
| Availability Zones | 2 | 3 |
| NAT Gateways | 1 (shared) | 3 (per-AZ HA) |
| RDS Instance | db.t3.medium | db.r6g.large |
| RDS Multi-AZ | No | Yes |
| RDS Backup Retention | 7 days | 30 days |
| Read Replica | No | Yes |
| ECS CPU/Memory | Lower | 2-4x higher |
| Auto-scaling | No | Yes (CPU/Memory) |
| Min Task Count | 1-2 | 2-3 |
| SSL/TLS | Optional | Required |
| WAF | No | Yes |
| Access Logs | No | Yes (S3) |
| VPC Endpoints | No | Yes (cost savings) |
| VPC Flow Logs | No | Yes |
| Log Retention | 14 days | 90 days |
| ECR Tag Immutability | Mutable | Immutable |
| ARM64 (Graviton) | Optional | Yes (20% savings) |

## Required SSM Parameters

Create these parameters before deploying services:

```bash
# Database (created automatically by 04-create-rds.sh)
# aws ssm put-parameter --name "/campfire-prod/database-url" --value "..." --type SecureString

# Redis connection
aws ssm put-parameter \
    --name "/campfire-prod/redis-url" \
    --value "redis://your-elasticache-endpoint:6379" \
    --type SecureString

# Authentication secrets
aws ssm put-parameter --name "/campfire-prod/jwt-secret" \
    --value "$(openssl rand -base64 48)" --type SecureString

aws ssm put-parameter --name "/campfire-prod/session-secret" \
    --value "$(openssl rand -base64 48)" --type SecureString

# API keys
aws ssm put-parameter --name "/campfire-prod/anthropic-api-key" \
    --value "sk-ant-..." --type SecureString

aws ssm put-parameter --name "/campfire-prod/openai-api-key" \
    --value "sk-..." --type SecureString

aws ssm put-parameter --name "/campfire-prod/deepgram-api-key" \
    --value "..." --type SecureString

aws ssm put-parameter --name "/campfire-prod/elevenlabs-api-key" \
    --value "..." --type SecureString

aws ssm put-parameter --name "/campfire-prod/replicate-api-token" \
    --value "..." --type SecureString
```

## SSL Certificate Setup

1. **Request certificate in ACM:**
```bash
aws acm request-certificate \
    --domain-name "campfire.app" \
    --subject-alternative-names "*.campfire.app" \
    --validation-method DNS \
    --tags Key=Project,Value=campfire Key=Environment,Value=prod
```

2. **Validate via DNS** (add CNAME records)

3. **Set environment variable:**
```bash
export ACM_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789:certificate/xxx
```

## Custom Domain Setup (Route 53)

```bash
# Get ALB details
source vpc-outputs.env

# Create alias record
aws route53 change-resource-record-sets \
    --hosted-zone-id YOUR_ZONE_ID \
    --change-batch '{
        "Changes": [{
            "Action": "CREATE",
            "ResourceRecordSet": {
                "Name": "app.campfire.app",
                "Type": "A",
                "AliasTarget": {
                    "HostedZoneId": "'${ALB_ZONE_ID}'",
                    "DNSName": "'${ALB_DNS}'",
                    "EvaluateTargetHealth": true
                }
            }
        }]
    }'
```

## Monitoring and Alerting

### CloudWatch Dashboard
Access at: `https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=campfire-prod-dashboard`

### Alert Subscriptions
```bash
source vpc-outputs.env

# Subscribe email for standard alerts
aws sns subscribe \
    --topic-arn "${SNS_TOPIC_ARN}" \
    --protocol email \
    --notification-endpoint ops-team@example.com

# Subscribe email for critical alerts (oncall)
aws sns subscribe \
    --topic-arn "${SNS_CRITICAL_TOPIC_ARN}" \
    --protocol email \
    --notification-endpoint oncall@example.com

# Optional: Slack webhook for alerts
aws sns subscribe \
    --topic-arn "${SNS_TOPIC_ARN}" \
    --protocol https \
    --notification-endpoint https://hooks.slack.com/services/xxx
```

### Key Alarms
- **Critical** (page oncall):
  - 5xx error rate > 50/min
  - Unhealthy hosts detected
  - RDS storage < 10GB

- **Warning** (notify team):
  - CPU > 85%
  - Memory > 85%
  - Response latency p95 > 2s
  - RDS connections > 100

## Deployment

### Push Docker Images
```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
    docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and tag for production
docker build -t campfire-gateway:prod-v1.0.0 -f infra/docker/Dockerfile.gateway .
docker tag campfire-gateway:prod-v1.0.0 \
    <account-id>.dkr.ecr.us-east-1.amazonaws.com/campfire/gateway:prod-v1.0.0
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/campfire/gateway:prod-v1.0.0
```

### Deploy Single Service
```bash
IMAGE_TAG=prod-v1.0.0 ./10-deploy-services.sh gateway
```

### Rolling Update
```bash
aws ecs update-service \
    --cluster campfire-prod-cluster \
    --service campfire-prod-gateway \
    --force-new-deployment
```

### Blue/Green Deployment (Manual)
```bash
# 1. Deploy new task definition
aws ecs register-task-definition --cli-input-json file://new-task-def.json

# 2. Update service with new task definition
aws ecs update-service \
    --cluster campfire-prod-cluster \
    --service campfire-prod-gateway \
    --task-definition campfire-prod-gateway:NEW_VERSION

# 3. Monitor rollout
aws ecs describe-services \
    --cluster campfire-prod-cluster \
    --services campfire-prod-gateway \
    --query 'services[0].deployments'
```

## Troubleshooting

### Check Service Health
```bash
# Service status
aws ecs describe-services \
    --cluster campfire-prod-cluster \
    --services campfire-prod-gateway \
    --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,Deployments:deployments}'

# Task health
aws ecs list-tasks --cluster campfire-prod-cluster --service-name campfire-prod-gateway
aws ecs describe-tasks --cluster campfire-prod-cluster --tasks <task-arn>

# Target group health
aws elbv2 describe-target-health --target-group-arn $GATEWAY_TG_ARN
```

### View Logs
```bash
# Tail logs
aws logs tail /ecs/campfire-prod/gateway --since 1h --follow

# Search for errors
aws logs filter-log-events \
    --log-group-name /ecs/campfire-prod/gateway \
    --filter-pattern "ERROR" \
    --start-time $(date -d '1 hour ago' +%s)000
```

### Debug Container
```bash
# Enable ECS Exec
TASK_ID=$(aws ecs list-tasks \
    --cluster campfire-prod-cluster \
    --service-name campfire-prod-gateway \
    --query 'taskArns[0]' --output text | cut -d'/' -f3)

# Execute shell
aws ecs execute-command \
    --cluster campfire-prod-cluster \
    --task $TASK_ID \
    --container gateway \
    --interactive \
    --command "/bin/sh"
```

### Rollback Deployment
```bash
# Find previous task definition
aws ecs list-task-definitions \
    --family-prefix campfire-prod-gateway \
    --sort DESC \
    --max-items 5

# Rollback to previous version
aws ecs update-service \
    --cluster campfire-prod-cluster \
    --service campfire-prod-gateway \
    --task-definition campfire-prod-gateway:PREVIOUS_VERSION \
    --force-new-deployment
```

## Cost Estimation

| Resource | Configuration | Estimated Monthly Cost |
|----------|--------------|----------------------|
| NAT Gateways | 3x (per-AZ HA) | ~$100 |
| RDS (db.r6g.large Multi-AZ) | 100GB, Multi-AZ | ~$400 |
| RDS Read Replica | db.r6g.large | ~$150 |
| ECS Fargate | ~15 tasks avg | ~$200-400 |
| ALB | 1x with WAF | ~$50 |
| S3 | Media, Vault, Logs | ~$20-50 |
| CloudWatch | Logs, Metrics | ~$30-50 |
| VPC Endpoints | 6 interface endpoints | ~$50 |
| **Total** | | **~$1,000-1,200/month** |

### Cost Optimization Tips
1. Use ARM64 (Graviton) - 20% savings (already configured)
2. FARGATE_SPOT for marketing/workers - up to 70% savings
3. Reserved Capacity for RDS - up to 40% savings
4. S3 Intelligent-Tiering - automatic cost optimization
5. VPC Endpoints - reduce NAT data transfer costs

## Security Checklist

- [ ] SSL/TLS certificate configured
- [ ] WAF enabled with managed rules
- [ ] VPC Flow Logs enabled
- [ ] RDS encryption enabled (KMS)
- [ ] S3 buckets encrypted and access blocked
- [ ] IAM roles with least-privilege
- [ ] Secrets in SSM Parameter Store (SecureString)
- [ ] Security groups restrict access appropriately
- [ ] Multi-AZ deployment for HA
- [ ] Backup retention configured (30 days)
- [ ] CloudWatch alarms configured
- [ ] SNS alerts subscribed

## Disaster Recovery

### RDS Point-in-Time Recovery
```bash
aws rds restore-db-instance-to-point-in-time \
    --source-db-instance-identifier campfire-prod-postgres \
    --target-db-instance-identifier campfire-prod-postgres-restored \
    --restore-time 2024-01-15T10:00:00Z
```

### S3 Object Recovery (versioning enabled)
```bash
# List object versions
aws s3api list-object-versions --bucket campfire-prod-vault --prefix path/to/object

# Restore specific version
aws s3api copy-object \
    --bucket campfire-prod-vault \
    --copy-source campfire-prod-vault/path/to/object?versionId=xxx \
    --key path/to/object
```

## Cleanup

**WARNING: This will delete all production resources!**

```bash
# Scale down all services first
for service in gateway orchestrator web marketing workers; do
    aws ecs update-service \
        --cluster campfire-prod-cluster \
        --service campfire-prod-${service} \
        --desired-count 0
done

# Wait and delete services
for service in gateway orchestrator web marketing workers; do
    aws ecs delete-service \
        --cluster campfire-prod-cluster \
        --service campfire-prod-${service} \
        --force
done

# Delete other resources in reverse order...
# (See vpc-outputs.env for resource IDs)
```

## Support

For issues with production infrastructure:
1. Check CloudWatch dashboard for errors
2. Review recent deployments
3. Check SNS alert history
4. Escalate to platform team if needed
