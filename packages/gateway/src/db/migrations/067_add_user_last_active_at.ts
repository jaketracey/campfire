/**
 * Migration: Add last_active_at to users table
 * Created: 2026-03-26
 *
 * Adds a last_active_at timestamp to the users table for temporal
 * context tracking. The user_profiles table already has a timezone
 * column from the initial migration.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add last_active_at column if it doesn't exist
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ
  `;

  // Index for finding recently active users
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_last_active_at
    ON users (last_active_at DESC)
    WHERE last_active_at IS NOT NULL
  `;

  await sql`
    COMMENT ON COLUMN users.last_active_at IS 'Last time the user sent a message or interacted'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_users_last_active_at`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS last_active_at`;
}
