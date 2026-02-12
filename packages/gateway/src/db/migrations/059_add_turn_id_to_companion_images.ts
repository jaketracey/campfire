/**
 * Migration: Add turn_id linkage to companion_images
 * Created: 2026-02-12
 *
 * Enables deterministic mapping between chat turns and generated images.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    ALTER TABLE companion_images
    ADD COLUMN IF NOT EXISTS turn_id UUID
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_images_turn_id
    ON companion_images (turn_id)
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_companion_images_turn_id`;
  await sql`
    ALTER TABLE companion_images
    DROP COLUMN IF EXISTS turn_id
  `;
}

