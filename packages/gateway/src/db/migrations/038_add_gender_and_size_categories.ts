/**
 * Migration: Add Gender and Size Categories to Companion Appearance
 * Created: 2026-01-04
 *
 * Updates companion appearance data stored in the spec JSONB column:
 * - Adds gender field ('female' default for existing companions)
 * - Converts breastSize from numeric (0-100) to enum ('S' | 'M' | 'L')
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Update existing companions: Add gender='female' and convert breastSize
  // =========================================================================

  // Step 1: Add gender='female' to all companions missing gender
  await sql`
    UPDATE companions
    SET spec = jsonb_set(
      spec,
      '{visual_style,appearance,gender}',
      '"female"'::jsonb
    )
    WHERE spec->'visual_style'->'appearance' IS NOT NULL
      AND spec->'visual_style'->'appearance'->>'gender' IS NULL
  `;

  // Step 2: Convert numeric breastSize to S/M/L enum
  // 0-33 -> 'S', 34-66 -> 'M', 67-100 -> 'L'
  await sql`
    UPDATE companions
    SET spec = jsonb_set(
      spec,
      '{visual_style,appearance,breastSize}',
      CASE
        WHEN (spec->'visual_style'->'appearance'->>'breastSize')::numeric <= 33 THEN '"S"'::jsonb
        WHEN (spec->'visual_style'->'appearance'->>'breastSize')::numeric <= 66 THEN '"M"'::jsonb
        ELSE '"L"'::jsonb
      END
    )
    WHERE spec->'visual_style'->'appearance' IS NOT NULL
      AND spec->'visual_style'->'appearance'->>'breastSize' IS NOT NULL
      AND (spec->'visual_style'->'appearance'->>'breastSize') ~ '^[0-9]+$'
  `;

  // Step 3: Handle any companions with null or missing breastSize
  await sql`
    UPDATE companions
    SET spec = jsonb_set(
      spec,
      '{visual_style,appearance,breastSize}',
      '"M"'::jsonb
    )
    WHERE spec->'visual_style'->'appearance' IS NOT NULL
      AND spec->'visual_style'->'appearance'->>'gender' = 'female'
      AND (
        spec->'visual_style'->'appearance'->>'breastSize' IS NULL
        OR NOT (spec->'visual_style'->'appearance'->>'breastSize') ~ '^[SML]$'
      )
  `;

  // Step 4: Log migration results
  await sql`
    DO $$
    DECLARE
      total_count INTEGER;
      female_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO total_count
      FROM companions
      WHERE spec->'visual_style'->'appearance' IS NOT NULL;

      SELECT COUNT(*) INTO female_count
      FROM companions
      WHERE spec->'visual_style'->'appearance'->>'gender' = 'female';

      RAISE NOTICE 'Migration 038: Updated % companions (% marked as female)',
        total_count, female_count;
    END $$
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Revert: Convert breastSize back to numeric and remove gender

  // Step 1: Convert S/M/L back to numeric
  await sql`
    UPDATE companions
    SET spec = jsonb_set(
      spec,
      '{visual_style,appearance,breastSize}',
      CASE (spec->'visual_style'->'appearance'->>'breastSize')
        WHEN 'S' THEN '25'::jsonb
        WHEN 'M' THEN '50'::jsonb
        WHEN 'L' THEN '75'::jsonb
        ELSE '50'::jsonb
      END
    )
    WHERE spec->'visual_style'->'appearance' IS NOT NULL
      AND spec->'visual_style'->'appearance'->>'breastSize' IN ('S', 'M', 'L')
  `;

  // Step 2: Remove gender field
  await sql`
    UPDATE companions
    SET spec = spec #- '{visual_style,appearance,gender}'
    WHERE spec->'visual_style'->'appearance'->>'gender' IS NOT NULL
  `;

  // Step 3: Remove build field (for any male companions that were created)
  await sql`
    UPDATE companions
    SET spec = spec #- '{visual_style,appearance,build}'
    WHERE spec->'visual_style'->'appearance'->>'build' IS NOT NULL
  `;
}
