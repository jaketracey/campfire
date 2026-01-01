#!/usr/bin/env tsx
/**
 * Database Reset Script for Project Campfire
 *
 * WARNING: This script will drop all tables and recreate the schema!
 * Only use in development environments.
 *
 * Usage:
 *   pnpm db:reset
 */

import { createPool, closePool } from './pool.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

async function reset(): Promise<void> {
  // Safety check
  if (process.env['NODE_ENV'] === 'production') {
    console.error('[Reset] ERROR: Cannot reset database in production!');
    process.exit(1);
  }

  const sql = createPool();

  try {
    console.log('[Reset] Dropping all tables...');

    // Drop all tables in reverse dependency order
    await sql`DROP TABLE IF EXISTS vault_render_queue CASCADE`;
    await sql`DROP TABLE IF EXISTS vault_links CASCADE`;
    await sql`DROP TABLE IF EXISTS vault_files CASCADE`;
    await sql`DROP TABLE IF EXISTS usage_records CASCADE`;
    await sql`DROP TABLE IF EXISTS billing_events CASCADE`;
    await sql`DROP TABLE IF EXISTS subscriptions CASCADE`;
    await sql`DROP TABLE IF EXISTS kg_edges CASCADE`;
    await sql`DROP TABLE IF EXISTS kg_entities CASCADE`;
    await sql`DROP TABLE IF EXISTS memories CASCADE`;
    await sql`DROP TABLE IF EXISTS turns CASCADE`;
    await sql`DROP TABLE IF EXISTS sessions CASCADE`;
    await sql`DROP TABLE IF EXISTS companion_avatars CASCADE`;
    await sql`DROP TABLE IF EXISTS companion_versions CASCADE`;
    await sql`DROP TABLE IF EXISTS companions CASCADE`;
    await sql`DROP TABLE IF EXISTS user_sessions CASCADE`;
    await sql`DROP TABLE IF EXISTS user_mfa CASCADE`;
    await sql`DROP TABLE IF EXISTS user_profiles CASCADE`;
    await sql`DROP TABLE IF EXISTS users CASCADE`;
    await sql`DROP TABLE IF EXISTS events CASCADE`;
    await sql`DROP TABLE IF EXISTS events_default CASCADE`;
    await sql`DROP TABLE IF EXISTS migrations CASCADE`;

    // Drop all custom types
    await sql`DROP TYPE IF EXISTS render_status CASCADE`;
    await sql`DROP TYPE IF EXISTS vault_file_type CASCADE`;
    await sql`DROP TYPE IF EXISTS subscription_plan CASCADE`;
    await sql`DROP TYPE IF EXISTS subscription_status CASCADE`;
    await sql`DROP TYPE IF EXISTS kg_edge_status CASCADE`;
    await sql`DROP TYPE IF EXISTS memory_status CASCADE`;
    await sql`DROP TYPE IF EXISTS memory_content_type CASCADE`;
    await sql`DROP TYPE IF EXISTS message_type CASCADE`;
    await sql`DROP TYPE IF EXISTS session_status CASCADE`;
    await sql`DROP TYPE IF EXISTS avatar_asset_type CASCADE`;
    await sql`DROP TYPE IF EXISTS companion_status CASCADE`;
    await sql`DROP TYPE IF EXISTS mfa_method CASCADE`;
    await sql`DROP TYPE IF EXISTS user_status CASCADE`;
    await sql`DROP TYPE IF EXISTS event_cost CASCADE`;

    // Drop all custom functions
    await sql`DROP FUNCTION IF EXISTS update_updated_at() CASCADE`;
    await sql`DROP FUNCTION IF EXISTS normalize_email(VARCHAR) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS set_normalized_email() CASCADE`;
    await sql`DROP FUNCTION IF EXISTS archive_companion_version() CASCADE`;
    await sql`DROP FUNCTION IF EXISTS ensure_single_active_avatar() CASCADE`;
    await sql`DROP FUNCTION IF EXISTS update_session_stats() CASCADE`;
    await sql`DROP FUNCTION IF EXISTS get_next_turn_number(UUID) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS search_memories_by_embedding(UUID, UUID, vector, INTEGER, REAL) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS record_memory_access(UUID) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS apply_memory_decay(UUID, UUID, REAL) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS normalize_entity_name(VARCHAR) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS set_canonical_entity_name() CASCADE`;
    await sql`DROP FUNCTION IF EXISTS update_entity_edge_count() CASCADE`;
    await sql`DROP FUNCTION IF EXISTS find_or_create_entity(UUID, UUID, VARCHAR, VARCHAR, UUID) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS propose_kg_edge(UUID, UUID, UUID, UUID, VARCHAR, REAL, UUID) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS promote_kg_edge(UUID) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS get_entity_relationships(UUID, VARCHAR) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS has_active_subscription(UUID) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS get_user_plan(UUID) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS record_usage(UUID, VARCHAR, INTEGER, UUID) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS check_usage_limit(UUID, VARCHAR) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS get_backlinks(UUID) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS resolve_vault_links() CASCADE`;
    await sql`DROP FUNCTION IF EXISTS enqueue_vault_render(UUID, vault_file_type, VARCHAR, UUID, UUID, INTEGER) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS claim_vault_render_job(VARCHAR) CASCADE`;
    await sql`DROP FUNCTION IF EXISTS complete_vault_render_job(UUID, UUID, TEXT) CASCADE`;

    console.log('[Reset] All tables dropped');

    await closePool();

    console.log('[Reset] Running migrations...');
    await migrate('up');

    console.log('[Reset] Running seed...');

    const seedSql = createPool();
    await seed(seedSql);
    await closePool();

    console.log('[Reset] Database reset completed successfully!');
  } catch (error) {
    console.error('[Reset] Error:', error);
    process.exit(1);
  }
}

reset();
