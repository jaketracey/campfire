/**
 * Gifts Routes
 * Core gift generation and management (user-facing).
 * Token, internal, and template routes are in separate modules.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { requireAuth, requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getGiftsRepository } from '../repositories/gifts.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { getEventStore } from '../db/event-store.js';
import { ValidationError } from '../repositories/errors.js';
import { enqueueGiftGenerationJob } from '../utils/queue.js';
import { getCreatorEarningsService } from '../services/creator-earnings.js';
import type { JSONObject } from '../db/types.js';
import { giftTokensRoutes } from './gift-tokens.js';
import { giftInternalRoutes } from './gift-internal.js';
import { giftTemplateRoutes } from './gift-templates.js';

// ============================================================================
// Request Schemas
// ============================================================================

const GenerateGiftSchema = z.object({
  companionId: z.string().uuid(),
  preferredCost: z.enum(['low', 'medium', 'high']).optional().default('medium'),
});

// Token cost tiers for AI-generated gifts
const GIFT_COST_TIERS = {
  low: 10,
  medium: 25,
  high: 50,
} as const;

const GiveGiftSchema = z.object({
  memoryContent: z.string().min(1).max(2000).optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Register gifts routes
 */
export async function giftsRoutes(app: FastifyInstance): Promise<void> {
  const giftsRepo = getGiftsRepository();
  const companionsRepo = getCompanionsRepository();
  const eventStore = getEventStore();
  const creatorEarnings = getCreatorEarningsService();

  // Register sub-route modules
  await app.register(giftTokensRoutes);
  await app.register(giftInternalRoutes);
  await app.register(giftTemplateRoutes);

  // ==========================================================================
  // Gift Endpoints (User-facing)
  // ==========================================================================

  /**
   * POST /gifts/generate - Create a new AI-generated gift (starts generation)
   * This is the user-facing endpoint that takes just companionId and optional preferredCost.
   * The gift content will be AI-generated asynchronously.
   */
  app.post('/generate', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.generateGift', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = GenerateGiftSchema.safeParse(request.body);
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

      const { companionId, preferredCost = 'medium' } = parseResult.data;
      const tokenCost = GIFT_COST_TIERS[preferredCost];

      // Double-check UUID format (Zod should catch this, but be safe)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(companionId)) {
        logger.warn({ companionId }, 'Invalid companion ID format in generate gift request');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_COMPANION_ID',
            message: 'Invalid companion ID format',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Verify companion ownership
      let companion;
      try {
        companion = await companionsRepo.findById(companionId);
      } catch (dbError) {
        // Handle ValidationError from repository (invalid UUID format)
        if (dbError instanceof ValidationError) {
          logger.warn({ companionId, error: dbError.message }, 'Invalid companion ID format in repository');
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_COMPANION_ID',
              message: 'Invalid companion ID format',
              timestamp: new Date().toISOString(),
            },
          });
        }
        logger.error({ companionId, error: dbError }, 'Database error looking up companion');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_COMPANION_ID',
            message: 'Invalid companion ID',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const isOwner = companion?.user_id === user.userId;
      const canUsePublic = Boolean(companion?.is_public) && companion?.status === 'active';
      if (!companion || (!isOwner && !canUsePublic)) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COMPANION_NOT_FOUND',
            message: 'Companion not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Get companion name for placeholder
      const companionName = companion.spec?.identity?.name ?? 'your companion';

      // Check for existing generating gift for this user/companion
      const existingGifts = await giftsRepo.listUserGifts(user.userId, {
        companionId,
        status: ['generating'],
        limit: 1,
      });

      if (existingGifts.data.length > 0) {
        const existingGift = existingGifts.data[0];
        const ageMs = Date.now() - existingGift.created_at.getTime();
        const GENERATION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

        if (ageMs < GENERATION_TIMEOUT_MS) {
          // Return the existing generating gift - don't create duplicates
          return reply.status(409).send({
            success: false,
            error: {
              code: 'GIFT_GENERATION_IN_PROGRESS',
              message: 'A gift is already being generated for this companion',
              timestamp: new Date().toISOString(),
            },
            data: {
              gift: {
                id: existingGift.id,
                status: existingGift.status,
                createdAt: existingGift.created_at.toISOString(),
              },
            },
          });
        } else {
          // Stale generation - mark as failed and allow new request
          logger.warn(
            { giftId: existingGift.id, ageMs },
            'Marking stale generating gift as failed'
          );
          await giftsRepo.updateGiftStatus(existingGift.id, 'failed');
        }
      }

      // Create the gift record with placeholder content (AI will generate the real content)
      const gift = await giftsRepo.createGift({
        user_id: user.userId,
        companion_id: companionId,
        name: `Gift for ${companionName}`,
        description: 'Generating your special gift...',
        visual_prompt: null,
        emotional_meaning: 'A heartfelt gift being created just for you',
        token_cost: tokenCost,
        status: 'generating',
        generation_params: { preferredCost, tier: preferredCost } as JSONObject,
        source_event_id: null,
        source_turn_id: null,
      });

      logger.info(
        { userId: user.userId, giftId: gift.id, companionId, tokenCost, tier: preferredCost },
        'Gift generation started'
      );

      // Emit gift.generation_started event (for audit trail)
      const eventTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: null,
        turnId: null,
        traceId: eventTraceId,
        type: 'gift.generation_started',
        payload: {
          giftId: gift.id,
          companionId,
          companionName,
          tokenCost,
          tier: preferredCost,
        },
        version: '1.0',
        causationId: null,
        correlationId: eventTraceId,
      });

      // Enqueue job for worker to generate gift content and image
      await enqueueGiftGenerationJob({
        giftId: gift.id,
        userId: user.userId,
        companionId,
        companionName,
        companionBackstory: undefined, // Backstory is stored in KG, not spec - worker can fetch if needed
        companionPersonality: companion.spec?.personality?.traits ?? undefined,
        tokenCost,
        tier: preferredCost,
      });

      // Return 202 Accepted - gift is being generated async
      // Client should poll GET /gifts/:giftId to check status
      return reply.status(202).send({
        success: true,
        data: {
          gift: {
            id: gift.id,
            name: gift.name,
            description: gift.description,
            tokenCost: gift.token_cost,
            status: gift.status,
            createdAt: gift.created_at.toISOString(),
          },
          message: 'Gift generation started. Poll GET /gifts/:giftId to check status.',
        },
      });
    });
  });

  /**
   * GET /gifts/internal - Internal: List gifts for a user-companion pair
   * NOTE: This route MUST be registered before /:giftId to avoid route conflicts
   */
  app.get('/internal', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.list', async (span) => {
      const { userId, companionId, limit = '5' } = request.query as {
        userId?: string;
        companionId?: string;
        limit?: string;
      };

      if (!userId || !companionId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'MISSING_PARAMS',
            message: 'userId and companionId are required',
            timestamp: new Date().toISOString(),
          },
        });
      }

      span.setAttributes({ 'user.id': userId, 'companion.id': companionId });

      const result = await giftsRepo.getGiftHistory(userId, companionId, {
        limit: Math.min(parseInt(limit), 20),
        offset: 0,
      });

      const gifts = result.data.map(gift => ({
        id: gift.id,
        title: gift.name,
        description: gift.description,
        emotionalMeaning: gift.emotional_meaning,
        direction: 'from_user',
        giftType: 'generated',
        createdAt: gift.created_at.toISOString(),
        givenAt: gift.given_at?.toISOString(),
        emotionalSignificance: 0.5,
      }));

      return reply.send({
        success: true,
        data: { gifts },
      });
    });
  });

  /**
   * GET /gifts/:giftId - Get a specific gift
   */
  app.get('/:giftId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getGift', async (span) => {
      const user = request.user!;
      const { giftId } = request.params as { giftId: string };
      span.setAttributes({ 'user.id': user.userId, 'gift.id': giftId });

      const gift = await giftsRepo.findGiftByIdWithOwnerCheck(giftId, user.userId);
      if (!gift) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'GIFT_NOT_FOUND',
            message: 'Gift not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      return reply.send({
        success: true,
        data: {
          id: gift.id,
          name: gift.name,
          description: gift.description,
          visualPrompt: gift.visual_prompt,
          emotionalMeaning: gift.emotional_meaning,
          imageUrl: gift.image_url,
          companionId: gift.companion_id,
          status: gift.status,
          tokenCost: gift.token_cost,
          generationError: gift.generation_error,
          givenAt: gift.given_at?.toISOString() ?? null,
          createdAt: gift.created_at.toISOString(),
        },
      });
    });
  });

  /**
   * POST /gifts/:giftId/give - Give a gift to companion (deduct tokens, mark given, create memory)
   */
  app.post('/:giftId/give', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.giveGift', async (span) => {
      const user = request.user!;
      const { giftId } = request.params as { giftId: string };
      span.setAttributes({ 'user.id': user.userId, 'gift.id': giftId });

      const parseResult = GiveGiftSchema.safeParse(request.body ?? {});
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

      const { memoryContent: providedMemoryContent } = parseResult.data;

      // Get the gift
      const gift = await giftsRepo.findGiftByIdWithOwnerCheck(giftId, user.userId);
      if (!gift) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'GIFT_NOT_FOUND',
            message: 'Gift not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Check gift status
      if (gift.status !== 'ready') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'GIFT_NOT_READY',
            message: `Gift is not ready to be given. Current status: ${gift.status}`,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Deduct tokens
      const deductResult = await giftsRepo.deductTokens(
        user.userId,
        gift.token_cost,
        gift.id,
        `Gift: ${gift.name}`
      );

      if (!deductResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'TOKEN_DEDUCTION_FAILED',
            message: deductResult.errorMessage ?? 'Failed to deduct tokens',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Attribute spend to the companion creator (for public companions / creator monetization)
      if (deductResult.transactionId) {
        const companion = await companionsRepo.findById(gift.companion_id);
        if (companion) {
          await creatorEarnings.recordTokenSpend({
            tokenTransactionId: deductResult.transactionId,
            spenderUserId: user.userId,
            creatorUserId: companion.user_id,
            companionId: gift.companion_id,
            sessionId: null,
            feature: 'gift',
            tokensSpent: gift.token_cost,
            metadata: { giftId: gift.id },
          });
        }
      }

      // Mark gift as given
      const updatedGift = await giftsRepo.markGiftGiven(giftId);

      // Generate memory content if not provided
      const memoryContent = providedMemoryContent ??
        `${gift.name}: ${gift.description ?? 'A special gift'}. ${gift.emotional_meaning ?? 'Given with love and care.'}`;

      // Create gift memory
      const memory = await giftsRepo.createGiftMemory({
        gift_id: giftId,
        user_id: user.userId,
        companion_id: gift.companion_id,
        memory_content: memoryContent,
      });

      logger.info(
        { userId: user.userId, giftId, companionId: gift.companion_id, tokensDeducted: gift.token_cost },
        'Gift given to companion'
      );

      // Emit gift.given event
      const giftGivenTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: null,
        turnId: null,
        traceId: giftGivenTraceId,
        type: 'gift.given',
        payload: {
          giftId,
          companionId: gift.companion_id,
          name: gift.name,
          tokenCost: gift.token_cost,
          memoryId: memory.id,
          newBalance: deductResult.newBalance,
        },
        version: '1.0',
        causationId: null,
        correlationId: giftGivenTraceId,
      });

      return reply.send({
        success: true,
        data: {
          gift: {
            id: updatedGift.id,
            name: updatedGift.name,
            status: updatedGift.status,
            givenAt: updatedGift.given_at?.toISOString(),
          },
          memory: {
            id: memory.id,
            content: memory.memory_content,
          },
          tokensDeducted: gift.token_cost,
          newBalance: deductResult.newBalance,
        },
      });
    });
  });

  /**
   * GET /gifts/history/:companionId - Get gift history with a companion
   */
  app.get('/history/:companionId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getGiftHistory', async (span) => {
      const user = request.user!;
      const { companionId } = request.params as { companionId: string };
      span.setAttributes({ 'user.id': user.userId, 'companion.id': companionId });

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(companionId)) {
        logger.warn({ companionId }, 'Invalid companion ID format in gift history request');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_COMPANION_ID',
            message: 'Invalid companion ID format',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };

      // Verify companion ownership
      let companion;
      try {
        companion = await companionsRepo.findById(companionId);
      } catch (dbError) {
        // Handle ValidationError from repository (invalid UUID format)
        if (dbError instanceof ValidationError) {
          logger.warn({ companionId, error: dbError.message }, 'Invalid companion ID format in repository');
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_COMPANION_ID',
              message: 'Invalid companion ID format',
              timestamp: new Date().toISOString(),
            },
          });
        }
        logger.error({ companionId, error: dbError }, 'Database error looking up companion');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_COMPANION_ID',
            message: 'Invalid companion ID',
            timestamp: new Date().toISOString(),
          },
        });
      }
      if (!companion || companion.user_id !== user.userId) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COMPANION_NOT_FOUND',
            message: 'Companion not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await giftsRepo.getGiftHistory(user.userId, companionId, {
        limit: Math.min(parseInt(limit), 100),
        offset: parseInt(offset),
      });

      return reply.send({
        success: true,
        data: {
          items: result.data.map(gift => ({
            id: gift.id,
            name: gift.name,
            description: gift.description,
            emotionalMeaning: gift.emotional_meaning,
            imageUrl: gift.image_url,
            tokenCost: gift.token_cost,
            givenAt: gift.given_at?.toISOString(),
          })),
          hasMore: result.hasMore,
        },
      });
    });
  });
}
