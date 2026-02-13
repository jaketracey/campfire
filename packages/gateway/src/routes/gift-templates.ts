/**
 * Gift Template Routes
 * User-facing gift template browsing and usage.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getGiftsRepository } from '../repositories/gifts.js';
import { getGiftTemplatesRepository } from '../repositories/gift-templates.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { getEventStore } from '../db/event-store.js';
import { getCreatorEarningsService } from '../services/creator-earnings.js';
import type { JSONObject } from '../db/types.js';

// ============================================================================
// Request Schemas
// ============================================================================

// Gift template schemas
const ListTemplatesQuerySchema = z.object({
  category: z.enum([
    'romantic', 'friendship', 'celebration', 'comfort', 'gratitude',
    'playful', 'thoughtful', 'mystical', 'nature', 'artistic', 'other'
  ]).optional(),
  tier: z.enum(['low', 'medium', 'high']).optional(),
  sort: z.enum(['popular', 'trending', 'recent']).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).optional(),
  /** Filter templates to those generated for this companion or marked as public */
  companionId: z.string().uuid().optional(),
});

const SendFromTemplateSchema = z.object({
  templateId: z.string().uuid(),
  companionId: z.string().uuid(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Register gift template routes
 */
export async function giftTemplateRoutes(app: FastifyInstance): Promise<void> {
  const giftsRepo = getGiftsRepository();
  const templatesRepo = getGiftTemplatesRepository();
  const companionsRepo = getCompanionsRepository();
  const eventStore = getEventStore();
  const creatorEarnings = getCreatorEarningsService();

  // ==========================================================================
  // Gift Template Endpoints (Global Library)
  // ==========================================================================

  /**
   * GET /gifts/templates - List gift templates from the global library
   */
  app.get('/templates', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.listTemplates', async (span) => {
      const parseResult = ListTemplatesQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { category, tier, sort = 'popular', limit = 20, offset = 0, companionId } = parseResult.data;
      span.setAttributes({
        'templates.category': category ?? 'all',
        'templates.tier': tier ?? 'all',
        'templates.sort': sort,
        'templates.companionId': companionId ?? 'all',
      });

      const result = await templatesRepo.listTemplates({
        category: category as import('../db/types.js').GiftTemplateCategory | undefined,
        tier,
        sort,
        companionId,
        limit: Math.min(limit, 50),
        offset,
      });

      return reply.send({
        success: true,
        data: {
          templates: result.data.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            emotionalMeaning: t.emotional_meaning,
            imageUrl: t.image_url,
            category: t.category,
            tokenCost: t.token_cost,
            tier: t.tier,
            totalSends: t.total_sends,
            sendsLast7Days: t.sends_last_7_days,
          })),
          hasMore: result.hasMore,
          total: result.total,
        },
      });
    });
  });

  /**
   * GET /gifts/templates/:templateId - Get a specific template
   */
  app.get('/templates/:templateId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getTemplate', async (span) => {
      const { templateId } = request.params as { templateId: string };
      span.setAttributes({ 'template.id': templateId });

      const template = await templatesRepo.findById(templateId);
      if (!template) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'TEMPLATE_NOT_FOUND',
            message: 'Gift template not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      return reply.send({
        success: true,
        data: {
          id: template.id,
          name: template.name,
          description: template.description,
          emotionalMeaning: template.emotional_meaning,
          imageUrl: template.image_url,
          category: template.category,
          tokenCost: template.token_cost,
          tier: template.tier,
          totalSends: template.total_sends,
          sendsLast7Days: template.sends_last_7_days,
          createdAt: template.created_at.toISOString(),
        },
      });
    });
  });

  /**
   * POST /gifts/from-template - Send a gift from a template (instant, no generation)
   */
  app.post('/from-template', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.sendFromTemplate', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = SendFromTemplateSchema.safeParse(request.body);
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

      const { templateId, companionId } = parseResult.data;
      span.setAttributes({ 'template.id': templateId, 'companion.id': companionId });

      // Verify template exists
      const template = await templatesRepo.findById(templateId);
      if (!template || template.status !== 'active') {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'TEMPLATE_NOT_FOUND',
            message: 'Gift template not found or unavailable',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Verify companion ownership
      const companion = await companionsRepo.findById(companionId);
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

      // Create gift record from template
      const gift = await giftsRepo.createGift({
        user_id: user.userId,
        companion_id: companionId,
        name: template.name,
        description: template.description,
        visual_prompt: template.visual_prompt,
        emotional_meaning: template.emotional_meaning,
        token_cost: template.token_cost,
        status: 'ready',
        generation_params: { templateId } as JSONObject,
      });

      // Set the image from template and link to template
      await giftsRepo.setGiftImage(
        gift.id,
        template.image_url,
        template.s3_bucket ?? '',
        template.s3_key ?? ''
      );

      // Deduct tokens
      const deductResult = await giftsRepo.deductTokens(
        user.userId,
        template.token_cost,
        gift.id,
        `Gift: ${template.name}`
      );

      if (!deductResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'TOKEN_DEDUCTION_FAILED',
            message: deductResult.errorMessage ?? 'Insufficient tokens',
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (deductResult.transactionId) {
        await creatorEarnings.recordTokenSpend({
          tokenTransactionId: deductResult.transactionId,
          spenderUserId: user.userId,
          creatorUserId: companion.user_id,
          companionId,
          sessionId: null,
          feature: 'gift',
          tokensSpent: template.token_cost,
          metadata: { giftId: gift.id, templateId },
        });
      }

      // Mark gift as given
      const givenGift = await giftsRepo.markGiftGiven(gift.id);

      // Increment template popularity
      await templatesRepo.incrementPopularity(templateId);

      // Create gift memory
      const memoryContent = `${template.name}: ${template.description ?? 'A special gift'}. ${template.emotional_meaning ?? 'Given with love and care.'}`;
      const memory = await giftsRepo.createGiftMemory({
        gift_id: gift.id,
        user_id: user.userId,
        companion_id: companionId,
        memory_content: memoryContent,
      });

      logger.info(
        { userId: user.userId, giftId: gift.id, templateId, companionId, tokensDeducted: template.token_cost },
        'Gift sent from template'
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
          giftId: gift.id,
          templateId,
          companionId,
          name: template.name,
          tokenCost: template.token_cost,
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
            id: givenGift.id,
            name: givenGift.name,
            status: givenGift.status,
            givenAt: givenGift.given_at?.toISOString(),
          },
          memory: {
            id: memory.id,
            content: memory.memory_content,
          },
          tokensDeducted: template.token_cost,
          newBalance: deductResult.newBalance,
        },
      });
    });
  });

  /**
   * GET /gifts/templates/categories/counts - Get template counts by category
   */
  app.get('/templates/categories/counts', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getCategoryCounts', async () => {
      const counts = await templatesRepo.getCountsByCategory();

      return reply.send({
        success: true,
        data: { counts },
      });
    });
  });
}
