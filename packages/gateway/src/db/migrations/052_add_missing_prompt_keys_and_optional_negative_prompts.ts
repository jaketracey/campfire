/**
 * Migration: Add missing prompt keys + relax negative prompt requirements
 * Created: 2026-01-05
 *
 * - Adds any prompt templates discovered after initial prompt-template migration.
 * - Marks negative prompts as optional (provider/model dependent).
 */

import type postgres from 'postgres';

type PromptAdminArea = 'routing' | 'image_routing' | 'video_routing' | 'other';

type SeedPrompt = {
  key: string;
  displayName: string;
  description: string;
  adminArea: PromptAdminArea;
  isRequired: boolean;
  allowedVariables: string[];
  template: string;
  version?: string;
};

const DEFAULT_VERSION = '1.0.0';

export async function up(sql: postgres.Sql): Promise<void> {
  // Make negative prompts optional (some models/providers do not support them).
  await sql`
    UPDATE prompt_definitions
    SET is_required = FALSE, updated_at = NOW()
    WHERE key IN (
      'orchestrator.image_negative_prompt_comfyui_default',
      'orchestrator.image_negative_prompt_fal_default',
      'orchestrator.video_negative_prompt_animatediff_default'
    )
  `;

  const prompts: SeedPrompt[] = [
    // ---------------------------------------------------------------------
    // Orchestrator seeded anchor prompts (identity anchors)
    // ---------------------------------------------------------------------
    {
      key: 'orchestrator.anchor_seed_prompt',
      displayName: 'Anchor Seed Prompt',
      description: 'Prompt used to generate the seed identity anchor image',
      adminArea: 'image_routing',
      isRequired: true,
      allowedVariables: [
        'age_range',
        'ethnicity_text',
        'hair_desc',
        'pronoun',
        'body_desc',
        'size_desc',
        'scene_setting',
        'outfit_color',
        'outfit',
        'lighting',
      ],
      template:
        `Portrait of an attractive {age_range} year old {ethnicity_text} with {hair_desc}, styled beautifully. {pronoun} has a {body_desc}. {pronoun} has a {size_desc}. {scene_setting} Wearing a {outfit_color} {outfit}. {lighting}. Warm genuine smile, confident and approachable. Looking directly at camera with friendly expressive eyes. Waist-up framing, shallow depth of field, shot on 85mm lens. Photorealistic, natural skin texture, high resolution. Professional portrait photography, soft bokeh background.`,
    },
    {
      key: 'orchestrator.anchor_variation_prompt',
      displayName: 'Anchor Variation Prompt',
      description: 'Prompt used to generate scene variation identity anchors',
      adminArea: 'image_routing',
      isRequired: true,
      allowedVariables: [
        'age_range',
        'ethnicity_text',
        'hair_desc',
        'body_desc',
        'scene_setting',
        'outfit',
      ],
      template:
        `{age_range} year old {ethnicity_text} with {hair_desc}, {body_desc}. {scene_setting}. Wearing a {outfit}. Warm genuine smile, confident and approachable. Looking at camera with friendly eyes. Waist-up framing, shallow depth of field, shot on 85mm lens. Photorealistic, natural skin texture, high resolution.`,
    },

    // ---------------------------------------------------------------------
    // Gateway debug KG summary user prompt
    // ---------------------------------------------------------------------
    {
      key: 'gateway.debug_kg_user_prompt',
      displayName: 'Debug KG User Prompt',
      description: 'User prompt used for debug knowledge graph summary generation',
      adminArea: 'other',
      isRequired: true,
      allowedVariables: [
        'entity_count',
        'edge_count',
        'entity_types_json',
        'relation_types_json',
        'sample_entities_bullets',
        'sample_edges_bullets',
      ],
      template: `You are a knowledge graph analyst. Analyze the following knowledge graph data and provide a concise summary of what the AI companion knows about this user.

Knowledge Graph Data:
- Total Entities: {entity_count}
- Total Relationships: {edge_count}
- Entity Types: {entity_types_json}
- Relationship Types: {relation_types_json}

Sample Entities:
{sample_entities_bullets}

Sample Relationships:
{sample_edges_bullets}

Provide a 2-3 paragraph summary that:
1. Describes the key people, places, and concepts the companion knows about
2. Highlights the most important relationships
3. Notes any patterns or themes in what has been learned

Keep it conversational and insightful.`,
    },
  ];

  for (const prompt of prompts) {
    const version = prompt.version ?? DEFAULT_VERSION;

    await sql`
      INSERT INTO prompt_definitions (key, display_name, description, admin_area, is_required, allowed_variables)
      VALUES (
        ${prompt.key},
        ${prompt.displayName},
        ${prompt.description},
        ${prompt.adminArea},
        ${prompt.isRequired},
        ${prompt.allowedVariables}
      )
      ON CONFLICT (key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        admin_area = EXCLUDED.admin_area,
        is_required = EXCLUDED.is_required,
        allowed_variables = EXCLUDED.allowed_variables,
        updated_at = NOW()
    `;

    await sql`
      INSERT INTO prompt_templates (prompt_key, version, companion_id, template, variables)
      VALUES (
        ${prompt.key},
        ${version},
        NULL,
        ${prompt.template},
        ${prompt.allowedVariables}
      )
      ON CONFLICT (prompt_key, version, companion_id) DO UPDATE SET
        template = EXCLUDED.template,
        variables = EXCLUDED.variables,
        updated_at = NOW()
    `;
  }
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`
    DELETE FROM prompt_templates
    WHERE prompt_key IN (
      'orchestrator.anchor_seed_prompt',
      'orchestrator.anchor_variation_prompt',
      'gateway.debug_kg_user_prompt'
    )
  `;
  await sql`
    DELETE FROM prompt_definitions
    WHERE key IN (
      'orchestrator.anchor_seed_prompt',
      'orchestrator.anchor_variation_prompt',
      'gateway.debug_kg_user_prompt'
    )
  `;

  // Restore negative prompts to required (best-effort; original migration set them required).
  await sql`
    UPDATE prompt_definitions
    SET is_required = TRUE, updated_at = NOW()
    WHERE key IN (
      'orchestrator.image_negative_prompt_comfyui_default',
      'orchestrator.image_negative_prompt_fal_default',
      'orchestrator.video_negative_prompt_animatediff_default'
    )
  `;
}

