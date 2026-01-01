/**
 * Migration: Add Companion Sharing
 * Created: 2026-01-01
 *
 * Adds is_public column to companions table to enable public sharing.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add is_public column to companions table
  await sql`
    ALTER TABLE companions
    ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT FALSE
  `;

  // Index for efficient public companion queries
  await sql`
    CREATE INDEX idx_companions_public
    ON companions (id)
    WHERE is_public = TRUE
  `;

  await sql`
    COMMENT ON COLUMN companions.is_public IS 'Whether this companion is publicly shareable'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_companions_public`;
  await sql`ALTER TABLE companions DROP COLUMN IF EXISTS is_public`;
}
