/**
 * Migration: Update anchor image prompts from studio portrait to candid phone style
 * Created: 2026-03-23
 *
 * The anchor seed and variation prompts were using studio portrait language
 * (85mm lens, bokeh, shallow DOF, professional photography) which produced
 * overly polished, unrealistic images. Updated to candid smartphone aesthetic.
 */

import type postgres from 'postgres';

const DEFAULT_VERSION = '1.0.0';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    UPDATE prompt_templates
    SET template = ${'Candid smartphone selfie of an attractive {age_range} year old {ethnicity_text} with {hair_desc}. {pronoun} has a {body_desc}. {pronoun} has a {size_desc}. {scene_setting} Wearing a {outfit_color} {outfit}. {lighting}. Warm genuine expression, natural and relaxed. Looking at camera like a friend just took the photo. Natural phone camera perspective, everything in focus, no blur. Real person, natural skin texture, authentic candid moment.'},
        updated_at = NOW()
    WHERE prompt_key = 'orchestrator.anchor_seed_prompt'
      AND version = ${DEFAULT_VERSION}
      AND companion_id IS NULL
  `;

  await sql`
    UPDATE prompt_templates
    SET template = ${'Candid phone photo of {age_range} year old {ethnicity_text} with {hair_desc}, {body_desc}. {scene_setting}. Wearing a {outfit}. Natural relaxed expression, genuine and approachable. Taken on a smartphone, natural ambient lighting, everything in focus. Real person, authentic moment, no posing.'},
        updated_at = NOW()
    WHERE prompt_key = 'orchestrator.anchor_variation_prompt'
      AND version = ${DEFAULT_VERSION}
      AND companion_id IS NULL
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`
    UPDATE prompt_templates
    SET template = ${'Portrait of an attractive {age_range} year old {ethnicity_text} with {hair_desc}, styled beautifully. {pronoun} has a {body_desc}. {pronoun} has a {size_desc}. {scene_setting} Wearing a {outfit_color} {outfit}. {lighting}. Warm genuine smile, confident and approachable. Looking directly at camera with friendly expressive eyes. Waist-up framing, shallow depth of field, shot on 85mm lens. Photorealistic, natural skin texture, high resolution. Professional portrait photography, soft bokeh background.'},
        updated_at = NOW()
    WHERE prompt_key = 'orchestrator.anchor_seed_prompt'
      AND version = ${DEFAULT_VERSION}
      AND companion_id IS NULL
  `;

  await sql`
    UPDATE prompt_templates
    SET template = ${'{age_range} year old {ethnicity_text} with {hair_desc}, {body_desc}. {scene_setting}. Wearing a {outfit}. Warm genuine smile, confident and approachable. Looking at camera with friendly eyes. Waist-up framing, shallow depth of field, shot on 85mm lens. Photorealistic, natural skin texture, high resolution.'},
        updated_at = NOW()
    WHERE prompt_key = 'orchestrator.anchor_variation_prompt'
      AND version = ${DEFAULT_VERSION}
      AND companion_id IS NULL
  `;
}
