/**
 * Lip-Sync Routes
 * Generates lip-synced avatar videos using ElevenLabs TTS + FAL live-avatar.
 * Requires authentication.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
import { getFalLipSyncService } from '../services/fal-lip-sync.js';
import { getCompanionIdentityAnchorUrl } from './imagegen-helpers.js';

// Request validation schema
const GenerateLipSyncSchema = z.object({
  text: z.string().min(1).max(2000),
  companionId: z.string().uuid(),
  voiceId: z.string().min(1),
  voiceSettings: z
    .object({
      stability: z.number().min(0).max(1).optional(),
      similarity_boost: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

/**
 * Register lip-sync routes (authentication required)
 */
export async function lipSyncRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /lip-sync/generate
   * Generate a lip-synced video from text for a companion.
   *
   * Body: { text, companionId, voiceId, voiceSettings? }
   * Returns: { success, data: { videoUrl, duration } }
   */
  app.post('/generate', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = GenerateLipSyncSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parseResult.error.flatten(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const { text, companionId, voiceId, voiceSettings } = parseResult.data;

    // Check required API keys
    if (!env.FAL_API_KEY) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Lip-sync service not configured (missing FAL_API_KEY)',
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (!env.ELEVENLABS_API_KEY) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Lip-sync service not configured (missing ELEVENLABS_API_KEY)',
          timestamp: new Date().toISOString(),
        },
      });
    }

    try {
      // Look up companion's identity anchor avatar URL
      const companionImageUrl = await getCompanionIdentityAnchorUrl(companionId);
      if (!companionImageUrl) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COMPANION_AVATAR_NOT_FOUND',
            message: 'No identity anchor avatar found for this companion',
            timestamp: new Date().toISOString(),
          },
        });
      }

      logger.info(
        { companionId, voiceId, textLength: text.length },
        'Generating lip-sync video'
      );

      const service = getFalLipSyncService(env.FAL_API_KEY, env.ELEVENLABS_API_KEY);
      const result = await service.generateLipSyncVideo(
        text,
        voiceId,
        companionImageUrl,
        voiceSettings
      );

      return reply.send({
        success: true,
        data: {
          videoUrl: result.videoUrl,
          duration: result.durationSeconds,
        },
      });
    } catch (error) {
      logger.error({ err: error, companionId, voiceId }, 'Lip-sync generation failed');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'LIP_SYNC_GENERATION_FAILED',
          message: 'Failed to generate lip-sync video',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });
}
