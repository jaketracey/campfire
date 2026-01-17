-- ============================================================================
-- DATABASE MONITORING QUERIES FOR CAMPFIRE
-- ============================================================================
-- Use these queries to monitor database performance after optimization
-- Run in psql or your favorite PostgreSQL client
--
-- Usage:
--   psql campfire -f monitoring-queries.sql
--   Or copy/paste individual queries as needed
-- ============================================================================

-- ============================================================================
-- 1. SLOW QUERY DETECTION
-- ============================================================================

-- Top 10 slowest queries by total execution time
-- Run this to find queries consuming the most database time
SELECT
  substring(query, 1, 80) as query_preview,
  calls,
  round(total_exec_time::numeric, 2) as total_time_ms,
  round(mean_exec_time::numeric, 2) as avg_time_ms,
  round(max_exec_time::numeric, 2) as max_time_ms,
  round(stddev_exec_time::numeric, 2) as stddev_ms
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY total_exec_time DESC
LIMIT 10;

-- Queries with average execution time >100ms
-- These are candidates for optimization
SELECT
  substring(query, 1, 100) as query_preview,
  calls,
  round(mean_exec_time::numeric, 2) as avg_time_ms,
  round(max_exec_time::numeric, 2) as max_time_ms
FROM pg_stat_statements
WHERE mean_exec_time > 100
  AND calls > 10  -- Only frequently called queries
  AND query NOT LIKE '%pg_stat_statements%'
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Currently running slow queries (>5 seconds)
-- Use this to identify queries that are stuck
SELECT
  pid,
  now() - query_start as duration,
  state,
  wait_event_type,
  wait_event,
  substring(query, 1, 100) as query_preview
FROM pg_stat_activity
WHERE state != 'idle'
  AND now() - query_start > interval '5 seconds'
  AND datname = current_database()
ORDER BY duration DESC;

-- ============================================================================
-- 2. INDEX USAGE ANALYSIS
-- ============================================================================

-- New indexes from migration 056 - verify they're being used
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as times_used,
  idx_tup_read as rows_read,
  idx_tup_fetch as rows_fetched,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE indexname IN (
  'idx_sessions_active_lookup',
  'idx_sessions_stale_detection',
  'idx_sessions_user_recent',
  'idx_sessions_companion_recent',
  'idx_user_sessions_token_valid',
  'idx_user_sessions_cleanup',
  'idx_turns_session_recent',
  'idx_companions_user_active',
  'idx_companions_public_active',
  'idx_companion_avatars_lookup',
  'idx_companion_avatars_identity',
  'idx_memories_composite_search',
  'idx_memories_decay',
  'idx_sessions_dau_calculation',
  'idx_token_balances_user'
)
ORDER BY idx_scan DESC;

-- All indexes on key tables with usage stats
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as times_used,
  idx_tup_read as rows_read,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE tablename IN ('users', 'sessions', 'turns', 'companions', 'memories', 'user_sessions')
ORDER BY tablename, idx_scan DESC;

-- Unused indexes (never scanned)
-- Consider removing these to save disk space
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as wasted_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND indexrelid NOT IN (
    SELECT indexrelid FROM pg_index WHERE indisunique OR indisprimary
  )
ORDER BY pg_relation_size(indexrelid) DESC;

-- Index efficiency (fetch ratio)
-- Low ratio (<50%) means index returns many rows but few are used
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  CASE
    WHEN idx_tup_read = 0 THEN 0
    ELSE round((idx_tup_fetch::numeric / idx_tup_read::numeric) * 100, 2)
  END as fetch_efficiency_pct
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan > 0
ORDER BY fetch_efficiency_pct ASC;

-- ============================================================================
-- 3. CONNECTION POOL MONITORING
-- ============================================================================

-- Current connection statistics
-- Monitor this to ensure pool is healthy
SELECT
  count(*) as total_connections,
  count(*) FILTER (WHERE state = 'active') as active,
  count(*) FILTER (WHERE state = 'idle') as idle,
  count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
  count(*) FILTER (WHERE wait_event_type IS NOT NULL) as waiting,
  max(EXTRACT(EPOCH FROM (NOW() - state_change))::int) as max_idle_seconds
FROM pg_stat_activity
WHERE datname = current_database();

-- Detailed connection breakdown by application
SELECT
  application_name,
  count(*) as connections,
  count(*) FILTER (WHERE state = 'active') as active,
  count(*) FILTER (WHERE state = 'idle') as idle
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY application_name
ORDER BY connections DESC;

-- Connection leak detection
-- If idle_in_transaction > 0 for extended periods, investigate
SELECT
  pid,
  usename,
  application_name,
  client_addr,
  state,
  now() - state_change as duration,
  substring(query, 1, 100) as last_query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND datname = current_database()
ORDER BY duration DESC;

-- ============================================================================
-- 4. CACHE HIT RATIO
-- ============================================================================

-- Overall cache hit ratio (should be >99%)
-- If lower, consider increasing shared_buffers
SELECT
  sum(heap_blks_read) as heap_read,
  sum(heap_blks_hit) as heap_hit,
  round(
    sum(heap_blks_hit) * 100.0 / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0),
    2
  ) as cache_hit_ratio_pct
FROM pg_statio_user_tables;

-- Per-table cache hit ratio
-- Tables with low hit ratio may need optimization
SELECT
  schemaname,
  tablename,
  heap_blks_read,
  heap_blks_hit,
  round(
    heap_blks_hit * 100.0 / NULLIF(heap_blks_hit + heap_blks_read, 0),
    2
  ) as cache_hit_ratio_pct,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size
FROM pg_statio_user_tables
WHERE schemaname = 'public'
  AND heap_blks_read + heap_blks_hit > 0
ORDER BY cache_hit_ratio_pct ASC, heap_blks_read DESC
LIMIT 15;

-- Index cache hit ratio
SELECT
  schemaname,
  tablename,
  indexname,
  idx_blks_read,
  idx_blks_hit,
  round(
    idx_blks_hit * 100.0 / NULLIF(idx_blks_hit + idx_blks_read, 0),
    2
  ) as cache_hit_ratio_pct
FROM pg_statio_user_indexes
WHERE schemaname = 'public'
  AND idx_blks_read + idx_blks_hit > 0
ORDER BY cache_hit_ratio_pct ASC
LIMIT 15;

-- ============================================================================
-- 5. TABLE AND INDEX SIZE
-- ============================================================================

-- Largest tables with total size (table + indexes)
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as indexes_size,
  round(
    (pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename))::numeric * 100 /
    NULLIF(pg_total_relation_size(schemaname||'.'||tablename), 0),
    2
  ) as index_ratio_pct
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 15;

-- Largest indexes
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

-- Database total size
SELECT
  pg_size_pretty(pg_database_size(current_database())) as database_size;

-- ============================================================================
-- 6. TABLE BLOAT DETECTION
-- ============================================================================

-- Table bloat estimate
-- High bloat indicates need for VACUUM FULL
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  n_live_tup as live_rows,
  n_dead_tup as dead_rows,
  round((n_dead_tup::numeric * 100 / NULLIF(n_live_tup + n_dead_tup, 0)), 2) as dead_row_pct,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND n_live_tup > 0
ORDER BY dead_row_pct DESC, pg_relation_size(schemaname||'.'||tablename) DESC
LIMIT 15;

-- ============================================================================
-- 7. VACUUM AND ANALYZE STATUS
-- ============================================================================

-- Tables that haven't been vacuumed recently
SELECT
  schemaname,
  tablename,
  last_vacuum,
  last_autovacuum,
  n_dead_tup as dead_rows,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND (last_autovacuum IS NULL OR last_autovacuum < now() - interval '7 days')
ORDER BY n_dead_tup DESC
LIMIT 15;

-- Tables that need ANALYZE (outdated statistics)
SELECT
  schemaname,
  tablename,
  last_analyze,
  last_autoanalyze,
  n_mod_since_analyze as rows_modified,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND (last_autoanalyze IS NULL OR last_autoanalyze < now() - interval '7 days')
  AND n_mod_since_analyze > 1000
ORDER BY n_mod_since_analyze DESC
LIMIT 15;

-- ============================================================================
-- 8. SEQUENTIAL SCANS
-- ============================================================================

-- Tables with high sequential scan counts
-- May need indexes or query optimization
SELECT
  schemaname,
  tablename,
  seq_scan as sequential_scans,
  seq_tup_read as rows_read_sequentially,
  idx_scan as index_scans,
  CASE
    WHEN seq_scan + idx_scan = 0 THEN 0
    ELSE round((seq_scan::numeric * 100 / (seq_scan + idx_scan)), 2)
  END as seq_scan_pct,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND seq_scan > 0
ORDER BY seq_scan DESC
LIMIT 20;

-- ============================================================================
-- 9. LOCK MONITORING
-- ============================================================================

-- Current locks
SELECT
  locktype,
  mode,
  count(*) as lock_count
FROM pg_locks
WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
GROUP BY locktype, mode
ORDER BY lock_count DESC;

-- Blocking queries
SELECT
  blocked_locks.pid AS blocked_pid,
  blocked_activity.usename AS blocked_user,
  blocking_locks.pid AS blocking_pid,
  blocking_activity.usename AS blocking_user,
  blocked_activity.query AS blocked_statement,
  blocking_activity.query AS blocking_statement
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
  AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
  AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
  AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
  AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
  AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
  AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
  AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
  AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
  AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
  AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- ============================================================================
-- 10. QUERY EXECUTION PLAN EXAMPLES
-- ============================================================================

-- Get execution plan for active session lookup
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM sessions
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND companion_id = '00000000-0000-0000-0000-000000000002'
  AND status = 'active'
ORDER BY started_at DESC
LIMIT 1;

-- Get execution plan for token validation
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM user_sessions
WHERE token_hash = 'sample_hash'
  AND revoked_at IS NULL
  AND expires_at > NOW();

-- Get execution plan for recent turns
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM turns
WHERE session_id = '00000000-0000-0000-0000-000000000001'
ORDER BY turn_number DESC
LIMIT 10;

-- ============================================================================
-- 11. RESET STATISTICS (Use with caution!)
-- ============================================================================

-- Reset pg_stat_statements (clears all query stats)
-- Uncomment to use:
-- SELECT pg_stat_statements_reset();

-- Reset table/index statistics
-- Uncomment to use:
-- SELECT pg_stat_reset();

-- ============================================================================
-- 12. USEFUL FUNCTIONS
-- ============================================================================

-- Check if pg_stat_statements is enabled
SELECT installed_version
FROM pg_available_extensions
WHERE name = 'pg_stat_statements';

-- Enable pg_stat_statements (if not already enabled)
-- Uncomment to use:
-- CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Get PostgreSQL version
SELECT version();

-- Get current database settings
SELECT name, setting, unit, context
FROM pg_settings
WHERE name IN (
  'shared_buffers',
  'effective_cache_size',
  'work_mem',
  'maintenance_work_mem',
  'max_connections',
  'random_page_cost',
  'effective_io_concurrency'
)
ORDER BY name;

-- ============================================================================
-- END OF MONITORING QUERIES
-- ============================================================================
