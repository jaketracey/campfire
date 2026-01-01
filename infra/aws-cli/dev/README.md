# Campfire AWS Infrastructure - Development Environment

This directory contains AWS CLI scripts to provision and manage the Campfire infrastructure in the development environment.

## Prerequisites

1. **AWS CLI v2** installed and configured
2. **AWS credentials** with appropriate permissions
3. **jq** for JSON processing (optional but recommended)

```bash
# Install AWS CLI (macOS)
brew install awscli

# Configure AWS credentials
aws configure --profile campfire-dev
```

## Quick Start

Run scripts in order to set up the complete infrastructure:

```bash
cd infra/aws-cli/dev

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
| `01-create-s3-buckets.sh` | Creates S3 buckets for media and vault | ~1 min |
| `02-create-ecr-repos.sh` | Creates ECR repositories for container images | ~1 min |
| `03-create-vpc.sh` | Creates VPC, subnets, NAT gateway, security groups | ~5 min |
| `04-create-rds.sh` | Creates RDS PostgreSQL instance | ~10-15 min |
| `05-create-ecs-cluster.sh` | Creates ECS Fargate cluster | ~2 min |
| `06-create-task-definitions.sh` | Registers ECS task definitions | ~1 min |
| `07-create-alb.sh` | Creates ALB and target groups | ~3 min |
| `08-create-iam-roles.sh` | Creates IAM roles and policies | ~1 min |
| `09-create-cloudwatch.sh` | Creates log groups, dashboard, alarms | ~2 min |
| `10-deploy-services.sh` | Deploys services to ECS | ~5-10 min |

## Configuration

All configuration is centralized in `00-config.sh`. Key settings:

```bash
AWS_REGION=us-east-1
PROJECT_NAME=campfire
ENVIRONMENT=dev

# VPC
VPC_CIDR=10.0.0.0/16

# RDS
RDS_INSTANCE_CLASS=db.t3.medium

# ECS Resources
GATEWAY_CPU=256
GATEWAY_MEMORY=512
```

## Required SSM Parameters

Before deploying services, create these SSM parameters:

```bash
# Database connection
aws ssm put-parameter --name "/campfire-dev/database-url" --value "postgresql://..." --type SecureString

# Redis connection
aws ssm put-parameter --name "/campfire-dev/redis-url" --value "redis://..." --type SecureString

# Authentication secrets
aws ssm put-parameter --name "/campfire-dev/jwt-secret" --value "your-jwt-secret" --type SecureString
aws ssm put-parameter --name "/campfire-dev/session-secret" --value "your-session-secret" --type SecureString

# API keys
aws ssm put-parameter --name "/campfire-dev/anthropic-api-key" --value "sk-..." --type SecureString
aws ssm put-parameter --name "/campfire-dev/openai-api-key" --value "sk-..." --type SecureString
aws ssm put-parameter --name "/campfire-dev/deepgram-api-key" --value "..." --type SecureString
aws ssm put-parameter --name "/campfire-dev/elevenlabs-api-key" --value "..." --type SecureString
aws ssm put-parameter --name "/campfire-dev/replicate-api-token" --value "..." --type SecureString
```

## Resource Outputs

After running the VPC script, resource IDs are saved to `vpc-outputs.env`:

```bash
source vpc-outputs.env
echo $VPC_ID
echo $RDS_ENDPOINT
echo $ALB_DNS
```

## Health Check Endpoints

| Service | Health Check Path | Port |
|---------|------------------|------|
| Gateway | `/health` | 4000 |
| Orchestrator | `/health` | 5000 |
| Web | `/api/health` | 3000 |
| Marketing | `/api/health` | 3001 |
| Workers | `/health` | 8080 |

## Common Operations

### Push Docker Images to ECR

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and push gateway
docker build -f infra/docker/Dockerfile.gateway -t campfire-gateway .
docker tag campfire-gateway:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/campfire-dev/gateway:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/campfire-dev/gateway:latest
```

### Deploy Single Service

```bash
./10-deploy-services.sh gateway
```

### Force New Deployment

```bash
aws ecs update-service \
    --cluster campfire-dev-cluster \
    --service campfire-dev-gateway \
    --force-new-deployment
```

### View Logs

```bash
# Tail logs
aws logs tail /ecs/campfire-dev/gateway --follow

# Search for errors
aws logs filter-log-events \
    --log-group-name /ecs/campfire-dev/gateway \
    --filter-pattern "ERROR"
```

### Execute Command in Container

```bash
# Get task ID
TASK_ID=$(aws ecs list-tasks --cluster campfire-dev-cluster --service-name campfire-dev-gateway --query 'taskArns[0]' --output text | cut -d'/' -f3)

# Execute shell
aws ecs execute-command \
    --cluster campfire-dev-cluster \
    --task $TASK_ID \
    --container gateway \
    --interactive \
    --command "/bin/sh"
```

### Scale Service

```bash
aws ecs update-service \
    --cluster campfire-dev-cluster \
    --service campfire-dev-gateway \
    --desired-count 4
```

## Cleanup

To delete all resources (in reverse order):

```bash
# Stop all services first
aws ecs update-service --cluster campfire-dev-cluster --service campfire-dev-gateway --desired-count 0
aws ecs update-service --cluster campfire-dev-cluster --service campfire-dev-orchestrator --desired-count 0
aws ecs update-service --cluster campfire-dev-cluster --service campfire-dev-web --desired-count 0
aws ecs update-service --cluster campfire-dev-cluster --service campfire-dev-marketing --desired-count 0
aws ecs update-service --cluster campfire-dev-cluster --service campfire-dev-workers --desired-count 0

# Delete services
aws ecs delete-service --cluster campfire-dev-cluster --service campfire-dev-gateway --force
# ... repeat for other services

# Delete ALB
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN

# Delete RDS (will take time)
aws rds delete-db-instance --db-instance-identifier campfire-dev-postgres --skip-final-snapshot

# Delete NAT Gateway and release EIP
aws ec2 delete-nat-gateway --nat-gateway-id $NAT_GW_ID
aws ec2 release-address --allocation-id $EIP_ALLOC_ID

# Delete VPC (after all resources are deleted)
aws ec2 delete-vpc --vpc-id $VPC_ID

# Delete S3 buckets (must be empty first)
aws s3 rm s3://campfire-dev-media --recursive
aws s3 rb s3://campfire-dev-media
aws s3 rm s3://campfire-dev-vault --recursive
aws s3 rb s3://campfire-dev-vault
```

## Troubleshooting

### Task fails to start

1. Check CloudWatch logs for errors
2. Verify SSM parameters exist
3. Check security group allows traffic
4. Ensure ECR image exists

### Health check failing

1. Verify health check endpoint works locally
2. Check security group allows health check traffic
3. Increase health check timeout/interval
4. Check container logs for startup errors

### Cannot connect to RDS

1. Verify security group allows traffic from ECS tasks
2. Check RDS is in correct subnet
3. Verify DATABASE_URL parameter is correct

## Cost Optimization

For development environments:

- Use `FARGATE_SPOT` for non-critical services
- Schedule scaling to zero during off-hours
- Use smaller RDS instance class
- Set lower CloudWatch log retention
