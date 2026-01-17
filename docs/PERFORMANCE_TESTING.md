# Performance and Stability Testing Guide

This document describes the comprehensive performance and stability test suite for the Campfire platform.

## Table of Contents

- [Overview](#overview)
- [Test Categories](#test-categories)
- [Running Tests](#running-tests)
- [Interpreting Results](#interpreting-results)
- [CI/CD Integration](#cicd-integration)
- [Performance Thresholds](#performance-thresholds)
- [Troubleshooting](#troubleshooting)

## Overview

The performance test suite provides comprehensive testing across multiple dimensions:

- **API Performance**: Endpoint latency with p50, p95, p99 percentiles
- **WebSocket Performance**: Connection handling and message throughput
- **Database Performance**: Query performance and connection pooling
- **Worker Performance**: Job processing speed and queue throughput
- **Load Testing**: System behavior under various load conditions
- **Stability Testing**: Memory leak detection and error recovery
- **E2E Performance**: Complete user flow performance metrics

## Test Categories

### 1. API Latency Tests

**Location**: `packages/gateway/tests/performance/api-latency.test.ts`

Measures response times for critical API endpoints with percentile analysis.

**Key Metrics**:
- p50 (median): 50% of requests complete within this time
- p95: 95% of requests complete within this time
- p99: 99% of requests complete within this time
- Mean, min, max response times

**Run**:
```bash
pnpm --filter @campfire/gateway test tests/performance/api-latency.test.ts
```

### 2. WebSocket Performance Tests

**Location**: `packages/gateway/tests/performance/websocket.test.ts`

Tests WebSocket connection establishment, message throughput, and concurrent connections.

**Key Metrics**:
- Connection establishment time
- Message round-trip latency
- Messages per second throughput
- Memory usage per connection
- Concurrent connection capacity

**Run**:
```bash
pnpm --filter @campfire/gateway test tests/performance/websocket.test.ts
```

### 3. Database Performance Tests

**Location**: `packages/gateway/tests/performance/database.test.ts`

Measures database query performance across different query types.

**Key Metrics**:
- Simple SELECT performance
- Indexed query performance
- JOIN query performance
- INSERT/UPDATE performance
- Transaction performance
- Connection pool behavior

**Run**:
```bash
pnpm --filter @campfire/gateway test tests/performance/database.test.ts
```

**Requirements**: PostgreSQL must be running on `localhost:5432`

### 4. Worker Job Processing Tests

**Location**: `packages/workers/tests/performance/worker-jobs.test.ts`

Tests background job processing performance and queue behavior.

**Key Metrics**:
- Job processing time
- Queue throughput (jobs/second)
- Job latency (queue time)
- Concurrent job processing
- Failed job retry performance

**Run**:
```bash
pnpm --filter @campfire/workers test tests/performance/worker-jobs.test.ts
```

**Requirements**: Redis must be running on `localhost:6379`

### 5. Load Tests (k6)

**Location**: `packages/gateway/tests/load/`

Simulates realistic load patterns with staged ramp-up.

**Test Scripts**:
- `k6-api-load.js`: API endpoint load testing
- `k6-websocket-load.js`: WebSocket connection load testing

**Run**:

```bash
# Install k6 first (macOS)
brew install k6

# Run API load test
k6 run --vus 10 --duration 30s packages/gateway/tests/load/k6-api-load.js

# Run with custom stages
k6 run packages/gateway/tests/load/k6-api-load.js

# Run WebSocket load test
k6 run --vus 20 --duration 1m packages/gateway/tests/load/k6-websocket-load.js
```

**Key Metrics**:
- Requests per second
- Error rate
- Response time percentiles
- Concurrent virtual users

### 6. Stability Tests

**Location**: `packages/gateway/tests/stability/`

Long-running tests to detect memory leaks and verify error recovery.

**Test Files**:
- `memory-leak.test.ts`: Memory leak detection
- `recovery.test.ts`: Connection recovery and error handling

**Run**:

```bash
# Enable garbage collection for accurate memory testing
NODE_OPTIONS=--expose-gc pnpm --filter @campfire/gateway test tests/stability/memory-leak.test.ts

# Run recovery tests
pnpm --filter @campfire/gateway test tests/stability/recovery.test.ts
```

**Key Metrics**:
- Heap growth per 1000 operations
- RSS growth per 1000 operations
- Memory stability (R² < 0.8 indicates stable)
- Connection recovery time
- Error recovery rate

### 7. E2E Performance Tests

**Location**: `packages/gateway/tests/e2e/conversation-flow.test.ts`

Tests complete user workflows with timing breakdowns.

**Test Scenarios**:
- User registration flow
- Conversation setup (companion + session)
- Message exchange
- Full conversation flow
- WebSocket conversation
- Group chat with multiple companions

**Run**:
```bash
pnpm --filter @campfire/gateway test tests/e2e/conversation-flow.test.ts
```

## Running Tests

### Prerequisites

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Start required services**:
   ```bash
   # Option 1: Using Docker Compose
   pnpm docker:up

   # Option 2: Manual setup
   # Start PostgreSQL on localhost:5432
   # Start Redis on localhost:6379
   ```

3. **Run database migrations**:
   ```bash
   pnpm db:migrate
   ```

### Run All Performance Tests

```bash
# Run all tests
pnpm test

# Run only performance tests
pnpm --filter @campfire/gateway test tests/performance/

# Run only stability tests
pnpm --filter @campfire/gateway test tests/stability/

# Run only E2E tests
pnpm --filter @campfire/gateway test tests/e2e/
```

### Run Individual Test Suites

```bash
# API latency
pnpm --filter @campfire/gateway test tests/performance/api-latency.test.ts

# WebSocket performance
pnpm --filter @campfire/gateway test tests/performance/websocket.test.ts

# Database performance
pnpm --filter @campfire/gateway test tests/performance/database.test.ts

# Worker performance
pnpm --filter @campfire/workers test tests/performance/worker-jobs.test.ts

# Memory leak detection
NODE_OPTIONS=--expose-gc pnpm --filter @campfire/gateway test tests/stability/memory-leak.test.ts

# Recovery tests
pnpm --filter @campfire/gateway test tests/stability/recovery.test.ts

# E2E flows
pnpm --filter @campfire/gateway test tests/e2e/conversation-flow.test.ts
```

## Interpreting Results

### Understanding Percentiles

- **p50 (median)**: Half of requests are faster, half are slower
- **p95**: 95% of requests are faster, 5% are slower (typical SLA target)
- **p99**: 99% of requests are faster, 1% are slower (worst-case performance)

**Example Output**:
```
API Endpoint Performance:
  p50: 45.23ms
  p95: 120.56ms
  p99: 250.12ms
  mean: 62.34ms
  min: 12.45ms
  max: 340.67ms
  count: 100
```

**Interpretation**:
- Most requests (50%) complete in under 45ms
- Nearly all requests (95%) complete in under 120ms
- Even slow requests (99%) complete in under 250ms
- Average response time is 62ms

### Pass/Fail Criteria

Tests automatically fail if metrics exceed defined thresholds:

```typescript
// Example threshold check
expect(metrics.p95).toBeLessThan(THRESHOLD.p95); // Fail if p95 > threshold
```

### Memory Leak Detection

**Key Indicators**:

1. **Linear Growth (BAD)**:
   - R² > 0.8 indicates linear memory growth
   - Memory continuously increases with operations
   - Likely memory leak present

2. **Stable Memory (GOOD)**:
   - R² < 0.8 indicates memory stabilizes
   - Memory grows initially then plateaus
   - Normal garbage collection behavior

**Example Output**:
```
Memory Stability Test:
  Snapshots: 15
  Linear growth R²: 0.43
  Interpretation: STABLE - Memory usage stabilized
```

### Load Test Results (k6)

**Key Metrics**:

```
http_req_duration............: avg=125ms p95=200ms p99=350ms
http_req_failed..............: 1.5% (error rate)
http_reqs....................: 1500 (throughput: 50/s)
```

**Thresholds**:
- `http_req_duration`: p95 < 500ms, p99 < 1000ms
- `http_req_failed`: < 5% error rate
- Throughput: Varies by test scenario

## CI/CD Integration

### GitHub Actions Workflow

Performance tests run automatically on:
- Pull requests to `main`
- Pushes to `main`
- Nightly schedule (2 AM UTC)
- Manual trigger via GitHub Actions UI

**Workflow**: `.github/workflows/performance-tests.yml`

### Jobs

1. **api-performance**: API latency and database tests
2. **websocket-performance**: WebSocket connection tests
3. **worker-performance**: Background job processing tests
4. **load-tests**: k6 load testing
5. **stability-tests**: Memory leak and recovery tests
6. **e2e-performance**: End-to-end flow tests
7. **performance-report**: Aggregate results summary

### Viewing Results

1. Go to GitHub Actions tab
2. Select "Performance Tests" workflow
3. View individual job results
4. Download artifacts for detailed reports

## Performance Thresholds

### API Endpoints

| Endpoint | p50 | p95 | p99 |
|----------|-----|-----|-----|
| Health | 10ms | 20ms | 50ms |
| Auth (Login) | 100ms | 200ms | 300ms |
| User Profile | 50ms | 100ms | 150ms |
| Companion List | 100ms | 200ms | 300ms |
| Session Create | 150ms | 300ms | 500ms |

### WebSocket

| Metric | Threshold |
|--------|-----------|
| Connection Time p95 | < 200ms |
| Message Round-Trip p95 | < 50ms |
| Throughput | > 1000 msg/s |

### Database

| Query Type | p95 | p99 |
|------------|-----|-----|
| Simple SELECT | 20ms | 50ms |
| Indexed Query | 30ms | 60ms |
| JOIN Query | 150ms | 300ms |
| INSERT | 50ms | 100ms |
| Transaction | 150ms | 300ms |

### Workers

| Metric | Threshold |
|--------|-----------|
| Job Processing p95 | < 300ms |
| Queue Throughput | > 100 jobs/s |
| Job Latency p95 | < 150ms |

### Memory

| Metric | Threshold |
|--------|-----------|
| Heap Growth per 1K ops | < 10MB |
| RSS Growth per 1K ops | < 20MB |
| Linear Growth R² | < 0.8 |

## Troubleshooting

### Tests Failing Due to Timeouts

**Cause**: Database or Redis not running or slow

**Solution**:
```bash
# Check services are running
docker ps

# Restart services
pnpm docker:down
pnpm docker:up

# Check connectivity
psql postgresql://postgres:postgres@localhost:5432/campfire_test
redis-cli -h localhost -p 6379 ping
```

### Memory Tests Show False Positives

**Cause**: Garbage collection not running

**Solution**:
```bash
# Always use --expose-gc for memory tests
NODE_OPTIONS=--expose-gc pnpm test tests/stability/memory-leak.test.ts
```

### Load Tests Failing

**Cause**: Application not started or wrong URL

**Solution**:
```bash
# Start the application first
pnpm --filter @campfire/gateway build
pnpm --filter @campfire/gateway start

# In another terminal, run load tests
k6 run --env BASE_URL=http://localhost:3000 packages/gateway/tests/load/k6-api-load.js
```

### Flaky WebSocket Tests

**Cause**: Port conflicts or connection limits

**Solution**:
```bash
# Check for port usage
lsof -i :3000

# Increase connection limits (macOS)
ulimit -n 10000
```

### Database Performance Degradation

**Cause**: Indexes not created or database needs vacuuming

**Solution**:
```bash
# Check indexes exist
psql -d campfire_test -c "\d perf_test_users"

# Vacuum database
psql -d campfire_test -c "VACUUM ANALYZE"
```

## Best Practices

### Writing Performance Tests

1. **Use consistent baselines**: Always warm up before measuring
2. **Measure multiple iterations**: Single measurements are unreliable
3. **Report percentiles**: Don't rely on averages alone
4. **Force GC for memory tests**: Use `--expose-gc` flag
5. **Set realistic thresholds**: Based on actual requirements
6. **Clean up resources**: Close connections, clear data

### Running in CI

1. **Use service containers**: Ensure consistent environment
2. **Set timeouts**: Prevent hung tests
3. **Upload artifacts**: Save detailed results
4. **Use concurrency**: Run independent tests in parallel
5. **Schedule regular runs**: Catch performance regressions early

### Monitoring Trends

1. **Track metrics over time**: Store results for comparison
2. **Set up alerts**: Notify on threshold violations
3. **Review regularly**: Weekly/monthly performance review
4. **Correlate with changes**: Link performance to code changes
5. **Benchmark before/after**: Major changes need benchmarking

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [k6 Documentation](https://k6.io/docs/)
- [BullMQ Performance Guide](https://docs.bullmq.io/guide/performance)
- [PostgreSQL Performance Tips](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [Node.js Performance Best Practices](https://nodejs.org/en/docs/guides/simple-profiling/)
