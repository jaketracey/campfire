/**
 * Migration: Add Video Use Case Enum Values
 * Created: 2026-01-05
 *
 * Adds video use case types to the use_case_type enum.
 * This must be a separate migration because PostgreSQL doesn't allow
 * using newly added enum values in the same transaction.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add video use case types to the enum
  // Note: ALTER TYPE ... ADD VALUE cannot run in a transaction block,
  // but postgres.js handles this correctly when run outside explicit transactions
  await sql`ALTER TYPE use_case_type ADD VALUE IF NOT EXISTS 'video_generation'`;
  await sql`ALTER TYPE use_case_type ADD VALUE IF NOT EXISTS 'video_from_image'`;
  await sql`ALTER TYPE use_case_type ADD VALUE IF NOT EXISTS 'video_lip_sync'`;
  await sql`ALTER TYPE use_case_type ADD VALUE IF NOT EXISTS 'video_motion_brush'`;
}

export async function down(_sql: postgres.Sql): Promise<void> {
  // Note: Cannot remove enum values in PostgreSQL without recreating the type.
  // The video_generation, video_from_image, video_lip_sync, video_motion_brush
  // values will remain but be unused. This is safe and a common PostgreSQL limitation.
}
