/**
 * Migration: Add temperature column to companions table
 * Created: 2026-04-11
 *
 * Allows companions to optionally specify an LLM sampling temperature,
 * overriding the system default of 0.7. NULL means "use system default".
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    ALTER TABLE companions
      ADD COLUMN temperature DECIMAL(3,2) DEFAULT NULL,
      ADD CONSTRAINT chk_companion_temperature
        CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2))
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`
    ALTER TABLE companions
      DROP CONSTRAINT IF EXISTS chk_companion_temperature,
      DROP COLUMN IF EXISTS temperature
  `;
}
