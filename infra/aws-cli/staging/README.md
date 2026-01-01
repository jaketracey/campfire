# Campfire AWS Infrastructure - Staging Environment

This directory contains AWS CLI scripts to provision and manage the Campfire infrastructure in the staging environment. The staging environment mirrors production as closely as possible while keeping costs lower.

## Environment Comparison

| Resource | Dev | Staging | Production |
|----------|-----|---------|------------|
| RDS Instance | db.t3.medium | db.t3.large | db.r6g.xlarge |
| ECS Gateway CPU/Memory | 256/512 | 512/1024 | 1024/2048 |
| ECS Orchestrator CPU/Memory | 512/1024 | 1024/2048 | 2048/4096 |
| ECS Web CPU/Memory | 256/512 | 512/1024 | 1024/2048 |
| Log Retention | 14 days | 30 days | 90 days |
| Backup Retention | 7 days | 14 days | 35 days |
| Auto-scaling | No | Yes | Yes |
| Deletion Protection | No | Yes | Yes |
| VPC Flow Logs | No | Yes | Yes |
| Multi-AZ RDS | No | Optional | Yes |

## Prerequisites

1. **AWS CLI v2** installed and configured
2. **AWS credentials** with appropriate permissions
3. **jq** for JSON processing (optional but recommended)

```bash
# Install AWS CLI (macOS)
brew install awscli

# Configure AWS credentials for staging
aws configure --profile campfire-staging
```

## Quick Start

Run scripts in order to set up the complete infrastructure:

```bash
cd infra/aws-cli/staging

# Make scripts executable
chmod +x *.sh

# 1. Create S3 buckets for media and vault storage
./01-create-s3-buckets.sh

# 2. Create ECR repositories for container images
./02-create-ecr-repos.sh

# 3. Create VPC with subnets and security groups
./03-create-vpc.sh

# 4. Create RDS PostgreSQL instance
./04-create-rds.sh

# 5. Create ECS cluster
./05-create-ecs-cluster.sh

# 6. Create ECS task definitions
./06-create-task-definitions.sh

# 7. Create Application Load Balancer
./07-create-alb.sh

# 8. Create IAM roles for ECS
./08-create-iam-roles.sh

# 9. Create CloudWatch log groups and alarms
./09-create-cloudwatch.sh

# 10. Deploy services to ECS
./10-deploy-services.sh
```

## Script Reference

| Script | Description | Duration |
|--------|-------------|----------|
| `00-config.sh` | Configuration variables (sourced by other scripts) | - |
| `01-create-s3-buckets.sh` | Creates S3 buckets with encryption and lifecycle | ~1 min |
| `02-create-ecr-repos.sh` | Creates ECR repositories with immutable tags | ~1 min |
| `03-create-vpc.sh` | Creates VPC, subnets, NAT, flow logs, security groups | ~5 min |
| `04-create-rds.sh` | Creates RDS PostgreSQL with enhanced monitoring | ~10-15 min |
| `05-create-ecs-cluster.sh` | Creates ECS Fargate cluster with insights | ~2 min |
| `06-create-task-definitions.sh` | Registers ECS task definitions | ~1 min |
| `07-create-alb.sh` | Creates ALB with HTTPS and deletion protection | ~3 min |
| `08-create-iam-roles.sh` | Creates IAM roles with least privilege | ~1 min |
| `09-create-cloudwatch.sh` | Creates logs, dashboard, production-like alarms | ~2 min |
| `10-deploy-services.sh` | Deploys services with auto-scaling | ~5-10 min |

## Configuration

All configuration is centralized in `00-config.sh`. Key staging settings:

```bash
AWS_REGION=us-east-1
PROJECT_NAME=campfire
ENVIRONMENT=staging

# VPC (different CIDR from dev to allow peering)
VPC_CIDR=10.1.0.0/16

# RDS (larger than dev)
RDS_INSTANCE_CLASS=db.t3.large
RDS_BACKUP_RETENTION=14

# ECS Resources (higher than dev)
GATEWAY_CPU=512
GATEWAY_MEMORY=1024

# Auto-scaling (production-like)
AUTOSCALING_ENABLED=true
AUTOSCALING_CPU_TARGET=70
AUTOSCALING_MEMORY_TARGET=70
```

## Production-like Features

The staging environment includes these production-like settings:

### Security
- VPC Flow Logs enabled for network monitoring
- Stricter security group rules (HTTPS only on ALB)
- Least-privilege IAM policies with source conditions
- ECR image tag immutability
- S3 bucket encryption (AES256 for media, KMS for vault)
- RDS encryption at rest and in transit

### Reliability
- Deletion protection on ALB and RDS
- Deployment circuit breaker with automatic rollback
- Zero-downtime deployments (100% minimum healthy)
- Auto-scaling based on CPU and memory metrics
- Multiple availability zones

### Observability
- Comprehensive CloudWatch dashboard
- Production-like alarm thresholds (75% CPU/Memory)
- Longer log retention (30 days)
- RDS Performance Insights enabled
- Container Insights enabled

### Cost Optimization
- FARGATE primary with FARGATE_SPOT for cost savings
- Lifecycle policies for S3 storage tiering
- ECR lifecycle policies for image cleanup
- gp3 storage for RDS (cost-effective IOPS)

## Required SSM Parameters

Before deploying services, create these SSM parameters:

```bash
# Database connection (use the generated .database-url file)
aws ssm put-parameter --name "/campfire-staging/database-url" --value "postgresql://..." --type SecureString

# Redis connection
aws ssm put-parameter --name "/campfire-staging/redis-url" --value "redis://..." --type SecureString

# Authentication secrets
aws ssm put-parameter --name "/campfire-staging/jwt-secret" --value "$(openssl rand -hex 32)" --type SecureString
aws ssm put-parameter --name "/campfire-staging/session-secret" --value "$(openssl rand -hex 32)" --type SecureString

# API keys
aws ssm put-parameter --name "/campfire-staging/anthropic-api-key" --value "sk-..." --type SecureString
aws ssm put-parameter --name "/campfire-staging/openai-api-key" --value "sk-..." --type SecureString
aws ssm put-parameter --name "/campfire-staging/deepgram-api-key" --value "..." --type SecureString
aws ssm put-parameter --name "/campfire-staging/elevenlabs-api-key" --value "..." --type SecureString
aws ssm put-parameter --name "/campfire-staging/replicate-api-token" --value "..." --type SecureString
```

## HTTPS Configuration

To enable HTTPS (recommended for staging):

```bash
# 1. Request a certificate
aws acm request-certificate \
    --domain-name staging.campfire.dev \
    --validation-method DNS \
    --tags Key=Project,Value=campfire Key=Environment,Value=staging

# 2. Validate the certificate (add DNS record)
# 3. Re-run 07-create-alb.sh to configure HTTPS listener
```

## Resource Outputs

After running the VPC script, resource IDs are saved to `vpc-outputs.env`:

```bash
source vpc-outputs.env
echo $VPC_ID
echo $RDS_ENDPOINT
echo $ALB_DNS
```

## Auto-scaling Configuration

Staging includes auto-scaling with these settings:

| Service | Min | Max | CPU Target | Memory Target |
|---------|-----|-----|------------|---------------|
| Gateway | 2 | 6 | 70% | 70% |
| Orchestrator | 2 | 8 | 70% | 70% |
| Web | 2 | 6 | 70% | 70% |
| Marketing | 1 | 4 | 70% | 70% |
| Workers | 1 | 6 | 70% | 70% |

Scale-in cooldown: 300 seconds
Scale-out cooldown: 60 seconds

## Common Operations

### Push Docker Images to ECR

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and push with staging tag
docker build -f infra/docker/Dockerfile.gateway -t campfire-gateway .
docker tag campfire-gateway:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/campfire-staging/gateway:staging-$(git rev-parse --short HEAD)
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/campfire-staging/gateway:staging-$(git rev-parse --short HEAD)
```

### Deploy Single Service

```bash
./10-deploy-services.sh gateway
```

### Force New Deployment

```bash
aws ecs update-service \
    --cluster campfire-staging-cluster \
    --service campfire-staging-gateway \
    --force-new-deployment
```

### View Logs

```bash
# Tail logs
aws logs tail /ecs/campfire-staging/gateway --follow

# Search for errors
aws logs filter-log-events \
    --log-group-name /ecs/campfire-staging/gateway \
    --filter-pattern "ERROR"
```

### Execute Command in Container

```bash
# Get task ID
TASK_ID=$(aws ecs list-tasks --cluster campfire-staging-cluster --service-name campfire-staging-gateway --query 'taskArns[0]' --output text | cut -d'/' -f3)

# Execute shell
aws ecs execute-command \
    --cluster campfire-staging-cluster \
    --task $TASK_ID \
    --container gateway \
    --interactive \
    --command "/bin/sh"
```

### Scale Service Manually

```bash
aws ecs update-service \
    --cluster campfire-staging-cluster \
    --service campfire-staging-gateway \
    --desired-count 4
```

### View Auto-scaling Activity

```bash
aws application-autoscaling describe-scaling-activities \
    --service-namespace ecs \
    --resource-id service/campfire-staging-cluster/campfire-staging-gateway
```

## Cleanup

To delete all resources (requires removing deletion protection first):

```bash
# 1. Disable deletion protection on ALB
aws elbv2 modify-load-balancer-attributes \
    --load-balancer-arn $ALB_ARN \
    --attributes Key=deletion_protection.enabled,Value=false

# 2. Disable deletion protection on RDS
aws rds modify-db-instance \
    --db-instance-identifier campfire-staging-postgres \
    --no-deletion-protection \
    --apply-immediately

# 3. Stop all services first
aws ecs update-service --cluster campfire-staging-cluster --service campfire-staging-gateway --desired-count 0
aws ecs update-service --cluster campfire-staging-cluster --service campfire-staging-orchestrator --desired-count 0
aws ecs update-service --cluster campfire-staging-cluster --service campfire-staging-web --desired-count 0
aws ecs update-service --cluster campfire-staging-cluster --service campfire-staging-marketing --desired-count 0
aws ecs update-service --cluster campfire-staging-cluster --service campfire-staging-workers --desired-count 0

# 4. Delete services
aws ecs delete-service --cluster campfire-staging-cluster --service campfire-staging-gateway --force
# ... repeat for other services

# 5. Delete ALB
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN

# 6. Delete RDS (will take time)
aws rds delete-db-instance --db-instance-identifier campfire-staging-postgres --skip-final-snapshot

# 7. Delete NAT Gateway and release EIP
aws ec2 delete-nat-gateway --nat-gateway-id $NAT_GW_ID
aws ec2 release-address --allocation-id $EIP_ALLOC_ID

# 8. Delete VPC (after all resources are deleted)
aws ec2 delete-vpc --vpc-id $VPC_ID

# 9. Delete S3 buckets (must be empty first)
aws s3 rm s3://campfire-staging-media --recursive
aws s3 rb s3://campfire-staging-media
aws s3 rm s3://campfire-staging-vault --recursive
aws s3 rb s3://campfire-staging-vault
```

## Cost Estimation

Estimated monthly costs for staging environment (us-east-1):

| Resource | Configuration | Est. Cost/Month |
|----------|---------------|-----------------|
| RDS db.t3.large | Single-AZ, 50GB gp3 | ~$120 |
| NAT Gateway | 1 gateway + data transfer | ~$45 |
| ALB | Standard + data transfer | ~$25 |
| ECS Fargate | 5 services, 2 tasks each | ~$150 |
| CloudWatch | Logs, metrics, alarms | ~$30 |
| S3 | Storage + requests | ~$5 |
| ECR | Image storage | ~$5 |
| **Total** | | **~$380/month** |

Cost optimization tips:
- Use FARGATE_SPOT for workers (up to 70% savings)
- Scale to 1 task during off-hours
- Review and adjust auto-scaling thresholds
- Set up billing alerts

## Troubleshooting

### Task fails to start

1. Check CloudWatch logs for errors
2. Verify SSM parameters exist
3. Check security group allows traffic
4. Ensure ECR image exists and is tagged correctly

### Health check failing

1. Verify health check endpoint works locally
2. Check security group allows health check traffic
3. Increase health check timeout/interval
4. Check container logs for startup errors

### Cannot connect to RDS

1. Verify security group allows traffic from ECS tasks
2. Check RDS is in correct subnet
3. Verify DATABASE_URL parameter is correct

### Auto-scaling not working

1. Check Application Auto Scaling policies
2. Verify CloudWatch metrics are being published
3. Check scaling activity history for errors
4. Ensure min/max capacity allows scaling

### Deployment stuck

1. Check deployment circuit breaker status
2. Review ECS events for the service
3. Check task stopped reason
4. Verify container can start successfully
