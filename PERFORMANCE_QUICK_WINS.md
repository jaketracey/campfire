# Performance Quick Wins - Implementation Guide

**Target:** 20-30% performance improvement in 1-2 days
**Effort:** Low to Medium
**Risk:** Low

---

## Quick Win #1: Add Database Indexes (30 min)

**Impact:** 40-60% faster companion list queries

```sql
-- Run these migrations in packages/gateway/src/db/migrations/

-- Companion image lookups (used on every companion list)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companion_images_user_companion_created
ON companion_images (user_id, companion_id, created_at DESC);

-- Session lookups for "latest session per companion"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_companion_activity
ON sessions (user_id, companion_id, last_activity_at DESC)
WHERE status IN ('active', 'paused');

-- Gift queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gifts_user_status_created
ON gifts (user_id, status, created_at DESC);

-- Token transaction history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_token_transactions_user_created
ON token_transactions (user_id, created_at DESC);
```

**Validation:**
```bash
# Before indexes
EXPLAIN ANALYZE SELECT * FROM companion_images WHERE user_id = '...' AND companion_id = '...';
# Should show "Seq Scan"

# After indexes
EXPLAIN ANALYZE SELECT * FROM companion_images WHERE user_id = '...' AND companion_id = '...';
# Should show "Index Scan using idx_companion_images_user_companion_created"
```

---

## Quick Win #2: Add Redis Caching for Static Data (1 hour)

**Impact:** 50-70% faster token bundle endpoint

**File:** `packages/gateway/src/routes/gifts.ts`

```typescript
import { getRedis } from '../db/redis'; // TODO: Create this helper

const CACHE_TTL = {
  TOKEN_BUNDLES: 300,      // 5 minutes - bundles rarely change
  GIFT_TEMPLATES: 600,      // 10 minutes - templates updated infrequently
  COMPANION_DEFAULTS: 3600, // 1 hour - default companion data
};

// Before:
app.get('/tokens/bundles', { preHandler: requireAuth }, async (request, reply) => {
  const bundles = await giftsRepo.listActiveBundles();
  return reply.send({ success: true, data: bundles.map(/* ... */) });
});

// After:
app.get('/tokens/bundles', { preHandler: requireAuth }, async (request, reply) => {
  const redis = getRedis();
  const cacheKey = 'token_bundles:active:v1'; // v1 for cache versioning

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return reply.send({ success: true, data: JSON.parse(cached) });
  }

  // Cache miss - fetch from DB
  const bundles = await giftsRepo.listActiveBundles();
  const mapped = bundles.map(bundle => ({
    id: bundle.id,
    name: bundle.name,
    tokens: bundle.tokens,
    priceCents: bundle.price_cents,
    // ... other fields
  }));

  // Cache for 5 minutes
  await redis.setex(cacheKey, CACHE_TTL.TOKEN_BUNDLES, JSON.stringify(mapped));

  return reply.send({ success: true, data: mapped });
});
```

**Cache Invalidation:**
```typescript
// When bundles are updated (admin panel)
async function updateTokenBundle(id: string, updates: Partial<TokenBundle>) {
  await bundlesRepo.update(id, updates);

  // Invalidate cache
  const redis = getRedis();
  await redis.del('token_bundles:active:v1');

  logger.info({ bundleId: id }, 'Token bundle cache invalidated');
}
```

**Validation:**
```bash
# Monitor cache hit rate
redis-cli INFO stats | grep keyspace_hits
redis-cli INFO stats | grep keyspace_misses

# Should see >90% hit rate after warmup
```

---

## Quick Win #3: Optimize Worker Concurrency (15 min)

**Impact:** 2-4x throughput on multi-core systems

**File:** `packages/workers/src/index.ts`

```typescript
import os from 'os';

const CPU_CORES = os.cpus().length;

// Before:
const imageRenditionWorker = new ImageRenditionWorker({
  concurrency: 2, // Fixed concurrency
});

// After:
const IMAGE_CONCURRENCY = Math.max(2, Math.floor(CPU_CORES * 0.5));
const VIDEO_CONCURRENCY = Math.max(1, Math.floor(CPU_CORES * 0.25));

const imageRenditionWorker = new ImageRenditionWorker({
  concurrency: IMAGE_CONCURRENCY,
});

const videoGenerationWorker = new VideoGenerationWorker({
  concurrency: VIDEO_CONCURRENCY,
});

logger.info({
  cpuCores: CPU_CORES,
  imageConcurrency: IMAGE_CONCURRENCY,
  videoConcurrency: VIDEO_CONCURRENCY,
}, 'Worker concurrency auto-configured');
```

**Validation:**
```bash
# Check worker utilization
redis-cli LLEN bull:image-renditions:active
# Should see multiple jobs processing simultaneously

# Monitor CPU usage
top -l 1 | grep "CPU usage"
# Should see higher CPU utilization (50-70% vs 25%)
```

---

## Quick Win #4: Fix Custom JSON Parser (30 min)

**Impact:** 15-20% reduction in API latency for all JSON requests

**File:** `packages/gateway/src/index.ts`

```typescript
// REMOVE this global parser:
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  (req as unknown as { rawBody: string }).rawBody = body as string;
  try {
    const json = JSON.parse(body as string);
    done(null, json);
  } catch (err) {
    done(err as Error, undefined);
  }
});

// ADD route-specific parser for webhooks only:
import type { RouteOptions } from 'fastify';

const webhookRouteOptions: RouteOptions = {
  bodyLimit: 1048576, // 1MB
  preParsing: async (request, reply, payload) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    (request as any).rawBody = buffer.toString('utf8');
    return buffer; // Return for Fastify to parse
  },
};

// Apply only to webhook routes:
app.post('/api/v1/webhooks/flowguard', webhookRouteOptions, async (request, reply) => {
  const rawBody = (request as any).rawBody;
  // Verify signature using rawBody
  // ...
});

app.post('/api/v1/webhooks/stripe', webhookRouteOptions, async (request, reply) => {
  const rawBody = (request as any).rawBody;
  // ...
});
```

**Validation:**
```bash
# Benchmark before
ab -n 1000 -c 10 -p payload.json -T application/json http://localhost:3002/api/v1/sessions
# Note: requests per second

# Benchmark after
ab -n 1000 -c 10 -p payload.json -T application/json http://localhost:3002/api/v1/sessions
# Should see 15-20% increase in req/sec
```

---

## Monitoring Setup

Add these to track improvements:

### 1. Database Query Monitoring

```typescript
// packages/gateway/src/db/pool.ts
import { logger } from '../observability/logger';

const SLOW_QUERY_THRESHOLD_MS = 100;

export const sql = postgres(DATABASE_URL, {
  onnotice: () => {},
  transform: {
    undefined: null,
  },
  debug: (connection, query, params, types) => {
    const duration = performance.now() - query.startTime;

    if (duration > SLOW_QUERY_THRESHOLD_MS) {
      logger.warn({
        query: query.string,
        duration: `${duration.toFixed(2)}ms`,
        threshold: `${SLOW_QUERY_THRESHOLD_MS}ms`,
      }, 'Slow query detected');
    }
  },
});
```

### 2. Cache Hit Rate Tracking

```typescript
// packages/gateway/src/middleware/cache-stats.ts
import { getRedis } from '../db/redis';

export async function getCacheStats() {
  const redis = getRedis();
  const info = await redis.info('stats');

  const hits = parseInt(info.match(/keyspace_hits:(\d+)/)?.[1] || '0');
  const misses = parseInt(info.match(/keyspace_misses:(\d+)/)?.[1] || '0');

  return {
    hits,
    misses,
    hitRate: hits / (hits + misses),
  };
}

// Add to admin dashboard or metrics endpoint
app.get('/api/v1/admin/cache-stats', async (request, reply) => {
  const stats = await getCacheStats();
  return reply.send({ stats });
});
```

### 3. Response Time Tracking

```typescript
// packages/gateway/src/index.ts (already has this in onResponse hook)
app.addHook('onResponse', async (request, reply) => {
  const duration = reply.elapsedTime;

  // Track slow responses
  if (duration > 1000) {
    logger.warn({
      method: request.method,
      url: request.url,
      duration: `${duration.toFixed(2)}ms`,
    }, 'Slow response detected');
  }

  logger.info({
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    responseTime: duration,
  }, 'Request completed');
});
```

---

## Testing the Improvements

### 1. Run Performance Tests

```bash
# Gateway API tests
cd packages/gateway
pnpm test:performance

# Worker tests
cd packages/workers
pnpm test:performance
```

### 2. Load Testing

```bash
# Install Apache Bench or use existing tools
brew install ab  # macOS

# Test endpoint before optimization
ab -n 1000 -c 50 http://localhost:3002/api/v1/companions

# Apply optimizations

# Test again and compare
ab -n 1000 -c 50 http://localhost:3002/api/v1/companions

# Look for:
# - Requests per second (should increase 20-30%)
# - Time per request (should decrease 20-30%)
# - Failed requests (should remain 0)
```

### 3. Validate with Real Traffic

```bash
# Monitor logs for performance metrics
cd packages/gateway
pnpm dev | grep "Request completed"

# Should see response times improve:
# Before: p95 = 150ms
# After:  p95 = 100-120ms
```

---

## Rollback Plan

If issues occur, here's how to rollback each change:

### Database Indexes
```sql
-- Remove indexes if they cause issues
DROP INDEX CONCURRENTLY idx_companion_images_user_companion_created;
DROP INDEX CONCURRENTLY idx_sessions_user_companion_activity;
-- etc.
```

### Redis Caching
```typescript
// Simply remove cache read/write code
// Endpoints will work without cache (just slower)

// Or disable cache temporarily
const CACHE_ENABLED = false;

if (CACHE_ENABLED) {
  const cached = await redis.get(cacheKey);
  // ...
}
```

### Worker Concurrency
```typescript
// Revert to fixed concurrency
const imageRenditionWorker = new ImageRenditionWorker({
  concurrency: 2, // Back to original
});
```

### JSON Parser
```typescript
// If webhook verification breaks, revert to global parser
// (but this is unlikely - route-specific parser is safer)
```

---

## Success Metrics

Track these metrics to validate improvements:

| Metric | Before | Target | How to Measure |
|--------|--------|--------|----------------|
| Companion List p95 | 300ms | <200ms | `ab` benchmark or OpenTelemetry |
| Token Bundles p95 | 80ms | <30ms | `ab` benchmark (cached) |
| Image Processing p95 | 1200ms | <500ms | Worker job metrics |
| Cache Hit Rate | 0% | >80% | Redis INFO stats |
| API Throughput | baseline | +20-30% | `ab` requests/sec |

---

## Next Steps

After implementing quick wins:

1. Run performance tests to validate improvements
2. Monitor production metrics for 24-48 hours
3. If stable, move to **Phase 2** optimizations (see PERFORMANCE_ANALYSIS.md)
4. Document actual performance improvements for future reference

---

## Support

Questions or issues?
- Review full analysis: `PERFORMANCE_ANALYSIS.md`
- Check test suite: `packages/gateway/src/__tests__/performance/`
- Review OpenTelemetry traces for bottlenecks
