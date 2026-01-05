/**
 * Migration: Add Gift Use Case Enum Values
 * Created: 2026-01-05
 *
 * Adds new use_case_type enum values for gift generation operations.
 * - gift_generation: Text generation for gift content (name, description, etc.)
 * - gift_image: Image generation for gift visuals
 *
 * This must be a separate migration because PostgreSQL requires
 * a transaction commit before new enum values can be used.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add gift_generation for LLM text generation (gift content)
  await sql`
    ALTER TYPE use_case_type ADD VALUE IF NOT EXISTS 'gift_generation'
  `;

  // Add gift_image for image generation (gift visuals)
  await sql`
    ALTER TYPE use_case_type ADD VALUE IF NOT EXISTS 'gift_image'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Note: Cannot remove enum values in PostgreSQL without recreating the type
  // The gift_generation, gift_image values will remain but be unused.
  // This is safe and a common PostgreSQL limitation.
}
