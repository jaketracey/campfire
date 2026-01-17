## Performance Optimization

<!-- Reference the issue number from PERFORMANCE_ANALYSIS.md -->
Fixes: Issue #[number] - [Brief description]

### Problem
<!-- Describe the performance bottleneck -->
- **Current Performance:** [e.g., p95 = 300ms]
- **Impact:** [e.g., Affects companion list endpoint used by 80% of users]
- **Root Cause:** [e.g., N+1 query pattern]

### Solution
<!-- Describe your optimization -->
- **Approach:** [e.g., Added database index + query batching]
- **Expected Improvement:** [e.g., 40-60% reduction in response time]
- **Implementation Details:**
  - [Detail 1]
  - [Detail 2]

### Performance Metrics

#### Before Optimization
```
Metric: [e.g., API response time]
p50: [e.g., 150ms]
p95: [e.g., 300ms]
p99: [e.g., 450ms]
Throughput: [e.g., 100 req/sec]
```

#### After Optimization
```
Metric: [e.g., API response time]
p50: [e.g., 80ms] (-47%)
p95: [e.g., 120ms] (-60%)
p99: [e.g., 180ms] (-60%)
Throughput: [e.g., 180 req/sec] (+80%)
```

#### Benchmark Results
```bash
# Command used to benchmark
ab -n 1000 -c 50 http://localhost:3002/api/v1/[endpoint]

# Or attach performance test output
pnpm test:performance -- [test-name]
```

### Testing

- [ ] Performance tests pass
  ```bash
  pnpm test:performance
  ```

- [ ] Functional tests pass (no regressions)
  ```bash
  pnpm test
  ```

- [ ] Load testing completed
  ```bash
  # Include results or screenshots
  ```

- [ ] Verified in staging environment
  - [ ] Response times improved as expected
  - [ ] No error rate increase
  - [ ] Memory usage stable

### Database Changes

<!-- If this PR includes database migrations -->

- [ ] Migration tested on copy of production data
- [ ] Index creation uses `CONCURRENTLY` (no table locks)
- [ ] Rollback plan documented

```sql
-- Migration up
[Paste SQL]

-- Migration down (rollback)
[Paste SQL]
```

### Caching Changes

<!-- If this PR includes caching -->

- [ ] Cache keys include version (e.g., `v1`, `v2`)
- [ ] Cache invalidation logic implemented
- [ ] TTL set appropriately
- [ ] Cache hit rate monitored

**Cache Strategy:**
- Key pattern: `[pattern]`
- TTL: `[duration]`
- Invalidation triggers: `[events]`

### Monitoring

<!-- How will we track this optimization in production? -->

- [ ] Metrics added to track improvement
  - Metric: `[metric name]`
  - Dashboard: `[link or description]`

- [ ] Alerts configured for regressions
  - Alert: `[alert name]`
  - Threshold: `[threshold]`

- [ ] OpenTelemetry spans added
  ```typescript
  // Example span
  withSpan('operation.name', async (span) => {
    span.setAttributes({ key: 'value' });
    // ...
  });
  ```

### Rollback Plan

<!-- How to quickly revert if issues occur -->

**If problems occur in production:**

1. **Immediate rollback:**
   ```bash
   # Commands to rollback
   [e.g., git revert, feature flag toggle, etc.]
   ```

2. **Database rollback (if applicable):**
   ```sql
   [Rollback SQL]
   ```

3. **Cache flush (if applicable):**
   ```bash
   redis-cli FLUSHDB
   ```

### Checklist

- [ ] Code follows performance best practices
- [ ] No new anti-patterns introduced
- [ ] Documentation updated
- [ ] Performance budget not exceeded
- [ ] Backward compatible (no breaking changes)
- [ ] Reviewed security implications
- [ ] Resource usage acceptable (CPU, memory, network)

### Related PRs

<!-- Link to related performance optimization PRs -->

- Part of Phase: [1/2/3/4]
- Depends on: #[PR number]
- Blocks: #[PR number]

### Screenshots / Evidence

<!-- Include benchmark results, profiler screenshots, etc. -->

**Before:**
[Screenshot or benchmark output]

**After:**
[Screenshot or benchmark output]

### Reviewer Notes

<!-- Specific areas to review -->

**Focus areas for review:**
- [ ] Performance impact validation
- [ ] Edge cases covered
- [ ] Monitoring adequacy
- [ ] Rollback safety

**Testing instructions:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

---

<!--
Performance optimization PR template
Based on PERFORMANCE_ANALYSIS.md and PERFORMANCE_QUICK_WINS.md
-->
