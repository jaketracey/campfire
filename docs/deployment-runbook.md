# Campfire Deployment Runbook

This document provides operational procedures for deploying and managing Campfire services in AWS ECS Fargate.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Deployment Workflows](#deployment-workflows)
4. [Environment Configuration](#environment-configuration)
5. [Manual Deployment](#manual-deployment)
6. [Rollback Procedures](#rollback-procedures)
7. [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)
8. [Emergency Procedures](#emergency-procedures)

---

## Overview

### Architecture

Campfire consists of five services deployed to AWS ECS Fargate:

| Service | Port | Description | Load Balanced |
|---------|------|-------------|---------------|
| gateway | 4000 | WebSocket and HTTP API gateway | Yes |
| orchestrator | 5000 | Python agent runner | No (internal) |
| web | 3000 | Next.js web application | Yes |
| marketing | 3001 | Marketing site | Yes |
| workers | 8080 | Background job processors | No |

### Environments

| Environment | Purpose | Auto-Deploy | Approval Required |
|-------------|---------|-------------|-------------------|
| dev | Development testing | Yes (on main push) | No |
| staging | Pre-production testing | Manual trigger | No |
| prod | Production | Manual trigger | Yes |

---

## Prerequisites

### Required Secrets (GitHub Repository Settings)

```
AWS_ACCOUNT_ID          - AWS account ID
DEV_GATEWAY_URL         - Gateway URL for dev
DEV_WS_URL              - WebSocket URL for dev
DEV_WEB_URL             - Web app URL for dev
DEV_STRIPE_PUBLISHABLE_KEY - Stripe key for dev
STAGING_GATEWAY_URL     - Gateway URL for staging
STAGING_WS_URL          - WebSocket URL for staging
STAGING_WEB_URL         - Web app URL for staging
STAGING_STRIPE_PUBLISHABLE_KEY - Stripe key for staging
PROD_GATEWAY_URL        - Gateway URL for prod
PROD_WS_URL             - WebSocket URL for prod
PROD_WEB_URL            - Web app URL for prod
PROD_STRIPE_PUBLISHABLE_KEY - Stripe key for prod
POSTHOG_KEY             - PostHog project key
POSTHOG_HOST            - PostHog host URL
GTM_ID                  - Google Tag Manager ID
```

### AWS OIDC Configuration

Run the IAM setup script to create the GitHub Actions deployment role:

```bash
cd infra/aws-cli/dev
GITHUB_ORG=your-org GITHUB_REPO=campfire ./11-create-github-actions-role.sh
```

### GitHub Environments

Create the following environments in GitHub Repository Settings:

1. **dev** - No protection rules
2. **staging** - No protection rules (optional: required reviewers)
3. **prod** / **production** - Required reviewers, deployment branches restricted to main
4. **production-rollback** - Required reviewers for emergency rollbacks

---

## Deployment Workflows

### Automatic Deployment (dev)

Pushes to the `main` branch automatically deploy to dev:

```yaml
# Triggered automatically on push to main
# No manual intervention required
```

### Manual Deployment

Deploy to any environment via GitHub Actions UI or CLI:

```bash
# Deploy all services to staging
gh workflow run deploy.yml -f environment=staging -f services=all

# Deploy specific services to prod
gh workflow run deploy.yml -f environment=prod -f services=gateway,web

# Dry run (build but don't deploy)
gh workflow run deploy.yml -f environment=staging -f services=all -f dry_run=true
```

### Workflow Parameters

| Parameter | Values | Description |
|-----------|--------|-------------|
| environment | dev, staging, prod | Target deployment environment |
| services | all, or comma-separated | Services to deploy |
| skip_tests | true, false | Skip test suite (not recommended) |
| dry_run | true, false | Build without deploying |

---

## Environment Configuration

### ECR Repositories

Images are pushed to environment-specific ECR repositories:

```
{account}.dkr.ecr.us-east-1.amazonaws.com/campfire-dev/{service}
{account}.dkr.ecr.us-east-1.amazonaws.com/campfire-staging/{service}
{account}.dkr.ecr.us-east-1.amazonaws.com/campfire-prod/{service}
```

### ECS Resources

```
Cluster: campfire-{env}-cluster
Service: campfire-{env}-{service}
Task Definition: campfire-{env}-{service}
```

### Image Tagging Strategy

Images are tagged with:
- `{env}-{short-sha}-{timestamp}` - Unique deployment tag
- `latest` - Most recent deployment (use with caution)

Example: `dev-abc1234-20240115143022`

---

## Manual Deployment

If GitHub Actions is unavailable, deploy manually using AWS CLI:

### Step 1: Build and Push Image

```bash
# Set environment
export ENVIRONMENT=dev
export SERVICE=gateway
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Login to ECR
aws ecr get-login-password --region ${AWS_REGION} | \
  docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build image
docker build -f infra/docker/Dockerfile.${SERVICE} \
  --target production \
  -t campfire-${SERVICE}:latest .

# Tag and push
IMAGE_TAG="${ENVIRONMENT}-$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
ECR_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/campfire-${ENVIRONMENT}/${SERVICE}"

docker tag campfire-${SERVICE}:latest ${ECR_REPO}:${IMAGE_TAG}
docker tag campfire-${SERVICE}:latest ${ECR_REPO}:latest
docker push ${ECR_REPO}:${IMAGE_TAG}
docker push ${ECR_REPO}:latest
```

### Step 2: Update ECS Service

```bash
# Get current task definition
TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition campfire-${ENVIRONMENT}-${SERVICE} \
  --query 'taskDefinition' \
  --output json)

# Update image in task definition
NEW_TASK_DEF=$(echo ${TASK_DEF} | jq \
  --arg IMAGE "${ECR_REPO}:${IMAGE_TAG}" \
  '.containerDefinitions[0].image = $IMAGE |
   del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)')

# Register new task definition
NEW_TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "${NEW_TASK_DEF}" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

# Update service
aws ecs update-service \
  --cluster campfire-${ENVIRONMENT}-cluster \
  --service campfire-${ENVIRONMENT}-${SERVICE} \
  --task-definition ${NEW_TASK_DEF_ARN} \
  --force-new-deployment

# Wait for stability
aws ecs wait services-stable \
  --cluster campfire-${ENVIRONMENT}-cluster \
  --services campfire-${ENVIRONMENT}-${SERVICE}
```

---

## Rollback Procedures

### Automatic Rollback

The deployment workflow includes automatic rollback on failure. If a deployment fails during the ECS update phase, it will automatically:

1. Detect the failure
2. Find the previous stable task definition
3. Roll back to that version
4. Wait for service stability

### Manual Rollback via Workflow

Use the dedicated rollback workflow:

```bash
# Rollback to previous version
gh workflow run rollback.yml \
  -f environment=prod \
  -f services=all \
  -f rollback_type=previous \
  -f reason="High error rate after deployment"

# Rollback to specific task definition revision
gh workflow run rollback.yml \
  -f environment=prod \
  -f services=gateway \
  -f rollback_type=specific_revision \
  -f target_revision=42 \
  -f reason="Rolling back to known good version"

# Rollback to specific image tag
gh workflow run rollback.yml \
  -f environment=prod \
  -f services=web \
  -f rollback_type=specific_tag \
  -f target_revision=prod-abc1234-20240115143022 \
  -f reason="Rolling back to version before feature X"
```

### Emergency Manual Rollback

If GitHub Actions is unavailable:

```bash
# Find previous task definition
aws ecs list-task-definitions \
  --family-prefix campfire-prod-gateway \
  --sort DESC \
  --status ACTIVE \
  --query 'taskDefinitionArns[:5]'

# Rollback to specific version
aws ecs update-service \
  --cluster campfire-prod-cluster \
  --service campfire-prod-gateway \
  --task-definition campfire-prod-gateway:41 \
  --force-new-deployment

# Wait for stability
aws ecs wait services-stable \
  --cluster campfire-prod-cluster \
  --services campfire-prod-gateway
```

---

## Monitoring and Troubleshooting

### View Service Status

```bash
# All services
aws ecs describe-services \
  --cluster campfire-prod-cluster \
  --services \
    campfire-prod-gateway \
    campfire-prod-orchestrator \
    campfire-prod-web \
    campfire-prod-marketing \
    campfire-prod-workers

# Single service
aws ecs describe-services \
  --cluster campfire-prod-cluster \
  --services campfire-prod-gateway \
  --query 'services[0].{
    Status: status,
    RunningCount: runningCount,
    DesiredCount: desiredCount,
    TaskDefinition: taskDefinition,
    Deployments: deployments
  }'
```

### View Running Tasks

```bash
# List tasks
aws ecs list-tasks \
  --cluster campfire-prod-cluster \
  --service-name campfire-prod-gateway

# Describe tasks
aws ecs describe-tasks \
  --cluster campfire-prod-cluster \
  --tasks $(aws ecs list-tasks --cluster campfire-prod-cluster --service-name campfire-prod-gateway --query 'taskArns' --output text)
```

### View Logs

```bash
# Tail logs
aws logs tail /ecs/campfire-prod/gateway --follow

# View specific time range
aws logs filter-log-events \
  --log-group-name /ecs/campfire-prod/gateway \
  --start-time $(date -d '1 hour ago' +%s000) \
  --filter-pattern "ERROR"

# View deployment events
aws logs filter-log-events \
  --log-group-name /campfire/prod/deployments \
  --log-stream-names deploy-events \
  --start-time $(date -d '1 day ago' +%s000)
```

### Connect to Container

```bash
# Enable ECS Exec (already enabled in service definition)
aws ecs execute-command \
  --cluster campfire-prod-cluster \
  --task <task-id> \
  --container gateway \
  --interactive \
  --command "/bin/sh"
```

### Health Check Endpoints

```bash
# Check all services
curl https://api.campfire.com/health         # gateway
curl https://app.campfire.com/api/health     # web
curl https://campfire.com/api/health         # marketing
```

---

## Emergency Procedures

### Complete Service Outage

1. **Check AWS Status**: Verify no AWS outage in us-east-1
2. **Check ECS Cluster**: `aws ecs describe-clusters --clusters campfire-prod-cluster`
3. **Check Service Health**: View service status and task health
4. **Check ALB**: `aws elbv2 describe-target-health --target-group-arn <arn>`
5. **Rollback if needed**: Use emergency rollback procedures above

### Scale Down/Up

```bash
# Scale down (emergency)
aws ecs update-service \
  --cluster campfire-prod-cluster \
  --service campfire-prod-gateway \
  --desired-count 0

# Scale up
aws ecs update-service \
  --cluster campfire-prod-cluster \
  --service campfire-prod-gateway \
  --desired-count 2
```

### Force New Deployment

If containers are unhealthy but service is stuck:

```bash
aws ecs update-service \
  --cluster campfire-prod-cluster \
  --service campfire-prod-gateway \
  --force-new-deployment
```

### Database Issues

If database connectivity is the problem:

1. Check RDS instance status
2. Verify security group rules
3. Check secrets manager for correct credentials
4. Verify VPC networking

---

## Deployment Events

All deployments emit events to CloudWatch Logs for audit and observability:

| Event Type | Description |
|------------|-------------|
| deploy.started | Deployment initiated |
| deploy.completed | Deployment successful |
| deploy.failed | Deployment failed |
| deploy.rollback | Automatic rollback triggered |
| rollback.started | Manual rollback initiated |
| rollback.completed | Rollback successful |
| rollback.failed | Rollback failed |
| smoke_tests.completed | Post-deployment smoke tests finished |

View events:

```bash
aws logs filter-log-events \
  --log-group-name /campfire/prod/deployments \
  --log-stream-names deploy-events \
  --filter-pattern "deploy" \
  --start-time $(date -d '1 day ago' +%s000)
```

---

## Contacts

- **On-call**: Check PagerDuty
- **Slack**: #campfire-ops
- **AWS Console**: https://console.aws.amazon.com/ecs/home?region=us-east-1

---

*Last updated: 2024-01-15*
