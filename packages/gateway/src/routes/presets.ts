/**
 * Archetype Preset Routes
 *
 * Public endpoints for browsing presets and creating companions from them.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { logger } from '../observability/logger.js';
import type { CompanionSpec } from '../db/types.js';
import {
  ARCHETYPE_PRESETS,
  getAllArchetypePresets,
  getArchetypePreset,
} from '@campfire/shared';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const CreateFromPresetSchema = z.object({
  /** Companion display name */
  name: z.string().min(1).max(100),
  /** Gender for appearance/voice defaults */
  gender: z.enum(['female', 'male']),
  /** Archetype key */
  archetype: z.string().min(1),
  /** Optional overrides applied on top of preset defaults */
  customizations: z.object({
    /** Override individual personality sliders (0-100) */
    personalitySliders: z.record(z.string(), z.number().min(0).max(100)).optional(),
    /** Override communication style fields */
    communicationStyle: z.object({
      messageLength: z.enum(['concise', 'moderate', 'detailed']).optional(),
      emojiUsage: z.enum(['none', 'minimal', 'moderate', 'frequent']).optional(),
      vocabularyLevel: z.enum(['simple', 'moderate', 'sophisticated']).optional(),
      questionFrequency: z.enum(['rare', 'occasional', 'frequent']).optional(),
    }).optional(),
    /** Override voice selection */
    voiceId: z.string().optional(),
    /** Override appearance fields */
    appearance: z.record(z.string(), z.unknown()).optional(),
    /** Additional tenets */
    tenets: z.array(z.object({
      id: z.string(),
      category: z.string(),
      priority: z.enum(['core', 'situational']),
      rule: z.string(),
      description: z.string().optional(),
      isNegation: z.boolean(),
      triggerContexts: z.array(z.string()).optional(),
    })).optional(),
    /** Content rating */
    contentRating: z.string().optional(),
    /** Relationship pacing */
    relationshipPacing: z.string().optional(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a full CompanionSpec from an archetype preset, a name, a gender,
 * and optional customization overrides.
 */
function buildSpecFromPreset(
  input: z.infer<typeof CreateFromPresetSchema>,
): CompanionSpec {
  const preset = getArchetypePreset(input.archetype);
  if (!preset) {
    throw new Error(`Unknown archetype: ${input.archetype}`);
  }

  const gender = input.gender;
  const custom = input.customizations || {};

  // Personality sliders -- start from preset, overlay custom values
  const sliders = { ...preset.personalitySliders };
  if (custom.personalitySliders) {
    for (const [key, val] of Object.entries(custom.personalitySliders)) {
      if (key in sliders) {
        (sliders as Record<string, number>)[key] = val;
      }
    }
  }

  // Voice
  const defaultVoice = gender === 'female'
    ? preset.defaultVoices.feminine
    : preset.defaultVoices.masculine;

  // Appearance
  const defaultAppearance = gender === 'female'
    ? preset.defaultAppearances.feminine
    : preset.defaultAppearances.masculine;

  const appearance = custom.appearance
    ? { ...defaultAppearance, ...custom.appearance }
    : defaultAppearance;

  // Tenets
  const tenets = [
    ...preset.coreTenets.map((rule, idx) => ({
      id: `preset-${input.archetype}-${idx}`,
      category: 'engagement' as const,
      priority: 'core' as const,
      rule,
      isNegation: false,
    })),
    ...(custom.tenets || []),
  ];

  const spec: CompanionSpec = {
    identity: {
      name: input.name,
      pronouns: gender === 'female' ? 'she/her' : 'he/him',
      address_style: 'friendly',
    },
    personality: {
      archetype: input.archetype,
      traits: sliders as unknown as Record<string, number>,
    },
    voice: {
      provider: 'elevenlabs',
      voice_id: custom.voiceId || defaultVoice.voiceId,
    },
    visual_style: {
      style_type: 'realistic',
      appearance: appearance as CompanionSpec['visual_style']['appearance'],
    },
    boundaries: {
      relationship_pacing: custom.relationshipPacing || 'moderate',
      content_rating: custom.contentRating || 'PG-13',
    },
    memory_consent: {
      allow_long_term: true,
      allow_kg_extraction: true,
    },
    tenets,
  };

  return spec;
}

/**
 * Map a preset to a lighter API response (no need to expose voice IDs etc.)
 */
function mapPresetResponse(preset: ReturnType<typeof getArchetypePreset>) {
  if (!preset) return null;
  return {
    archetype: preset.archetype,
    displayName: preset.displayName,
    tagline: preset.tagline,
    description: preset.description,
    personalitySliders: preset.personalitySliders,
    communicationStyle: preset.communicationStyle,
    coreTenets: preset.coreTenets,
    firstMessages: preset.firstMessages,
    traitKeywords: preset.traitKeywords,
    defaultVoices: preset.defaultVoices,
    defaultAppearances: preset.defaultAppearances,
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function presetRoutes(app: FastifyInstance): Promise<void> {
  const companionRepo = getCompanionsRepository();

  /**
   * GET /companions/presets - List all archetype presets (public)
   */
  app.get('/presets', async (_request: FastifyRequest, reply: FastifyReply) => {
    const presets = getAllArchetypePresets().map(mapPresetResponse);
    return reply.send({ presets });
  });

  /**
   * GET /companions/presets/:archetype - Get a single preset (public)
   */
  app.get('/presets/:archetype', async (request: FastifyRequest, reply: FastifyReply) => {
    const { archetype } = request.params as { archetype: string };
    const preset = getArchetypePreset(archetype);

    if (!preset) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `No preset found for archetype "${archetype}"`,
      });
    }

    return reply.send(mapPresetResponse(preset));
  });

  /**
   * POST /companions/from-preset - Create a companion from a preset
   */
  app.post(
    '/from-preset',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateFromPresetSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid request body',
          details: parseResult.error.issues,
        });
      }

      const input = parseResult.data;

      // Verify the archetype exists
      if (!ARCHETYPE_PRESETS[input.archetype]) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: `Unknown archetype "${input.archetype}". Valid archetypes: ${Object.keys(ARCHETYPE_PRESETS).join(', ')}`,
        });
      }

      const spec = buildSpecFromPreset(input);

      const companion = await companionRepo.create({
        user_id: request.user!.userId,
        name: input.name,
        spec,
        status: 'active',
        is_public: false,
      });

      // Retrieve the archetype's default first message for the response
      const preset = getArchetypePreset(input.archetype)!;
      const firstMessage = selectFirstMessage(preset);

      logger.info(
        {
          companionId: companion.id,
          userId: request.user!.userId,
          archetype: input.archetype,
        },
        'Companion created from preset',
      );

      return reply.status(201).send({
        id: companion.id,
        name: companion.name,
        spec: companion.spec,
        status: companion.status,
        createdAt: companion.created_at,
        firstMessage,
      });
    },
  );
}

// ---------------------------------------------------------------------------
// First message selection
// ---------------------------------------------------------------------------

/**
 * Pick the most contextually appropriate first message from a preset,
 * based on the current time of day.
 */
function selectFirstMessage(
  preset: { firstMessages: { default: string; lateNight: string; morning: string } },
): string {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return preset.firstMessages.morning;
  }
  if (hour >= 22 || hour < 5) {
    return preset.firstMessages.lateNight;
  }
  return preset.firstMessages.default;
}
