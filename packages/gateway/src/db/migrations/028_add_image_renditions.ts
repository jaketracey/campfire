/**
 * Migration: Add Image Renditions Column
 * Created: 2026-01-02
 *
 * Adds JSONB column to companion_images for storing rendition metadata.
 * Renditions include multiple sizes (thumb, small, medium, large) and
 * formats (webp, avif) for optimized image delivery.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add renditions column to store multi-size, multi-format metadata
  await sql`
    ALTER TABLE companion_images
    ADD COLUMN IF NOT EXISTS renditions JSONB DEFAULT NULL
  `;

  // Add index for querying images that have renditions
  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_images_has_renditions
    ON companion_images ((renditions IS NOT NULL))
    WHERE renditions IS NOT NULL
  `;

  // Add comment explaining the schema
  await sql`
    COMMENT ON COLUMN companion_images.renditions IS 'Multi-size/format renditions: {thumb,small,medium,large,original: {webp,avif,png: {s3Key,url,sizeBytes,format,width,height}}}'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_companion_images_has_renditions`;
  await sql`ALTER TABLE companion_images DROP COLUMN IF EXISTS renditions`;
}
