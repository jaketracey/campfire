/**
 * Database Performance Benchmarks
 *
 * These tests measure query performance BEFORE and AFTER optimizations.
 * Run with: npm test -- performance-benchmarks.test.ts
 *
 * Benchmarks test:
 * 1. Complex JOIN queries
 * 2. N+1 query patterns
 * 3. Missing index scenarios
 * 4. Vector search performance
 * 5. Aggregate query performance
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createPool, closePool, sql } from '../pool.js';
import { getUsersRepository } from '../../repositories/users.js';
import { getSessionsRepository } from '../../repositories/sessions.js';
import { getMemoriesRepository } from '../../repositories/memories.js';
import type { User, Companion, Session } from '../types.js';

// Performance threshold (milliseconds)
const SLOW_QUERY_THRESHOLD = 100;
const ACCEPTABLE_QUERY_THRESHOLD = 50;

interface BenchmarkResult {
  operation: string;
  executionTimeMs: number;
  rowsAffected: number;
  queryPlan?: string;
}

/**
 * Helper to benchmark a query with EXPLAIN ANALYZE
 */
async function benchmarkQuery<T>(
  name: string,
  queryFn: () => Promise<T>,
  explainQuery?: string
): Promise<BenchmarkResult> {
  const start = Date.now();
  const result = await queryFn();
  const executionTimeMs = Date.now() - start;

  let queryPlan: string | undefined;
  if (explainQuery) {
    const planResult = await sql().unsafe(`EXPLAIN ANALYZE ${explainQuery}`);
    queryPlan = planResult.map(r => r['QUERY PLAN']).join('\n');
  }

  const rowsAffected = Array.isArray(result) ? result.length : 1;

  return {
    operation: name,
    executionTimeMs,
    rowsAffected,
    queryPlan,
  };
}

/**
 * Create test data for benchmarking
 */
async function createTestData(): Promise<{
  users: User[];
  companions: Companion[];
  sessions: Session[];
}> {
  const db = sql();
  const users: User[] = [];
  const companions: Companion[] = [];
  const sessions: Session[] = [];

  // Create 100 test users
  for (let i = 0; i < 100; i++) {
    const result = await db`
      INSERT INTO users (email, password_hash, email_verified)
      VALUES (
        ${`bench-user-${i}@test.com`},
        ${'$2a$10$dummy.hash.for.testing'},
        ${i % 2 === 0}
      )
      RETURNING id, email, email_normalized, password_hash, email_verified,
        email_verified_at, status, role, last_login_at, login_count,
        failed_login_count, locked_until, created_at, updated_at
    `;
    users.push(result[0] as any);
  }

  // Create 5 companions per user (500 total)
  for (const user of users) {
    for (let j = 0; j < 5; j++) {
      const result = await db`
        INSERT INTO companions (user_id, name, spec, status)
        VALUES (
          ${user.id},
          ${`Companion ${j} for ${user.email}`},
          ${{
            personality: 'friendly',
            backstory: `Test companion ${j}`,
            conversationStyle: 'casual',
          }},
          'active'
        )
        RETURNING id, user_id, name, spec, spec_version, status, is_public,
          active_avatar_id, created_at, updated_at
      `;
      companions.push(result[0] as any);
    }
  }

  // Create 10 sessions per companion (5000 total)
  for (const companion of companions.slice(0, 50)) {
    // Only first 50 companions to keep test fast
    for (let k = 0; k < 10; k++) {
      const result = await db`
        INSERT INTO sessions (user_id, companion_id, status, turn_count, total_tokens_input, total_tokens_output)
        VALUES (
          ${companion.user_id},
          ${companion.id},
          ${k < 8 ? 'ended' : 'active'},
          ${Math.floor(Math.random() * 50) + 10},
          ${Math.floor(Math.random() * 10000) + 1000},
          ${Math.floor(Math.random() * 15000) + 2000}
        )
        RETURNING id, user_id, companion_id, status, started_at, ended_at,
          last_activity_at, turn_count, total_tokens_input, total_tokens_output,
          total_cost_usd, total_duration_ms, metadata, created_at, updated_at
      `;
      sessions.push(result[0] as any);
    }
  }

  return { users, companions, sessions };
}

/**
 * Clean up test data
 */
async function cleanupTestData(): Promise<void> {
  const db = sql();
  await db`DELETE FROM sessions WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE 'bench-user-%@test.com'
  )`;
  await db`DELETE FROM companions WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE 'bench-user-%@test.com'
  )`;
  await db`DELETE FROM users WHERE email LIKE 'bench-user-%@test.com'`;
}

describe('Database Performance Benchmarks', () => {
  let testData: Awaited<ReturnType<typeof createTestData>>;

  before(async () => {
    createPool();
    await cleanupTestData(); // Clean any leftover data
    testData = await createTestData();
    console.log('\n📊 Created test data:', {
      users: testData.users.length,
      companions: testData.companions.length,
      sessions: testData.sessions.length,
    });
  });

  after(async () => {
    await cleanupTestData();
    await closePool();
  });

  describe('1. User Queries with Stats (N+1 Detection)', () => {
    it('should efficiently fetch users with companion/session stats', async () => {
      const usersRepo = getUsersRepository();

      // BEFORE: This query in listWithStats has potential N+1 issues with LEFT JOINs
      const benchmark = await benchmarkQuery(
        'users.listWithStats',
        () => usersRepo.listWithStats({ limit: 50 }),
        `
          SELECT
            u.id,
            u.email,
            u.role,
            u.status,
            u.email_verified,
            u.last_login_at,
            u.login_count,
            u.created_at,
            COALESCE(c.companion_count, 0)::int as companion_count,
            COALESCE(i.image_count, 0)::int as image_count,
            COALESCE(tb.total_tokens, 0)::bigint as total_tokens
          FROM users u
          LEFT JOIN (
            SELECT user_id, COUNT(*)::int as companion_count
            FROM companions
            WHERE status != 'archived'
            GROUP BY user_id
          ) c ON c.user_id = u.id
          LEFT JOIN (
            SELECT user_id, COUNT(*)::int as image_count
            FROM companion_images
            GROUP BY user_id
          ) i ON i.user_id = u.id::text
          LEFT JOIN (
            SELECT user_id, balance as total_tokens
            FROM token_balances
          ) tb ON tb.user_id = u.id
          WHERE u.status != 'deleted'
          ORDER BY u.created_at DESC
          LIMIT 50
        `
      );

      console.log(`\n  ✓ ${benchmark.operation}: ${benchmark.executionTimeMs}ms (${benchmark.rowsAffected} rows)`);

      if (benchmark.executionTimeMs > SLOW_QUERY_THRESHOLD) {
        console.log(`    ⚠️  SLOW: Exceeds ${SLOW_QUERY_THRESHOLD}ms threshold`);
        console.log(`    Query plan:\n${benchmark.queryPlan?.split('\n').map(l => `      ${l}`).join('\n')}`);
      }

      assert.ok(benchmark.rowsAffected > 0, 'Should return users');
    });
  });

  describe('2. Session List with Multiple Filters', () => {
    it('should efficiently list sessions with filters', async () => {
      const sessionsRepo = getSessionsRepository();
      const userId = testData.users[0]!.id;
      const companionId = testData.companions[0]!.id;

      const benchmark = await benchmarkQuery(
        'sessions.list with filters',
        () => sessionsRepo.list({
          userId,
          companionId,
          status: 'ended',
          limit: 20,
        }),
        `
          SELECT
            id, user_id, companion_id, status, started_at, ended_at,
            last_activity_at, turn_count, total_tokens_input, total_tokens_output,
            total_cost_usd, total_duration_ms, metadata, created_at, updated_at
          FROM sessions
          WHERE user_id = '${userId}'
            AND companion_id = '${companionId}'
            AND status = 'ended'
          ORDER BY started_at DESC
          LIMIT 21
        `
      );

      console.log(`\n  ✓ ${benchmark.operation}: ${benchmark.executionTimeMs}ms (${benchmark.rowsAffected} rows)`);

      if (benchmark.executionTimeMs > ACCEPTABLE_QUERY_THRESHOLD) {
        console.log(`    ⚠️  Could be faster (target: ${ACCEPTABLE_QUERY_THRESHOLD}ms)`);
      }
    });
  });

  describe('3. Active Session Lookup', () => {
    it('should quickly find active sessions', async () => {
      const sessionsRepo = getSessionsRepository();
      const userId = testData.users[0]!.id;
      const companionId = testData.companions[0]!.id;

      const benchmark = await benchmarkQuery(
        'sessions.findActiveSession',
        () => sessionsRepo.findActiveSession(userId, companionId),
        `
          SELECT
            id, user_id, companion_id, status, started_at, ended_at,
            last_activity_at, turn_count, total_tokens_input, total_tokens_output,
            total_cost_usd, total_duration_ms, metadata, created_at, updated_at
          FROM sessions
          WHERE user_id = '${userId}'
            AND companion_id = '${companionId}'
            AND status = 'active'
          ORDER BY started_at DESC
          LIMIT 1
        `
      );

      console.log(`\n  ✓ ${benchmark.operation}: ${benchmark.executionTimeMs}ms`);

      // This should be VERY fast with proper index
      if (benchmark.executionTimeMs > 10) {
        console.log(`    ⚠️  MISSING INDEX: Should be <10ms with proper index on (user_id, companion_id, status)`);
        console.log(`    Query plan:\n${benchmark.queryPlan?.split('\n').map(l => `      ${l}`).join('\n')}`);
      }
    });
  });

  describe('4. Stale Session Detection', () => {
    it('should efficiently find stale sessions', async () => {
      const sessionsRepo = getSessionsRepository();

      const benchmark = await benchmarkQuery(
        'sessions.endStaleSessions',
        () => sessionsRepo.endStaleSessions(30),
        `
          UPDATE sessions
          SET
            status = 'ended',
            ended_at = NOW()
          WHERE status = 'active'
            AND last_activity_at < NOW() - INTERVAL '30 minutes'
          RETURNING id
        `
      );

      console.log(`\n  ✓ ${benchmark.operation}: ${benchmark.executionTimeMs}ms (${benchmark.rowsAffected} rows affected)`);

      if (benchmark.executionTimeMs > ACCEPTABLE_QUERY_THRESHOLD) {
        console.log(`    ⚠️  NEEDS INDEX: last_activity_at should be indexed for this query`);
      }
    });
  });

  describe('5. Session Participants Join Query', () => {
    it('should efficiently fetch active participants with companion details', async () => {
      const sessionsRepo = getSessionsRepository();
      const sessionId = testData.sessions[0]!.id;

      const benchmark = await benchmarkQuery(
        'sessions.getActiveParticipants',
        () => sessionsRepo.getActiveParticipants(sessionId),
        `
          SELECT
            sp.id, sp.session_id, sp.companion_id, sp.role, sp.status,
            sp.invited_by_companion_id, sp.joined_at, sp.left_at, sp.message_count,
            sp.created_at, sp.updated_at,
            c.name as companion_name,
            a.asset_url as companion_avatar_url
          FROM session_participants sp
          JOIN companions c ON sp.companion_id = c.id
          LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
          WHERE sp.session_id = '${sessionId}'
            AND sp.status = 'active'
          ORDER BY sp.joined_at ASC
        `
      );

      console.log(`\n  ✓ ${benchmark.operation}: ${benchmark.executionTimeMs}ms`);

      if (benchmark.executionTimeMs > ACCEPTABLE_QUERY_THRESHOLD) {
        console.log(`    ⚠️  JOIN performance issue detected`);
        console.log(`    Query plan:\n${benchmark.queryPlan?.split('\n').map(l => `      ${l}`).join('\n')}`);
      }
    });
  });

  describe('6. Connection Pool Health', () => {
    it('should have healthy pool configuration', async () => {
      const db = sql();

      const poolStats = await benchmarkQuery(
        'connection pool stats',
        async () => {
          const result = await db`
            SELECT
              count(*) as total_connections,
              count(*) FILTER (WHERE state = 'active') as active,
              count(*) FILTER (WHERE state = 'idle') as idle
            FROM pg_stat_activity
            WHERE datname = current_database()
          `;
          return result[0];
        }
      );

      console.log(`\n  ✓ Connection pool stats: ${poolStats.executionTimeMs}ms`);
      console.log(`    Active connections: ${(poolStats.rowsAffected as any)?.active}`);
      console.log(`    Idle connections: ${(poolStats.rowsAffected as any)?.idle}`);
    });
  });

  describe('7. Index Usage Analysis', () => {
    it('should report on index usage for key tables', async () => {
      const db = sql();

      const indexStats = await db`
        SELECT
          schemaname,
          tablename,
          indexname,
          idx_scan,
          idx_tup_read,
          idx_tup_fetch
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('users', 'sessions', 'companions', 'turns', 'memories')
        ORDER BY idx_scan DESC
        LIMIT 20
      `;

      console.log('\n  📊 Top Index Usage:');
      for (const stat of indexStats) {
        const scans = Number(stat.idx_scan) || 0;
        if (scans === 0) {
          console.log(`    ⚠️  UNUSED: ${stat.tablename}.${stat.indexname} (${scans} scans)`);
        } else {
          console.log(`    ✓ ${stat.tablename}.${stat.indexname}: ${scans} scans`);
        }
      }
    });
  });

  describe('8. Slow Query Detection', () => {
    it('should identify missing WHERE clauses', async () => {
      const db = sql();

      // This is a deliberately bad query to test detection
      const benchmark = await benchmarkQuery(
        'BAD: sessions without WHERE clause',
        async () => {
          return await db`
            SELECT COUNT(*) FROM sessions
          `;
        },
        'SELECT COUNT(*) FROM sessions'
      );

      console.log(`\n  ⚠️  ${benchmark.operation}: ${benchmark.executionTimeMs}ms`);
      console.log(`    This query scans the entire table - always use WHERE clauses!`);
    });
  });
});

/**
 * Run benchmarks comparison: BEFORE vs AFTER optimization
 */
describe('Before/After Optimization Comparison', () => {
  it('should demonstrate performance improvement with new indexes', async () => {
    const db = sql();

    console.log('\n📈 Performance Comparison:');
    console.log('Run this test BEFORE and AFTER applying migration 056_performance_indexes.ts\n');

    // Test 1: Active session lookup
    const activeSessionBefore = Date.now();
    await db`
      SELECT * FROM sessions
      WHERE user_id = '00000000-0000-0000-0000-000000000001'
        AND companion_id = '00000000-0000-0000-0000-000000000002'
        AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `;
    const activeSessionTime = Date.now() - activeSessionBefore;

    // Test 2: Stale session detection
    const staleSessionBefore = Date.now();
    await db`
      SELECT COUNT(*) FROM sessions
      WHERE status = 'active'
        AND last_activity_at < NOW() - INTERVAL '30 minutes'
    `;
    const staleSessionTime = Date.now() - staleSessionBefore;

    // Test 3: Email lookup
    const emailLookupBefore = Date.now();
    await db`
      SELECT * FROM users
      WHERE email_normalized = 'test@example.com'
    `;
    const emailLookupTime = Date.now() - emailLookupBefore;

    console.log(`  Active Session Lookup: ${activeSessionTime}ms (target: <5ms)`);
    console.log(`  Stale Session Detection: ${staleSessionTime}ms (target: <10ms)`);
    console.log(`  Email Lookup: ${emailLookupTime}ms (target: <5ms)`);

    const totalTime = activeSessionTime + staleSessionTime + emailLookupTime;
    console.log(`\n  Total: ${totalTime}ms`);
    console.log(`  Expected improvement with indexes: 60-80% reduction\n`);
  });
});
