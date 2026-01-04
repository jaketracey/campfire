/**
 * Migration: Add Image Use Case Enum Values
 * Created: 2026-01-04
 *
 * Adds new use_case_type enum values for image operations.
 * This must be a separate migration because PostgreSQL requires
 * a transaction commit before new enum values can be used.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add new use_case_type enum values for image operations
  // These will be used in migration 041 for routing rules
  await sql`
    ALTER TYPE use_case_type ADD VALUE IF NOT EXISTS 'image_generation'
  `;
  await sql`
    ALTER TYPE use_case_type ADD VALUE IF NOT EXISTS 'image_anchor'
  `;
  await sql`
    ALTER TYPE use_case_type ADD VALUE IF NOT EXISTS 'image_variation'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Note: Cannot remove enum values in PostgreSQL without recreating the type
  // The image_generation, image_anchor, image_variation values will remain
  // but be unused. This is safe and a common PostgreSQL limitation.
}
