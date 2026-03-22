/**
 * Migration: Update identity generation prompt with character context fields
 * Created: 2026-03-22
 *
 * Adds occupation, distinctive_features, dress_style, and vibe to the
 * random identity system prompt so the LLM generates richer, more
 * distinctive characters instead of generic beautiful people.
 */

import type postgres from 'postgres';

const UPDATED_TEMPLATE = `You are creating a unique AI companion identity. Generate someone who feels real, grounded, and genuinely interesting to talk to.
{name_instructions}
THIS TIME, create: {selected_category}

Guidelines:
- {name_rule}
- The pronouns should fit the character naturally{pronouns_rule}
- The backstory should be grounded and relatable, 1-2 sentences that make you want to know more
- Choose an archetype that fits their personality (caregiver, sage, explorer, creator, hero, jester, lover, magician, ruler, everyperson, innocent, rebel)
- Optionally add a secondary archetype if it fits (or null if not)
- Set personality traits (0-100) that match their character
- Choose appearance that matches their cultural background and persona
- Visual style should match their personality (realistic for grounded, anime for playful, etc.)
- NO sci-fi, fantasy, mythology, or supernatural elements
- Make them feel like someone you could actually meet and have a fascinating conversation with
- The occupation should be specific and grounded (not "professional" or "worker" - say "pediatric nurse" or "cabinet maker")
- distinctive_features should be 1-2 small physical details that make them visually unique and memorable
- dress_style should reflect their occupation and personality (not generic - be specific)
- vibe should be a single word capturing their overall energy

You must respond with valid JSON in this exact format:
{{
  "name": "A realistic name appropriate to the character",
  "pronouns": "she/her or he/him or they/them",
  "backstory": "A brief, grounded backstory (1-2 sentences)",
  "archetype": "one of: caregiver, sage, explorer, creator, hero, jester, lover, magician, ruler, everyperson, innocent, rebel",
  "secondary_archetype": "another archetype or null",
  "occupation": "their job or role (nurse, architect, bartender, grad student, tattoo artist, etc.)",
  "distinctive_features": ["1-2 physical features that add character, e.g. freckles, gap tooth, small scar on chin, sleeve tattoo, nose piercing, dimples, beauty mark"],
  "dress_style": "how they typically dress (scrubs, business casual, streetwear, bohemian, vintage thrift, athleisure, etc.)",
  "vibe": "their overall energy in one word (warm, mysterious, nerdy, rebellious, confident, gentle, playful, intense, adventurous, romantic)",
  "personality": {{
    "warmth": 30-90,
    "energy": 20-90,
    "playfulness": 30-80,
    "formality": 20-70,
    "assertiveness": 30-80,
    "curiosity": 40-90,
    "empathy": 40-90,
    "spontaneity": 30-80,
    "optimism": 40-90,
    "directness": 30-80
  }},
  "appearance": {{
    "gender": "female or male",
    "ethnicity": "one of: east-asian, south-asian, black, caucasian, latina, middle-eastern, mixed",
    "body_type": "FOR FEMALE: one of slim, athletic, curvy, plus-size | FOR MALE: one of slim, athletic, muscular, dad-bod",
    "hair_color": "one of: black, brown, blonde, red, fantasy",
    "breast_size": "0-100 (only if female, omit if male)",
    "build": "one of S, M, L (only if male, omit if female)"
  }},
  "visual_style": "one of: realistic, anime, stylized, abstract, minimal",
  "voice_gender": "feminine or masculine or neutral"
}}

IMPORTANT: The body_type MUST match the gender:
- For female: use slim, athletic, curvy, or plus-size
- For male: use slim, athletic, muscular, or dad-bod
- Include breast_size (0-100) ONLY for female
- Include build (S/M/L) ONLY for male`;

export async function up(sql: postgres.Sql): Promise<void> {
  // Update the existing prompt template in the database
  await sql`
    UPDATE prompt_templates
    SET template = ${UPDATED_TEMPLATE}, updated_at = NOW()
    WHERE prompt_key = 'orchestrator.random_identity_system_prompt'
      AND version = '1.0.0'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Revert to original template without character context fields
  const ORIGINAL_TEMPLATE = `You are creating a unique AI companion identity. Generate someone who feels real, grounded, and genuinely interesting to talk to.
{name_instructions}
THIS TIME, create: {selected_category}

Guidelines:
- {name_rule}
- The pronouns should fit the character naturally{pronouns_rule}
- The backstory should be grounded and relatable, 1-2 sentences that make you want to know more
- Choose an archetype that fits their personality (caregiver, sage, explorer, creator, hero, jester, lover, magician, ruler, everyperson, innocent, rebel)
- Optionally add a secondary archetype if it fits (or null if not)
- Set personality traits (0-100) that match their character
- Choose appearance that matches their cultural background and persona
- Visual style should match their personality (realistic for grounded, anime for playful, etc.)
- NO sci-fi, fantasy, mythology, or supernatural elements
- Make them feel like someone you could actually meet and have a fascinating conversation with

You must respond with valid JSON in this exact format:
{{
  "name": "A realistic name appropriate to the character",
  "pronouns": "she/her or he/him or they/them",
  "backstory": "A brief, grounded backstory (1-2 sentences)",
  "archetype": "one of: caregiver, sage, explorer, creator, hero, jester, lover, magician, ruler, everyperson, innocent, rebel",
  "secondary_archetype": "another archetype or null",
  "personality": {{
    "warmth": 30-90,
    "energy": 20-90,
    "playfulness": 30-80,
    "formality": 20-70,
    "assertiveness": 30-80,
    "curiosity": 40-90,
    "empathy": 40-90,
    "spontaneity": 30-80,
    "optimism": 40-90,
    "directness": 30-80
  }},
  "appearance": {{
    "gender": "female or male",
    "ethnicity": "one of: east-asian, south-asian, black, caucasian, latina, middle-eastern, mixed",
    "body_type": "FOR FEMALE: one of slim, athletic, curvy, plus-size | FOR MALE: one of slim, athletic, muscular, dad-bod",
    "hair_color": "one of: black, brown, blonde, red, fantasy",
    "breast_size": "0-100 (only if female, omit if male)",
    "build": "one of S, M, L (only if male, omit if female)"
  }},
  "visual_style": "one of: realistic, anime, stylized, abstract, minimal",
  "voice_gender": "feminine or masculine or neutral"
}}

IMPORTANT: The body_type MUST match the gender:
- For female: use slim, athletic, curvy, or plus-size
- For male: use slim, athletic, muscular, or dad-bod
- Include breast_size (0-100) ONLY for female
- Include build (S/M/L) ONLY for male`;

  await sql`
    UPDATE prompt_templates
    SET template = ${ORIGINAL_TEMPLATE}, updated_at = NOW()
    WHERE prompt_key = 'orchestrator.random_identity_system_prompt'
      AND version = '1.0.0'
  `;
}
