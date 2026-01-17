/**
 * Database Performance Tests
 * 
 * Measures database query performance and connection pool behavior
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import {
  runBenchmark,
  runConcurrent,
  calculateMetrics,
  calculateLoadMetrics,
  formatDuration,
  sleep,
  type PerformanceMetrics,
} from './setup';

// Performance thresholds in milliseconds
const THRESHOLDS = {
  simpleSelect: { p50: 5, p95: 20, p99: 50 },
  indexedQuery: { p50: 10, p95: 30, p99: 60 },
  joinQuery: { p50: 50, p95: 150, p99: 300 },
  insert: { p50: 20, p95: 50, p99: 100 },
  update: { p50: 20, p95: 50, p99: 100 },
  transaction: { p50: 50, p95: 150, p99: 300 },
} as const;

describe('Database Performance Tests', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    // Initialize database connection
    sql = postgres(process.env.DATABASE_URL || 'postgres://localhost:5432/campfire_test', {
      max: 20, // Connection pool size
      idle_timeout: 20,
      connect_timeout: 10,
    });

    // Create test table
    await sql`
      CREATE TABLE IF NOT EXISTS perf_test_users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_perf_test_users_email ON perf_test_users(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_perf_test_users_created_at ON perf_test_users(created_at)`;

    // Create related table for join tests
    await sql`
      CREATE TABLE IF NOT EXISTS perf_test_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES perf_test_users(id),
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_perf_test_sessions_user_id ON perf_test_sessions(user_id)`;

    // Seed initial data
    for (let i = 0; i < 1000; i++) {
      await sql`
        INSERT INTO perf_test_users (email, name)
        VALUES (${`user-${i}@example.com`}, ${`User ${i}`})
        ON CONFLICT (email) DO NOTHING
      `;
    }
  });

  afterAll(async () => {
    // Clean up
    await sql`DROP TABLE IF EXISTS perf_test_sessions CASCADE`;
    await sql`DROP TABLE IF NOT EXISTS perf_test_users CASCADE`;
    await sql.end();
  });

  it('should measure simple SELECT query performance', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const result = await sql`SELECT * FROM perf_test_users LIMIT 10`;
        expect(result.length).toBe(10);
        return result;
      },
      100
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Simple SELECT (LIMIT 10)', metrics);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.simpleSelect.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.simpleSelect.p99);
  });

  it('should measure indexed query performance', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const result = await sql`
          SELECT * FROM perf_test_users 
          WHERE email = ${`user-500@example.com`}
        `;
        expect(result.length).toBeGreaterThanOrEqual(0);
        return result;
      },
      100
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Indexed Query (WHERE email = ?)', metrics);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.indexedQuery.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.indexedQuery.p99);
  });

  it('should measure JOIN query performance', async () => {
    // Create some session data
    await sql`
      INSERT INTO perf_test_sessions (user_id, token)
      SELECT id, 'token-' || id::TEXT
      FROM perf_test_users
      LIMIT 100
      ON CONFLICT DO NOTHING
    `;

    const { durations } = await runBenchmark(
      async () => {
        const result = await sql`
          SELECT u.*, s.token, s.created_at as session_created
          FROM perf_test_users u
          LEFT JOIN perf_test_sessions s ON u.id = s.user_id
          WHERE u.created_at > NOW() - INTERVAL '7 days'
          LIMIT 50
        `;
        expect(result.length).toBeGreaterThanOrEqual(0);
        return result;
      },
      50
    );

    const metrics = calculateMetrics(durations);
    logMetrics('JOIN Query (users + sessions)', metrics);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.joinQuery.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.joinQuery.p99);
  });

  it('should measure INSERT performance', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const email = `insert-test-${Date.now()}-${Math.random()}@example.com`;
        const result = await sql`
          INSERT INTO perf_test_users (email, name)
          VALUES (${email}, ${'Insert Test User'})
          RETURNING id
        `;
        expect(result.length).toBe(1);
        return result;
      },
      50
    );

    const metrics = calculateMetrics(durations);
    logMetrics('INSERT Query', metrics);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.insert.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.insert.p99);
  });

  it('should measure UPDATE performance', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const result = await sql`
          UPDATE perf_test_users
          SET updated_at = NOW(), name = ${'Updated Name'}
          WHERE id = ${Math.floor(Math.random() * 1000) + 1}
          RETURNING id
        `;
        return result;
      },
      100
    );

    const metrics = calculateMetrics(durations);
    logMetrics('UPDATE Query', metrics);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.update.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.update.p99);
  });

  it('should measure transaction performance', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const email = `tx-test-${Date.now()}-${Math.random()}@example.com`;
        
        const result = await sql.begin(async (sql) => {
          const [user] = await sql`
            INSERT INTO perf_test_users (email, name)
            VALUES (${email}, ${'Transaction Test User'})
            RETURNING id
          `;

          await sql`
            INSERT INTO perf_test_sessions (user_id, token)
            VALUES (${user.id}, ${'token-' + user.id})
          `;

          return user;
        });

        expect(result).toBeDefined();
        return result;
      },
      50
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Transaction (INSERT user + session)', metrics);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.transaction.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.transaction.p99);
  });

  it('should measure concurrent query performance', async () => {
    const startTime = performance.now();
    
    const { durations, errors } = await runConcurrent(
      async () => {
        const result = await sql`
          SELECT * FROM perf_test_users 
          WHERE id = ${Math.floor(Math.random() * 1000) + 1}
        `;
        return result;
      },
      10, // 10 concurrent
      100 // 100 total requests
    );

    const totalDuration = performance.now() - startTime;
    const loadMetrics = calculateLoadMetrics(durations, errors, totalDuration);

    console.log('\nConcurrent Query Performance:');
    console.log(`  Throughput: ${loadMetrics.throughput.toFixed(2)} req/s`);
    console.log(`  Error Rate: ${loadMetrics.errorRate.toFixed(2)}%`);
    console.log(`  p50: ${formatDuration(loadMetrics.p50)}`);
    console.log(`  p95: ${formatDuration(loadMetrics.p95)}`);
    console.log(`  p99: ${formatDuration(loadMetrics.p99)}`);

    expect(loadMetrics.errorRate).toBeLessThan(1); // Less than 1% errors
    expect(loadMetrics.p95).toBeLessThan(100); // p95 under 100ms
  });

  it('should measure connection pool behavior', async () => {
    const poolSize = 20;
    const requestsPerConnection = 5;
    const totalRequests = poolSize * requestsPerConnection;

    const startTime = performance.now();

    const { durations, errors } = await runConcurrent(
      async () => {
        const result = await sql`SELECT COUNT(*) as count FROM perf_test_users`;
        return result;
      },
      poolSize, // Max out the pool
      totalRequests
    );

    const totalDuration = performance.now() - startTime;
    const loadMetrics = calculateLoadMetrics(durations, errors, totalDuration);

    console.log('\nConnection Pool Performance:');
    console.log(`  Pool Size: ${poolSize}`);
    console.log(`  Total Requests: ${totalRequests}`);
    console.log(`  Throughput: ${loadMetrics.throughput.toFixed(2)} req/s`);
    console.log(`  Error Rate: ${loadMetrics.errorRate.toFixed(2)}%`);
    console.log(`  p50: ${formatDuration(loadMetrics.p50)}`);
    console.log(`  p95: ${formatDuration(loadMetrics.p95)}`);

    expect(loadMetrics.errorRate).toBeLessThan(1);
    expect(loadMetrics.successCount).toBe(totalRequests);
  });

  it('should measure bulk insert performance', async () => {
    const batchSize = 100;
    const durations: number[] = [];

    for (let batch = 0; batch < 5; batch++) {
      const start = performance.now();

      const values = Array.from({ length: batchSize }, (_, i) => ({
        email: `bulk-${batch}-${i}-${Date.now()}@example.com`,
        name: `Bulk User ${batch}-${i}`,
      }));

      await sql`
        INSERT INTO perf_test_users ${sql(values, 'email', 'name')}
        ON CONFLICT (email) DO NOTHING
      `;

      const duration = performance.now() - start;
      durations.push(duration);
    }

    const metrics = calculateMetrics(durations);
    const recordsPerSecond = (batchSize / (metrics.mean / 1000));

    console.log('\nBulk Insert Performance:');
    console.log(`  Batch Size: ${batchSize}`);
    console.log(`  Mean Duration: ${formatDuration(metrics.mean)}`);
    console.log(`  Records/Second: ${recordsPerSecond.toFixed(2)}`);

    expect(metrics.mean).toBeLessThan(1000); // Less than 1 second per batch
  });

  it('should measure query plan performance', async () => {
    // Test that indexes are being used
    const explainResult = await sql`
      EXPLAIN (FORMAT JSON)
      SELECT * FROM perf_test_users WHERE email = 'user-500@example.com'
    `;

    const plan = explainResult[0]['QUERY PLAN'][0];
    
    console.log('\nQuery Plan Analysis:');
    console.log(`  Node Type: ${plan.Plan['Node Type']}`);
    console.log(`  Relation: ${plan.Plan['Relation Name'] || 'N/A'}`);
    console.log(`  Index Name: ${plan.Plan['Index Name'] || 'N/A'}`);

    // Should use index scan, not sequential scan
    expect(plan.Plan['Node Type']).not.toBe('Seq Scan');
  });
});

function logMetrics(label: string, metrics: PerformanceMetrics): void {
  console.log(`\n${label}:`);
  console.log(`  p50: ${formatDuration(metrics.p50)}`);
  console.log(`  p95: ${formatDuration(metrics.p95)}`);
  console.log(`  p99: ${formatDuration(metrics.p99)}`);
  console.log(`  mean: ${formatDuration(metrics.mean)}`);
  console.log(`  min: ${formatDuration(metrics.min)}`);
  console.log(`  max: ${formatDuration(metrics.max)}`);
  console.log(`  count: ${metrics.count}`);
}
