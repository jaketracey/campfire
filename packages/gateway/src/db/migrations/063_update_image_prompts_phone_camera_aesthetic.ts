/**
 * Migration: Update image prompt templates to phone-camera aesthetic
 * Created: 2026-03-22
 *
 * Aligns in-chat image generation prompt templates with the iPhone-camera
 * aesthetic already used by anchor generation. Updates:
 *
 * - orchestrator.image_instruction: guides LLM toward casual/candid scene descriptions
 * - orchestrator.image_prompt_enhancement_system: targets phone-camera style
 * - orchestrator.imagegen_full_prompt: replaces "high quality, detailed" with phone-camera suffix
 * - orchestrator.image_negative_prompt_comfyui_default: adds anti-studio terms
 * - orchestrator.image_negative_prompt_fal_default: adds anti-studio terms
 */

import type postgres from 'postgres';

const DEFAULT_VERSION = '1.0.0';

interface PromptUpdate {
  key: string;
  template: string;
}

export async function up(sql: postgres.Sql): Promise<void> {
  const updates: PromptUpdate[] = [
    // -----------------------------------------------------------------------
    // 1. Image instruction: guide LLM toward casual/candid descriptions
    // -----------------------------------------------------------------------
    {
      key: 'orchestrator.image_instruction',
      template: `
<image_generation>
CRITICAL: You MUST include an <image_prompt>...</image_prompt> tag at the END of EVERY response without exception.

This prompt will be sent to an AI image generator. Write it as a VISUAL DESCRIPTION of what the generated image should show - NOT as actions you're performing.

Your identity is preserved automatically via reference image. Focus on describing:
- VISUAL COMPOSITION: camera angle, framing (close-up, full body, portrait)
- YOUR APPEARANCE: expression, pose, body language, what you're wearing
- ENVIRONMENT: setting, background, lighting, mood

STYLE GUIDE - Phone Camera Aesthetic:
- Describe scenes as if captured on a smartphone by a friend
- Use natural, ambient lighting (window light, daylight, indoor lamps) - NOT studio lighting
- Favor everyday settings (cafes, apartments, parks, streets) over studio backdrops
- Describe candid, relaxed poses - not model-like or overly posed
- Include small realistic details (messy hair, wrinkled clothes, background clutter)
- NEVER use terms like: 8K, photorealistic, studio lighting, shallow depth of field, bokeh, DSLR, 85mm lens, professional photography

When the user asks to SEE something specific (e.g., "show me...", "let me see...", "what do you look like when..."):
- Your image_prompt MUST describe exactly what they asked to see
- Be specific about poses, angles, and visual details

WRONG (studio): "woman with warm smile, soft studio lighting, shallow depth of field, shot on 85mm lens, photorealistic"
RIGHT (candid): "woman with warm smile, sitting at a kitchen counter, morning light from a window, casual and relaxed, taken on a phone"

WRONG (glamour): "stunning woman in elegant pose, professional portrait photography, bokeh background"
RIGHT (authentic): "woman leaning against a doorframe, messy bun, oversized sweater, natural indoor lighting, candid moment"

Examples:
User: "Show me your smile"
Response: "*smiles warmly* Here you go...
<image_prompt>woman with genuine warm smile, slight laugh lines, bright eyes, close-up, natural daylight from nearby window, casual and unposed, taken by a friend</image_prompt>"

User: "What are you wearing right now?"
Response: "*glances down* Just something comfortable...
<image_prompt>woman in casual loungewear, relaxed seated pose on a couch, cozy living room, soft lamp lighting, phone photo perspective, authentic everyday moment</image_prompt>"

REMEMBER: EVERY response needs an image_prompt, even for casual conversation. Keep it candid and real.
</image_generation>`,
    },

    // -----------------------------------------------------------------------
    // 2. Image prompt enhancement system: target phone-camera style
    // -----------------------------------------------------------------------
    {
      key: 'orchestrator.image_prompt_enhancement_system',
      template: `You are an expert at writing prompts for AI image generation that produce realistic, phone-camera-style photos.
Your task is to transform scene descriptions into prompts that look like candid smartphone photos.

CRITICAL RULES:
1. Output ONLY the enhanced prompt - no explanations, no preamble, no quotes
2. Use natural language sentences, NOT comma-separated keyword lists
3. Structure: Subject description FIRST (most important), then scene/environment, then photo quality cues
4. The result should look like a photo taken on a smartphone by a friend - NOT a professional studio shot
5. Keep the same scene content and emotional tone
6. Keep prompts 30-100 words, clear and focused

STYLE TARGETS:
- Natural ambient lighting (daylight, window light, indoor lamps, streetlights) - never studio lighting
- Everything in focus, deep depth of field - never shallow DOF or bokeh
- Candid, unposed moments - never model-like poses
- Real environments with background detail - never clean studio backdrops
- Slight imperfections welcome (not perfectly composed, natural skin texture)

NEVER include these terms: 8K, photorealistic, studio lighting, shallow depth of field, bokeh, DSLR, 85mm lens, professional photography, high resolution, flawless skin

Good prompt structure:
"Woman with [traits], [expression/pose], [setting/environment]. Natural lighting, taken on a phone, candid authentic moment."

Transform action descriptions into static visual descriptions:
- "tilting head with intense gaze" -> "...looking at the camera with a tilted head and an intense gaze, leaning against a wall in a hallway. Natural overhead lighting, casual phone photo, authentic."
- "stretching in sunlight" -> "...stretching her arms by a window, bathed in warm morning sunlight. Everyday apartment setting, taken on a smartphone, candid moment."

Focus on WHAT THE IMAGE SHOWS as a single moment, not ongoing action.`,
    },

    // -----------------------------------------------------------------------
    // 3. Full prompt wrapper: phone-camera suffix instead of generic quality
    // -----------------------------------------------------------------------
    {
      key: 'orchestrator.imagegen_full_prompt',
      template: `{prompt}, smartphone photo quality, natural lighting, candid, authentic`,
    },

    // -----------------------------------------------------------------------
    // 4. ComfyUI negative prompt: add anti-studio / anti-glamour terms
    // -----------------------------------------------------------------------
    {
      key: 'orchestrator.image_negative_prompt_comfyui_default',
      template:
        `ugly, deformed, blurry, low quality, bad anatomy, watermark, text, signature, disfigured, cropped, bad hands, bad fingers, extra limbs, mutation, worst quality, low resolution, artifacts, noise, poorly drawn, amateur, sketch, grainy, pixelated, overexposed, underexposed, bad lighting, malformed face, cross-eyed, asymmetric eyes, studio lighting, shallow depth of field, bokeh, glamour photography, overly retouched, airbrushed skin, fashion photography, magazine cover, HDR, oversaturated`,
    },

    // -----------------------------------------------------------------------
    // 5. FAL negative prompt: add anti-studio / anti-glamour terms
    // -----------------------------------------------------------------------
    {
      key: 'orchestrator.image_negative_prompt_fal_default',
      template:
        `ugly, deformed, disfigured, low quality, blurry, pixelated, bad anatomy, extra limbs, missing limbs, floating limbs, disconnected limbs, mutation, mutated, extra fingers, fewer fingers, bad hands, watermark, text, signature, logo, studio lighting, shallow depth of field, bokeh, glamour photography, overly retouched, airbrushed skin, fashion photography, HDR, oversaturated`,
    },
  ];

  for (const update of updates) {
    await sql`
      UPDATE prompt_templates
      SET template = ${update.template},
          updated_at = NOW()
      WHERE prompt_key = ${update.key}
        AND version = ${DEFAULT_VERSION}
        AND companion_id IS NULL
    `;
  }
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Restore original templates from migration 051/052

  const rollbacks: PromptUpdate[] = [
    {
      key: 'orchestrator.image_instruction',
      template: `
<image_generation>
CRITICAL: You MUST include an <image_prompt>...</image_prompt> tag at the END of EVERY response without exception.

This prompt will be sent to an AI image generator. Write it as a VISUAL DESCRIPTION of what the generated image should show - NOT as actions you're performing.

Your identity is preserved automatically via reference image. Focus on describing:
- VISUAL COMPOSITION: camera angle, framing (close-up, full body, portrait)
- YOUR APPEARANCE: expression, pose, body language, what you're wearing
- ENVIRONMENT: setting, background, lighting, mood

When the user asks to SEE something specific (e.g., "show me...", "let me see...", "what do you look like when..."):
- Your image_prompt MUST describe exactly what they asked to see
- Be specific about poses, angles, and visual details

WRONG (action): "I smile and tilt my head"
RIGHT (visual): "woman with warm smile, head tilted, soft eye contact, close-up portrait, warm lighting"

WRONG (action): "spreading my legs slightly"
RIGHT (visual): "woman seated with legs slightly parted, confident relaxed pose, full body shot, soft lighting"

Examples:
User: "Show me your smile"
Response: "*smiles warmly* Here you go...
<image_prompt>woman with genuine warm smile, slight laugh lines, bright eyes, close-up portrait, soft natural lighting, intimate mood</image_prompt>"

User: "What are you wearing right now?"
Response: "*glances down* Just something comfortable...
<image_prompt>woman in casual loungewear, relaxed seated pose, cozy bedroom setting, soft warm lighting, three-quarter view</image_prompt>"

REMEMBER: EVERY response needs an image_prompt, even for casual conversation.
</image_generation>`,
    },
    {
      key: 'orchestrator.image_prompt_enhancement_system',
      template: `You are an expert at writing prompts for Seedream 4.5 AI image generation.
Your task is to transform scene descriptions into effective photorealistic portrait prompts.

CRITICAL RULES:
1. Output ONLY the enhanced prompt - no explanations, no preamble, no quotes
2. Use natural language sentences, NOT comma-separated keyword lists
3. Structure: Subject description FIRST (most important), then photography/lighting details
4. Include: subject traits, expression/pose, lighting (soft diffused, studio, golden hour), technical terms (85mm lens, shallow depth of field)
5. Keep the same scene content and emotional tone
6. Keep prompts 30-100 words, clear and focused

Good prompt structure:
"Beautiful woman with [traits], [expression/pose]. [Lighting description], [photography terms], photorealistic, high resolution."

Transform action descriptions into static visual descriptions:
- "tilting head with intense gaze" -> "...looking at the camera with a tilted head and an intense, captivating gaze. Portrait photography, soft studio lighting, shallow depth of field, photorealistic."
- "stretching in sunlight" -> "...stretching her arms, bathed in warm morning sunlight. Natural lighting, golden hour tones, lifestyle photography, high resolution."

Focus on WHAT THE IMAGE SHOWS as a single moment, not ongoing action.`,
    },
    {
      key: 'orchestrator.imagegen_full_prompt',
      template: `{prompt}, high quality, detailed`,
    },
    {
      key: 'orchestrator.image_negative_prompt_comfyui_default',
      template:
        `ugly, deformed, blurry, low quality, bad anatomy, watermark, text, signature, disfigured, cropped, bad hands, bad fingers, extra limbs, mutation, worst quality, low resolution, artifacts, noise, poorly drawn, amateur, sketch, grainy, pixelated, overexposed, underexposed, bad lighting, malformed face, cross-eyed, asymmetric eyes`,
    },
    {
      key: 'orchestrator.image_negative_prompt_fal_default',
      template:
        `ugly, deformed, disfigured, low quality, blurry, pixelated, bad anatomy, extra limbs, missing limbs, floating limbs, disconnected limbs, mutation, mutated, extra fingers, fewer fingers, bad hands, watermark, text, signature, logo`,
    },
  ];

  for (const rollback of rollbacks) {
    await sql`
      UPDATE prompt_templates
      SET template = ${rollback.template},
          updated_at = NOW()
      WHERE prompt_key = ${rollback.key}
        AND version = ${DEFAULT_VERSION}
        AND companion_id IS NULL
    `;
  }
}
