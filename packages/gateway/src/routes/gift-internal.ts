/**
 * Gift Internal Routes
 * Internal service-to-service endpoints for gift generation, recall, and management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getGiftsRepository } from '../repositories/gifts.js';
import { getEventStore } from '../db/event-store.js';
import type { JSONObject } from '../db/types.js';

// ============================================================================
// Request Schemas
// ============================================================================

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

const InternalUpdateGiftSchema = z.object({
  giftId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000),
  visualPrompt: z.string().max(2000),
  emotionalMeaning: z.string().max(1000),
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
 * Register gift internal routes
 */
export async function giftInternalRoutes(app: FastifyInstance): Promise<void> {
  const giftsRepo = getGiftsRepository();
  const eventStore = getEventStore();

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
   * POST /gifts/internal/update-gift - Internal: Update gift content and image
   * Used by workers to complete gift generation
   */
  app.post('/internal/update-gift', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.updateGift', async (span) => {
      const parseResult = InternalUpdateGiftSchema.safeParse(request.body);
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

      const { giftId, name, description, visualPrompt, emotionalMeaning, imageUrl, s3Bucket, s3Key } = parseResult.data;
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

      const updatedGift = await giftsRepo.updateGiftWithContent(giftId, {
        name,
        description,
        visualPrompt,
        emotionalMeaning,
        imageUrl,
        s3Bucket,
        s3Key,
      });

      logger.info({ giftId }, 'Gift generation completed');

      return reply.send({
        success: true,
        data: {
          id: updatedGift.id,
          name: updatedGift.name,
          description: updatedGift.description,
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


  /**
   * POST /gifts/internal/eligible-for-recall - Internal: Find gifts eligible for recall
   */
  app.post('/internal/eligible-for-recall', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.eligibleForRecall', async (span) => {
      const parseResult = z.object({
        userId: z.string().uuid(),
        companionId: z.string().uuid(),
        maxCreatedAt: z.string().optional(),
        context: z.string().optional(),
        limit: z.number().int().positive().max(20).optional(),
      }).safeParse(request.body);

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

      const { userId, companionId, limit = 5 } = parseResult.data;
      span.setAttributes({ 'user.id': userId, 'companion.id': companionId });

      // Get gift history - these are all "given" gifts eligible for recall
      const result = await giftsRepo.getGiftHistory(userId, companionId, {
        limit,
        offset: 0,
      });

      // Filter to gifts that haven't been recalled too recently
      // For now, return all given gifts - the orchestrator handles recall timing
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
        data: {
          gifts,
        },
      });
    });
  });

  /**
   * POST /gifts/internal/acknowledge - Internal: Acknowledge a gift from the user
   */
  app.post('/internal/acknowledge', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.acknowledge', async (span) => {
      const parseResult = z.object({
        userId: z.string().uuid(),
        companionId: z.string().uuid(),
        sessionId: z.string().uuid(),
        turnId: z.string().uuid(),
        giftDescription: z.string().min(1).max(2000),
        emotionalReaction: z.string(),
        emotionalIntensity: z.number().min(0).max(1),
        direction: z.string(),
      }).safeParse(request.body);

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

      // Create a gift record for user-given gifts (acknowledged by companion)
      const gift = await giftsRepo.createGift({
        user_id: data.userId,
        companion_id: data.companionId,
        name: data.giftDescription.slice(0, 100),
        description: data.giftDescription,
        visual_prompt: null,
        emotional_meaning: `${data.emotionalReaction} (intensity: ${data.emotionalIntensity})`,
        token_cost: 0, // User-given gifts don't cost tokens
        status: 'given',
        generation_params: {
          direction: data.direction,
          sessionId: data.sessionId,
          turnId: data.turnId,
        } as JSONObject,
        source_event_id: null,
        source_turn_id: data.turnId,
      });

      // Mark as given immediately
      const givenGift = await giftsRepo.markGiftGiven(gift.id);

      logger.info(
        { giftId: gift.id, userId: data.userId, companionId: data.companionId },
        'Gift acknowledged from user'
      );

      // Emit gift.acknowledged event
      const eventTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: data.userId,
        sessionId: data.sessionId,
        turnId: data.turnId,
        traceId: eventTraceId,
        type: 'gift.acknowledged',
        payload: {
          giftId: gift.id,
          companionId: data.companionId,
          description: data.giftDescription,
          emotionalReaction: data.emotionalReaction,
          emotionalIntensity: data.emotionalIntensity,
          direction: data.direction,
        },
        version: '1.0',
        causationId: null,
        correlationId: eventTraceId,
      });

      return reply.status(201).send({
        success: true,
        data: {
          id: givenGift.id,
          name: givenGift.name,
          status: givenGift.status,
          givenAt: givenGift.given_at?.toISOString(),
        },
      });
    });
  });
}
