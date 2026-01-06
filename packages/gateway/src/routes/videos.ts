/**
 * Videos Routes
 * Video request management for companion video messages.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getVideosRepository } from '../repositories/videos.js';
import { getGiftsRepository } from '../repositories/gifts.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { enqueueVideoGenerationJob } from '../utils/queue.js';
import { env } from '../env.js';

// ============================================================================
// Constants
// ============================================================================

const VIDEO_TOKEN_COST = 100;

// ============================================================================
// Request Schemas
// ============================================================================

const CreateVideoRequestSchema = z.object({
  companionId: z.string().uuid(),
  prompt: z.string().min(10).max(500),
  sessionId: z.string().uuid().optional(),
});

const ListVideosQuerySchema = z.object({
  status: z.string().optional(),
  companionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const ListMediaQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ============================================================================
// Routes
// ============================================================================

export async function videosRoutes(app: FastifyInstance): Promise<void> {
  const videosRepo = getVideosRepository();
  const giftsRepo = getGiftsRepository();
  const companionsRepo = getCompanionsRepository();

  /**
   * POST /videos/request - Create a new video request
   * Deducts tokens and queues video generation
   */
  app.post('/request', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('videos.createRequest', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = CreateVideoRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
          },
        });
      }

      const { companionId, prompt, sessionId } = parseResult.data;
      span.setAttributes({ 'companion.id': companionId });

      // 1. Verify companion exists and belongs to user
      const companion = await companionsRepo.findById(companionId);
      if (!companion || companion.user_id !== user.userId) {
        return reply.status(404).send({
          error: {
            code: 'COMPANION_NOT_FOUND',
            message: 'Companion not found',
          },
        });
      }

      // 2. Check token balance first (before creating request)
      const tokenBalance = await giftsRepo.getOrCreateTokenBalance(user.userId);
      if (tokenBalance.balance < VIDEO_TOKEN_COST) {
        return reply.status(402).send({
          error: {
            code: 'INSUFFICIENT_TOKENS',
            message: `Insufficient tokens. Required: ${VIDEO_TOKEN_COST}, Available: ${tokenBalance.balance}`,
            required: VIDEO_TOKEN_COST,
            balance: tokenBalance.balance,
          },
        });
      }

      // 3. Create the video request
      const videoRequest = await videosRepo.createVideoRequest({
        user_id: user.userId,
        companion_id: companionId,
        session_id: sessionId ?? null,
        prompt,
        token_cost: VIDEO_TOKEN_COST,
      });

      // 4. Deduct tokens atomically (pass null for gift_id since video requests aren't gifts)
      const deductResult = await giftsRepo.deductTokens(
        user.userId,
        VIDEO_TOKEN_COST,
        null,
        `Video request: ${prompt.slice(0, 50)}...`
      );

      if (!deductResult.success) {
        // Rollback: mark video request as failed
        await videosRepo.updateStatus(videoRequest.id, 'failed', 'Token deduction failed');
        return reply.status(402).send({
          error: {
            code: 'TOKEN_DEDUCTION_FAILED',
            message: deductResult.errorMessage ?? 'Failed to deduct tokens',
            required: VIDEO_TOKEN_COST,
          },
        });
      }

      // 5. Get companion's identity anchor for character consistency
      let referenceImageUrl: string | undefined;
      let referenceImageS3Key: string | undefined;
      let referenceImageS3Bucket: string | undefined;
      try {
        const anchors = await companionsRepo.getAllIdentityAnchors(companionId);
        if (anchors.length > 0) {
          // Pick the neutral anchor or first available
          const neutralAnchor = anchors.find(a =>
            (a.metadata as Record<string, unknown>)?.emotionalState === 'neutral'
          ) || anchors[0];
          if (neutralAnchor) {
            const metadata = neutralAnchor.metadata as Record<string, unknown> | null | undefined;
            referenceImageUrl = neutralAnchor.asset_url;
            referenceImageS3Key =
              neutralAnchor.s3_key ||
              (metadata?.['s3_key'] as string | undefined) ||
              (metadata?.['s3Key'] as string | undefined);
            referenceImageS3Bucket =
              neutralAnchor.s3_bucket ||
              (metadata?.['s3_bucket'] as string | undefined) ||
              (metadata?.['s3Bucket'] as string | undefined) ||
              env.S3_MEDIA_BUCKET;
          }
        }
      } catch (error) {
        logger.warn({ companionId, error }, 'Failed to get identity anchor for video');
      }

      // 6. Enqueue video generation job
      const enqueued = await enqueueVideoGenerationJob({
        videoRequestId: videoRequest.id,
        userId: user.userId,
        companionId,
        prompt,
        referenceImageUrl,
        referenceImageS3Key,
        referenceImageS3Bucket,
        durationSeconds: videoRequest.duration_seconds,
        width: videoRequest.width,
        height: videoRequest.height,
        fps: videoRequest.fps,
      });

      if (!enqueued) {
        logger.warn({ videoRequestId: videoRequest.id }, 'Failed to enqueue video job, will be processed later');
      }

      logger.info({
        videoRequestId: videoRequest.id,
        userId: user.userId,
        companionId,
        tokensCost: VIDEO_TOKEN_COST,
      }, 'Video request created');

      return reply.status(201).send({
        videoRequestId: videoRequest.id,
        status: 'pending',
        tokensCost: VIDEO_TOKEN_COST,
        newBalance: deductResult.newBalance,
      });
    });
  });

  /**
   * GET /videos/:id - Get video request details
   */
  app.get<{ Params: { id: string } }>('/:id', { preHandler: requireAuth }, async (request, reply) => {
    return withSpan('videos.getById', async (span) => {
      const user = request.user!;
      const { id } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'video.id': id });

      const video = await videosRepo.findByIdWithCompanion(id, user.userId);
      if (!video) {
        return reply.status(404).send({
          error: {
            code: 'VIDEO_NOT_FOUND',
            message: 'Video request not found',
          },
        });
      }

      return reply.send({
        id: video.id,
        companionId: video.companion_id,
        companionName: video.companion_name,
        companionAvatarUrl: video.companion_avatar_url,
        prompt: video.prompt,
        status: video.status,
        videoUrl: video.video_url,
        thumbnailUrl: video.thumbnail_url,
        tokenCost: video.token_cost,
        durationSeconds: video.duration_seconds,
        processingTimeMs: video.processing_time_ms,
        error: video.generation_error,
        createdAt: video.created_at.toISOString(),
        completedAt: video.completed_at?.toISOString() ?? null,
      });
    });
  });

  /**
   * GET /videos - List user's video requests
   */
  app.get('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('videos.list', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = ListVideosQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: parseResult.error.flatten(),
          },
        });
      }

      const { status, companionId, limit, offset } = parseResult.data;

      const result = await videosRepo.listUserVideos(user.userId, {
        status: status ? status.split(',') as Array<'pending' | 'generating' | 'encoding' | 'ready' | 'failed'> : undefined,
        companionId,
        limit,
        offset,
      });

      return reply.send({
        data: result.data.map(video => ({
          id: video.id,
          companionId: video.companion_id,
          companionName: video.companion_name,
          companionAvatarUrl: video.companion_avatar_url,
          prompt: video.prompt,
          status: video.status,
          videoUrl: video.video_url,
          thumbnailUrl: video.thumbnail_url,
          tokenCost: video.token_cost,
          createdAt: video.created_at.toISOString(),
          completedAt: video.completed_at?.toISOString() ?? null,
        })),
        hasMore: result.hasMore,
        limit: result.limit,
        offset: result.offset,
      });
    });
  });

  /**
   * GET /videos/active-count - Get count of videos being generated
   */
  app.get('/active-count', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const count = await videosRepo.getActiveVideoCount(user.userId);
    return reply.send({ count });
  });
}

/**
 * Media Routes - Combined images and videos for Media Gallery
 */
export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const videosRepo = getVideosRepository();

  /**
   * GET /media - List all user media (images + videos)
   */
  app.get('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('media.list', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = ListMediaQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: parseResult.error.flatten(),
          },
        });
      }

      const { limit, offset } = parseResult.data;

      const result = await videosRepo.listAllUserMedia(user.userId, { limit, offset });

      return reply.send({
        data: result.data.map(item => ({
          id: item.id,
          type: item.type,
          url: item.url,
          thumbnailUrl: item.thumbnailUrl,
          status: item.status,
          companionId: item.companionId,
          companionName: item.companionName,
          companionAvatarUrl: item.companionAvatarUrl,
          createdAt: item.createdAt.toISOString(),
        })),
        hasMore: result.hasMore,
        limit: result.limit,
        offset: result.offset,
      });
    });
  });
}
