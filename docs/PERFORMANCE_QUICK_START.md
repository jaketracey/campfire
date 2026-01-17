# Performance Testing Quick Start

Get started with performance testing in 5 minutes.

## Prerequisites

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Start services** (choose one):

   **Option A: Docker (Recommended)**
   ```bash
   pnpm docker:up
   ```

   **Option B: Local services**
   - PostgreSQL on `localhost:5432`
   - Redis on `localhost:6379`

3. **Run migrations**:
   ```bash
   pnpm db:migrate
   ```

## Quick Commands

### Run All Performance Tests

```bash
# Automated test runner (recommended)
pnpm --filter @campfire/gateway test:performance

# Individual test suites
pnpm --filter @campfire/gateway test:performance:api    # API latency
pnpm --filter @campfire/gateway test:performance:db     # Database
pnpm --filter @campfire/gateway test:performance:ws     # WebSocket
pnpm --filter @campfire/workers test:performance        # Workers
```

### Run Load Tests

First, start your application:
```bash
pnpm --filter @campfire/gateway build
pnpm --filter @campfire/gateway start
```

Then run load tests:
```bash
# Quick load test (30s)
pnpm --filter @campfire/gateway test:load:quick

# Standard load test (2min)
pnpm --filter @campfire/gateway test:load:standard

# Stress test (5min)
pnpm --filter @campfire/gateway test:load:stress
```

### Run Stability Tests

```bash
# Memory leak detection
pnpm --filter @campfire/gateway test:stability:memory

# Connection recovery
pnpm --filter @campfire/gateway test:stability:recovery

# All stability tests
pnpm --filter @campfire/gateway test:stability
```

### Run E2E Tests

```bash
pnpm --filter @campfire/gateway test:e2e
```

## Understanding Results

### Performance Metrics

Tests output percentile metrics:

```
API Endpoint Performance:
  p50: 45.23ms    ← 50% of requests faster than this
  p95: 120.56ms   ← 95% of requests faster than this (SLA target)
  p99: 250.12ms   ← 99% of requests faster than this
  mean: 62.34ms   ← Average response time
```

**What to look for**:
- ✅ **p95 < threshold**: Good performance
- ⚠️ **p95 near threshold**: Monitor closely
- ❌ **p95 > threshold**: Performance issue

### Load Test Results

k6 outputs summary metrics:

```
http_req_duration..........: avg=125ms p95=200ms p99=350ms
http_req_failed............: 1.5%
http_reqs..................: 1500 (50/s)
```

**What to look for**:
- ✅ **Error rate < 5%**: System handling load well
- ⚠️ **p95 increasing**: System under stress
- ❌ **Error rate > 5%**: System overloaded

### Memory Leak Detection

```
Memory Stability Test:
  Linear growth R²: 0.43
  Interpretation: STABLE - Memory usage stabilized
```

**What to look for**:
- ✅ **R² < 0.8**: No leak detected
- ❌ **R² > 0.8**: Potential memory leak

## Common Issues

### Tests timing out

**Fix**: Check services are running
```bash
# Check PostgreSQL
psql postgresql://postgres:postgres@localhost:5432/campfire_test

# Check Redis
redis-cli -h localhost -p 6379 ping

# Restart services
pnpm docker:down && pnpm docker:up
```

### Load tests failing

**Fix**: Ensure application is running
```bash
# Build and start application
pnpm --filter @campfire/gateway build
pnpm --filter @campfire/gateway start

# Verify it's running
curl http://localhost:3000/health
```

### Memory tests inaccurate

**Fix**: Always use `--expose-gc` flag
```bash
NODE_OPTIONS=--expose-gc pnpm test:stability:memory
```

## Next Steps

- Read the [full testing guide](./PERFORMANCE_TESTING.md)
- Review [performance thresholds](./PERFORMANCE_TESTING.md#performance-thresholds)
- Set up [CI/CD integration](./PERFORMANCE_TESTING.md#cicd-integration)
- Learn about [interpreting results](./PERFORMANCE_TESTING.md#interpreting-results)

## Need Help?

- Check [troubleshooting guide](./PERFORMANCE_TESTING.md#troubleshooting)
- Review test output for specific error messages
- Ensure all prerequisites are met
- Verify environment variables are set
