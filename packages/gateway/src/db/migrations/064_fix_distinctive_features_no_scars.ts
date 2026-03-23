/**
 * Migration: Remove scar/injury examples from distinctive_features prompt
 * Created: 2026-03-23
 *
 * The LLM was generating scars and wounds as distinctive features,
 * which image models render as visible injuries. Replace with
 * photo-friendly features only.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Update the distinctive_features example line in the prompt template
  // Old: "small scar on chin, sleeve tattoo, nose piercing, dimples, beauty mark"
  // New: remove scars, add only features that render well in photos
  await sql`
    UPDATE prompt_templates
    SET template = REPLACE(
      template,
      '"distinctive_features": ["1-2 physical features that add character, e.g. freckles, gap tooth, small scar on chin, sleeve tattoo, nose piercing, dimples, beauty mark"]',
      '"distinctive_features": ["1-2 subtle physical features that photograph well, e.g. freckles, dimples, beauty mark, gap tooth, curly hair, green eyes, strong jawline, nose piercing, sleeve tattoo"]'
    ),
    updated_at = NOW()
    WHERE prompt_key = 'orchestrator.random_identity_system_prompt'
  `;

  // Also update the guideline line to be explicit about no injuries
  await sql`
    UPDATE prompt_templates
    SET template = REPLACE(
      template,
      '- distinctive_features should be 1-2 small physical details that make them visually unique and memorable',
      '- distinctive_features should be 1-2 attractive or charming physical details (NEVER scars, wounds, injuries, or blemishes — only features that look good in photos)'
    ),
    updated_at = NOW()
    WHERE prompt_key = 'orchestrator.random_identity_system_prompt'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`
    UPDATE prompt_templates
    SET template = REPLACE(
      template,
      '"distinctive_features": ["1-2 subtle physical features that photograph well, e.g. freckles, dimples, beauty mark, gap tooth, curly hair, green eyes, strong jawline, nose piercing, sleeve tattoo"]',
      '"distinctive_features": ["1-2 physical features that add character, e.g. freckles, gap tooth, small scar on chin, sleeve tattoo, nose piercing, dimples, beauty mark"]'
    ),
    updated_at = NOW()
    WHERE prompt_key = 'orchestrator.random_identity_system_prompt'
  `;

  await sql`
    UPDATE prompt_templates
    SET template = REPLACE(
      template,
      '- distinctive_features should be 1-2 attractive or charming physical details (NEVER scars, wounds, injuries, or blemishes — only features that look good in photos)',
      '- distinctive_features should be 1-2 small physical details that make them visually unique and memorable'
    ),
    updated_at = NOW()
    WHERE prompt_key = 'orchestrator.random_identity_system_prompt'
  `;
}
