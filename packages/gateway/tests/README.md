# Test Suite Documentation

Comprehensive test suite for the Campfire Gateway service.

## Test Structure

```
tests/
├── performance/          # Performance benchmarks
│   ├── setup.ts         # Shared utilities
│   ├── api-latency.test.ts
│   ├── websocket.test.ts
│   └── database.test.ts
├── load/                # Load tests (k6)
│   ├── k6-api-load.js
│   └── k6-websocket-load.js
├── stability/           # Stability tests
│   ├── memory-leak.test.ts
│   └── recovery.test.ts
├── e2e/                 # End-to-end tests
│   └── conversation-flow.test.ts
├── integration/         # Integration tests
├── routes/              # Route unit tests
├── services/            # Service unit tests
├── middleware/          # Middleware tests
└── utils/               # Utility tests
```

## Running Tests

### All Tests
```bash
pnpm test
```

### Performance Tests
```bash
# All performance tests
pnpm test:performance

# Specific suites
pnpm test:performance:api    # API latency
pnpm test:performance:db     # Database
pnpm test:performance:ws     # WebSocket
```

### Load Tests
```bash
# Start application first
pnpm build && pnpm start

# Run load tests
pnpm test:load              # Default profile
pnpm test:load:quick        # 30s quick test
pnpm test:load:standard     # 2min standard test
pnpm test:load:stress       # 5min stress test
```

### Stability Tests
```bash
pnpm test:stability              # All stability tests
pnpm test:stability:memory       # Memory leak detection
pnpm test:stability:recovery     # Recovery tests
```

### E2E Tests
```bash
pnpm test:e2e
```

### Unit Tests
```bash
pnpm test:unit
```

### Watch Mode
```bash
pnpm test:watch
```

### Coverage
```bash
pnpm test:coverage
```

## Test Categories

### 1. Performance Tests

Measure system performance with precise metrics.

**Key Features**:
- Percentile analysis (p50, p95, p99)
- Throughput measurement
- Latency tracking
- Resource usage monitoring

**Metrics Collected**:
- Response times
- Request throughput
- Memory usage
- Database query performance
- WebSocket message rates

### 2. Load Tests

Simulate realistic user load patterns.

**Test Profiles**:
- **Quick**: 10 VUs for 30s (development)
- **Standard**: 50 VUs for 2min (CI/CD)
- **Stress**: 100 VUs for 5min (production validation)

**Scenarios Tested**:
- Authentication flows
- Session management
- Message posting
- Concurrent connections
- Mixed workloads

### 3. Stability Tests

Detect memory leaks and verify error recovery.

**Tests Include**:
- Long-running memory analysis
- Connection recovery
- Error handling
- Rate limiting
- Graceful degradation

### 4. E2E Tests

Complete user workflows with performance tracking.

**Flows Tested**:
- User registration
- Companion creation
- Session establishment
- Message exchange
- WebSocket conversations
- Group chats

## Test Utilities

### Performance Helpers

Located in `tests/performance/setup.ts`:

```typescript
// Measure execution time
const { duration, result } = await measure(async () => {
  return await someOperation();
});

// Run benchmark iterations
const { durations } = await runBenchmark(
  async () => await operation(),
  100 // iterations
);

// Calculate metrics
const metrics = calculateMetrics(durations);
console.log(`p95: ${metrics.p95}ms`);

// Assert thresholds
assertPerformance(metrics, { p95: 200, p99: 500 });

// Memory tracking
const snapshot = takeMemorySnapshot();
// ... run operations ...
const growth = calculateMemoryGrowth(initial, final);
```

### Concurrent Testing

```typescript
// Run concurrent requests
const { durations, errors } = await runConcurrent(
  async () => await request(),
  10,   // concurrency
  100   // total requests
);

const loadMetrics = calculateLoadMetrics(
  durations,
  errors,
  totalDuration
);
```

## Performance Thresholds

### API Endpoints

| Endpoint | p50 | p95 | p99 |
|----------|-----|-----|-----|
| /health | 10ms | 20ms | 50ms |
| /api/auth/login | 100ms | 200ms | 300ms |
| /api/users/me | 50ms | 100ms | 150ms |
| /api/companions | 100ms | 200ms | 300ms |
| /api/sessions | 150ms | 300ms | 500ms |

### Database Queries

| Type | p95 | p99 |
|------|-----|-----|
| Simple SELECT | 20ms | 50ms |
| Indexed Query | 30ms | 60ms |
| JOIN Query | 150ms | 300ms |
| INSERT | 50ms | 100ms |
| Transaction | 150ms | 300ms |

### WebSocket

| Metric | Threshold |
|--------|-----------|
| Connection p95 | < 200ms |
| Message Round-Trip p95 | < 50ms |
| Throughput | > 1000 msg/s |

## Writing New Tests

### Performance Test Template

```typescript
import { describe, it, expect } from 'vitest';
import { runBenchmark, calculateMetrics, formatDuration } from '../performance/setup';

describe('Feature Performance', () => {
  it('should meet performance requirements', async () => {
    const { durations } = await runBenchmark(
      async () => {
        // Your operation here
        return await performOperation();
      },
      100 // iterations
    );

    const metrics = calculateMetrics(durations);
    
    console.log(`Performance:`);
    console.log(`  p50: ${formatDuration(metrics.p50)}`);
    console.log(`  p95: ${formatDuration(metrics.p95)}`);
    console.log(`  p99: ${formatDuration(metrics.p99)}`);

    expect(metrics.p95).toBeLessThan(100);
    expect(metrics.p99).toBeLessThan(200);
  });
});
```

### Load Test Template (k6)

```javascript
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const myMetric = new Trend('my_metric');

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    'http_req_duration': ['p(95)<200'],
    'my_metric': ['p(95)<100'],
  },
};

export default function() {
  const start = Date.now();
  
  const res = http.get('http://localhost:3000/api/endpoint');
  
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  
  myMetric.add(Date.now() - start);
}
```

## CI/CD Integration

Tests run automatically via GitHub Actions:

- **Trigger**: PRs, pushes to main, nightly schedule
- **Jobs**: API, WebSocket, DB, Workers, Load, Stability, E2E
- **Artifacts**: Test results saved for 30 days
- **Reports**: Summary posted to PR

See `.github/workflows/performance-tests.yml`

## Debugging Tests

### Enable Verbose Logging

```bash
DEBUG=* pnpm test
```

### Run Single Test

```bash
pnpm test -t "test name pattern"
```

### Keep Test Server Running

```typescript
// In test file
afterAll(async () => {
  // Comment out to keep server running
  // await app.close();
});
```

### View Database Queries

```bash
# Enable query logging in postgres
export PGSQL_LOG_QUERIES=true
pnpm test
```

## Best Practices

1. **Warm Up**: Run operations before measuring to warm up JIT
2. **Multiple Iterations**: Use 50-100 iterations for stable metrics
3. **Isolate Tests**: Don't share state between tests
4. **Clean Up**: Always close connections and clear data
5. **Realistic Data**: Use production-like data sizes
6. **Measure What Matters**: Focus on user-facing metrics
7. **Set Realistic Thresholds**: Based on actual requirements
8. **Monitor Trends**: Track performance over time

## Troubleshooting

### Tests Timeout

- Check database/Redis are running
- Increase test timeout: `it('test', async () => {...}, 60000)`
- Check for connection leaks

### Inconsistent Results

- Force garbage collection: `NODE_OPTIONS=--expose-gc`
- Increase iterations for more stable results
- Check system load during tests

### Memory Tests Fail

- Always use `--expose-gc` flag
- Wait for GC between snapshots
- Check for actual leaks vs normal usage patterns

## Resources

- [Full Testing Guide](../../docs/PERFORMANCE_TESTING.md)
- [Quick Start](../../docs/PERFORMANCE_QUICK_START.md)
- [Vitest Docs](https://vitest.dev/)
- [k6 Docs](https://k6.io/docs/)
