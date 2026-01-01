/**
 * Gifts Routes
 * Token management, gift generation, and gift memory handling.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth, requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getGiftsRepository } from '../repositories/gifts.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { getEventStore } from '../db/event-store.js';
import { ValidationError } from '../repositories/errors.js';
import type { JSONObject } from '../db/types.js';

// ============================================================================
// Request Schemas
// ============================================================================

const CreateCheckoutSchema = z.object({
  bundleId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const GenerateGiftSchema = z.object({
  companionId: z.string().uuid(),
  preferredCost: z.enum(['low', 'medium', 'high']).optional().default('medium'),
});

const GenerateGiftFullSchema = z.object({
  companionId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  visualPrompt: z.string().max(2000).optional(),
  emotionalMeaning: z.string().max(1000).optional(),
  tokenCost: z.number().int().positive(),
  generationParams: z.record(z.unknown()).optional(),
  sourceEventId: z.string().uuid().optional(),
  sourceTurnId: z.string().uuid().optional(),
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

const InternalGenerateSchema = z.object({
  userId: z.string().uuid(),
  companionId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  visualPrompt: z.string().max(2000),
  emotionalMeaning: z.string().max(1000).optional(),
  tokenCost: z.number().int().positive(),
  generationParams: z.record(z.unknown()).optional(),
  sourceEventId: z.string().uuid().optional(),
  sourceTurnId: z.string().uuid().optional(),
});

const InternalReceiveSchema = z.object({
  giftId: z.string().uuid(),
  imageUrl: z.string().url(),
  s3Bucket: z.string(),
  s3Key: z.string(),
});

const InternalRecallCandidateSchema = z.object({
  userId: z.string().uuid(),
  companionId: z.string().uuid(),
  embedding: z.array(z.number()),
  limit: z.number().int().positive().max(10).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
});

const InternalRecallSchema = z.object({
  cooldownHours: z.number().positive().optional(),
});

const UpdateEmbeddingSchema = z.object({
  embedding: z.array(z.number()).length(1536),
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

  // ==========================================================================
  // Token Endpoints (User-facing)
  // ==========================================================================

  /**
   * GET /gifts/tokens/balance - Get user's token balance
   */
  app.get('/tokens/balance', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getTokenBalance', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const balance = await giftsRepo.getOrCreateTokenBalance(user.userId);

      return reply.send({
        success: true,
        data: {
          balance: balance.balance,
          lifetimePurchased: balance.lifetime_purchased,
          lifetimeBonus: balance.lifetime_bonus,
          lifetimeSpent: balance.lifetime_spent,
          currentPeriodBonus: balance.current_period_bonus,
          bonusGrantedAt: balance.bonus_granted_at?.toISOString() ?? null,
        },
      });
    });
  });

  /**
   * GET /gifts/tokens/bundles - Get available token bundles
   */
  app.get('/tokens/bundles', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.listTokenBundles', async () => {
      const bundles = await giftsRepo.listActiveBundles();

      return reply.send({
        success: true,
        data: bundles.map(bundle => ({
          id: bundle.id,
          name: bundle.name,
          description: bundle.description,
          tokens: bundle.tokens,
          priceCents: bundle.price_cents,
          currency: bundle.currency,
          bonusTokens: bundle.bonus_tokens,
          totalTokens: bundle.tokens + bundle.bonus_tokens,
          displayOrder: bundle.display_order,
        })),
      });
    });
  });

  /**
   * POST /gifts/tokens/checkout - Create Stripe checkout session for token purchase
   */
  app.post('/tokens/checkout', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.createTokenCheckout', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = CreateCheckoutSchema.safeParse(request.body);
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

      const { bundleId, successUrl, cancelUrl } = parseResult.data;

      // Get bundle
      const bundle = await giftsRepo.findBundleById(bundleId);
      if (!bundle) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'BUNDLE_NOT_FOUND',
            message: 'Token bundle not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (!bundle.is_active) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BUNDLE_INACTIVE',
            message: 'Token bundle is no longer available',
            timestamp: new Date().toISOString(),
          },
        });
      }

      logger.info({ userId: user.userId, bundleId, tokens: bundle.tokens }, 'Token checkout requested');

      // TODO: Implement Stripe integration
      // - Get or create Stripe customer for user
      // - Create Stripe checkout session with bundle.stripe_price_id
      // - Return checkout URL

      // Emit checkout event
      const checkoutTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: null,
        turnId: null,
        traceId: checkoutTraceId,
        type: 'gifts.checkout_started',
        payload: {
          bundleId,
          tokens: bundle.tokens,
          bonusTokens: bundle.bonus_tokens,
          priceCents: bundle.price_cents,
        },
        version: '1.0',
        causationId: null,
        correlationId: checkoutTraceId,
      });

      // Stub response - would return actual Stripe checkout URL
      return reply.status(201).send({
        success: true,
        data: {
          checkoutUrl: `https://checkout.stripe.com/c/pay/stub_${nanoid()}`,
          sessionId: `cs_${nanoid()}`,
          bundle: {
            id: bundle.id,
            name: bundle.name,
            tokens: bundle.tokens,
            bonusTokens: bundle.bonus_tokens,
            totalTokens: bundle.tokens + bundle.bonus_tokens,
            priceCents: bundle.price_cents,
          },
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
      });
    });
  });

  /**
   * GET /gifts/tokens/transactions - List user's token transactions
   */
  app.get('/tokens/transactions', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.listTokenTransactions', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };

      const result = await giftsRepo.listTokenTransactions(user.userId, {
        limit: Math.min(parseInt(limit), 100),
        offset: parseInt(offset),
      });

      return reply.send({
        success: true,
        data: {
          items: result.data.map(tx => ({
            id: tx.id,
            type: tx.transaction_type,
            amount: tx.amount,
            balanceAfter: tx.balance_after,
            description: tx.description,
            giftId: tx.gift_id,
            createdAt: tx.created_at.toISOString(),
          })),
          hasMore: result.hasMore,
        },
      });
    });
  });

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

      // Get companion name for placeholder
      const companionName = companion.spec?.identity?.name ?? 'your companion';

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

      // Emit gift.generation_started event (workers will pick this up for AI generation)
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

      // For now, immediately mark as ready with placeholder content
      // In production, a worker would process the event and call orchestrator for AI generation
      const readyGift = await giftsRepo.updateGiftStatus(gift.id, 'ready');

      return reply.status(201).send({
        success: true,
        data: {
          gift: {
            id: readyGift.id,
            name: readyGift.name,
            description: readyGift.description,
            imageUrl: readyGift.image_url,
            tokenCost: readyGift.token_cost,
            emotionalMeaning: readyGift.emotional_meaning,
            status: readyGift.status,
            givenAt: readyGift.given_at?.toISOString() ?? null,
            createdAt: readyGift.created_at.toISOString(),
          },
        },
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

  // ==========================================================================
  // Internal Endpoints (Service-to-service)
  // ==========================================================================

  /**
   * POST /gifts/internal/generate - Internal: Create gift from orchestrator
   */
  app.post('/internal/generate', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.generate', async (span) => {
      const parseResult = InternalGenerateSchema.safeParse(request.body);
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

      const data = parseResult.data;
      span.setAttributes({ 'user.id': data.userId, 'companion.id': data.companionId });

      // Create the gift record
      const gift = await giftsRepo.createGift({
        user_id: data.userId,
        companion_id: data.companionId,
        name: data.name,
        description: data.description,
        visual_prompt: data.visualPrompt,
        emotional_meaning: data.emotionalMeaning,
        token_cost: data.tokenCost,
        status: 'generating',
        generation_params: (data.generationParams ?? null) as JSONObject | null,
        source_event_id: data.sourceEventId,
        source_turn_id: data.sourceTurnId,
      });

      logger.info({ giftId: gift.id, userId: data.userId }, 'Internal gift generation started');

      return reply.status(201).send({
        success: true,
        data: {
          id: gift.id,
          status: gift.status,
          visualPrompt: gift.visual_prompt,
        },
      });
    });
  });

  /**
   * POST /gifts/internal/receive - Internal: Mark gift as received with image
   */
  app.post('/internal/receive', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.receive', async (span) => {
      const parseResult = InternalReceiveSchema.safeParse(request.body);
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

      const { giftId, imageUrl, s3Bucket, s3Key } = parseResult.data;
      span.setAttributes({ 'gift.id': giftId });

      const gift = await giftsRepo.findGiftById(giftId);
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

      const updatedGift = await giftsRepo.setGiftImage(giftId, imageUrl, s3Bucket, s3Key);

      logger.info({ giftId }, 'Gift image received and saved');

      return reply.send({
        success: true,
        data: {
          id: updatedGift.id,
          status: updatedGift.status,
          imageUrl: updatedGift.image_url,
        },
      });
    });
  });

  /**
   * POST /gifts/internal/recall-candidate - Internal: Find gift memories for recall
   */
  app.post('/internal/recall-candidate', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.recallCandidate', async (span) => {
      const parseResult = InternalRecallCandidateSchema.safeParse(request.body);
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

      const { userId, companionId, embedding, limit = 5, minSimilarity = 0.7 } = parseResult.data;
      span.setAttributes({ 'user.id': userId, 'companion.id': companionId });

      const results = await giftsRepo.searchByEmbedding(
        userId,
        companionId,
        embedding,
        limit,
        minSimilarity
      );

      return reply.send({
        success: true,
        data: results.map(memory => ({
          id: memory.id,
          giftId: memory.gift_id,
          giftName: memory.giftName,
          giftImageUrl: memory.giftImageUrl,
          memoryContent: memory.memory_content,
          similarity: memory.similarity,
          timesRecalled: memory.times_recalled,
          lastRecalledAt: memory.last_recalled_at?.toISOString() ?? null,
        })),
      });
    });
  });

  /**
   * GET /gifts/internal/significant - Internal: Get significant gifts for a user-companion pair
   */
  app.get('/internal/significant', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.getSignificant', async (span) => {
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

      const gifts = await giftsRepo.getSignificantGifts(userId, companionId, parseInt(limit));

      return reply.send({
        success: true,
        data: gifts.map(gift => ({
          id: gift.id,
          name: gift.name,
          description: gift.description,
          emotionalMeaning: gift.emotional_meaning,
          imageUrl: gift.image_url,
          givenAt: gift.given_at?.toISOString(),
        })),
      });
    });
  });

  /**
   * POST /gifts/internal/:giftId/recall - Internal: Record a gift memory recall
   */
  app.post('/internal/:giftId/recall', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.recordRecall', async (span) => {
      const { giftId } = request.params as { giftId: string };
      span.setAttributes({ 'gift.id': giftId });

      const parseResult = InternalRecallSchema.safeParse(request.body);
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

      const { cooldownHours = 24 } = parseResult.data;

      // Find the memory for this gift
      const memory = await giftsRepo.findGiftMemoryByGiftId(giftId);
      if (!memory) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'MEMORY_NOT_FOUND',
            message: 'Gift memory not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const updatedMemory = await giftsRepo.recordRecall(memory.id, cooldownHours);

      logger.debug({ giftId, memoryId: memory.id, timesRecalled: updatedMemory.times_recalled }, 'Gift memory recalled');

      return reply.send({
        success: true,
        data: {
          memoryId: updatedMemory.id,
          timesRecalled: updatedMemory.times_recalled,
          lastRecalledAt: updatedMemory.last_recalled_at?.toISOString(),
          recallCooldownUntil: updatedMemory.recall_cooldown_until?.toISOString(),
        },
      });
    });
  });

  /**
   * POST /gifts/internal/:giftId/embedding - Internal: Update gift memory embedding
   */
  app.post('/internal/:giftId/embedding', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.updateEmbedding', async (span) => {
      const { giftId } = request.params as { giftId: string };
      span.setAttributes({ 'gift.id': giftId });

      const parseResult = UpdateEmbeddingSchema.safeParse(request.body);
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

      const { embedding } = parseResult.data;

      // Find the memory for this gift
      const memory = await giftsRepo.findGiftMemoryByGiftId(giftId);
      if (!memory) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'MEMORY_NOT_FOUND',
            message: 'Gift memory not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const updatedMemory = await giftsRepo.updateEmbedding(memory.id, embedding);

      logger.debug({ giftId, memoryId: memory.id }, 'Gift memory embedding updated');

      return reply.send({
        success: true,
        data: {
          memoryId: updatedMemory.id,
          hasEmbedding: updatedMemory.embedding !== null,
        },
      });
    });
  });
}
