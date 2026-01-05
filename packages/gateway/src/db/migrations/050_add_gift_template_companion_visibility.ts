/**
 * Migration: Add companion visibility to gift templates
 *
 * Adds source_companion_id to track which companion a template was generated for,
 * and is_public to allow users to make their generated gifts visible to all companions.
 *
 * Templates are only visible when:
 * 1. They were generated for the current companion (source_companion_id matches), OR
 * 2. They are marked as public (is_public = true)
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add source_companion_id to track which companion the template was created for
  await sql`
    ALTER TABLE gift_templates
    ADD COLUMN IF NOT EXISTS source_companion_id UUID REFERENCES companions(id) ON DELETE SET NULL
  `;

  // Add is_public flag - defaults to false (only visible to the companion it was generated for)
  await sql`
    ALTER TABLE gift_templates
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE
  `;

  // Create index for efficient filtering by companion
  await sql`
    CREATE INDEX IF NOT EXISTS idx_gift_templates_companion_visibility
    ON gift_templates (source_companion_id, is_public)
    WHERE status = 'active'
  `;

  // Backfill: Try to set source_companion_id from the source gift if available
  await sql`
    UPDATE gift_templates gt
    SET source_companion_id = g.companion_id
    FROM gifts g
    WHERE gt.source_gift_id = g.id
      AND gt.source_companion_id IS NULL
  `;

  await sql`
    COMMENT ON COLUMN gift_templates.source_companion_id IS 'The companion this template was originally generated for. Used to filter templates by companion.'
  `;

  await sql`
    COMMENT ON COLUMN gift_templates.is_public IS 'If true, this template is visible to all companions. If false, only visible to source_companion_id.'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_gift_templates_companion_visibility`;
  await sql`ALTER TABLE gift_templates DROP COLUMN IF EXISTS is_public`;
  await sql`ALTER TABLE gift_templates DROP COLUMN IF EXISTS source_companion_id`;
}
