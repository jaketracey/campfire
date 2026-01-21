/**
 * Admin Creative Routes
 * API endpoints for ad creative management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAdmin } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import {
  getCreativeService,
  CreateCreativeSchema,
  UpdateCreativeSchema,
} from '../services/creative.js';
import type { UUID } from '../db/types.js';
import { env } from '../env.js';
import { getS3Client, getMediaBucket, getCdnUrl, buildMediaUrl } from '../utils/storage.js';

// S3 configuration - use shared client
const S3_MEDIA_BUCKET = getMediaBucket();
const S3_REGION = env.AWS_REGION;
const S3_CDN_URL = getCdnUrl() || `https://${S3_MEDIA_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
const s3Client = getS3Client();

// ============================================================================
// Request Schemas
// ============================================================================

const ListQuerySchema = z.object({
  limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 20)),
  offset: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 0)),
  status: z.string().optional(),
  companionId: z.string().uuid().optional(),
});

const IdParamSchema = z.object({
  id: z.string().uuid('Invalid creative ID'),
});

const GenerateVideoBodySchema = z.object({
  videoModelId: z.string().optional(),
  videoPrompt: z.string().min(1).max(2000).optional(),
  sourceImageUrl: z.string().url().optional(),
  durationSeconds: z.number().int().min(1).max(30).optional(),
});

const GenerateVoiceoverBodySchema = z.object({
  voiceId: z.string().optional(),
  scriptText: z.string().max(5000).optional(),
});

const UploadCombinedBodySchema = z.object({
  finalVideoUrl: z.string().url(),
  finalVideoS3Key: z.string(),
  fileSizeBytes: z.number().int().min(0),
  durationMs: z.number().int().min(0),
});

const PublishBodySchema = z.object({
  campaignId: z.string().optional(),
  adSetId: z.string().optional(),
});

const PresignUploadBodySchema = z.object({
  creativeId: z.string().uuid(),
  contentType: z.string().default('video/webm'),
  fileSize: z.number().int().min(1),
});

// ============================================================================
// Routes
// ============================================================================

export async function adminCreativeRoutes(app: FastifyInstance): Promise<void> {
  const service = getCreativeService();

  // Apply admin auth to all routes
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // CRUD Endpoints
  // ===========================================================================

  /**
   * POST / - Create a new creative
   */
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = CreateCreativeSchema.parse(request.body);
      const userId = (request as any).userId as UUID | null;

      const creative = await service.createCreative(body, userId, true);

      return reply.status(201).send({
        success: true,
        data: creative,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }
      logger.error({ error }, 'Failed to create creative');
      return reply.status(500).send({
        success: false,
        error: 'Failed to create creative',
      });
    }
  });

  /**
   * GET / - List creatives
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = ListQuerySchema.parse(request.query);

      const result = await service.listCreatives({
        limit: query.limit,
        offset: query.offset,
        status: query.status as any,
        companionId: query.companionId,
        isAdminCreated: true, // Only show admin-created creatives
      });

      return reply.send({
        success: true,
        data: {
          creatives: result.data,
          hasMore: result.hasMore,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list creatives');
      return reply.status(500).send({
        success: false,
        error: 'Failed to list creatives',
      });
    }
  });

  /**
   * GET /:id - Get a creative by ID
   */
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = IdParamSchema.parse(request.params);

      const creative = await service.getCreative(id);
      if (!creative) {
        return reply.status(404).send({
          success: false,
          error: 'Creative not found',
        });
      }

      // Get associated assets
      const assets = await service.getAssetsByCreativeId(id);

      return reply.send({
        success: true,
        data: {
          ...creative,
          assets,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid ID',
        });
      }
      logger.error({ error }, 'Failed to get creative');
      return reply.status(500).send({
        success: false,
        error: 'Failed to get creative',
      });
    }
  });

  /**
   * PATCH /:id - Update a creative
   */
  app.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = IdParamSchema.parse(request.params);
      const body = UpdateCreativeSchema.parse(request.body);

      const creative = await service.updateCreative(id, body);

      return reply.send({
        success: true,
        data: creative,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }
      logger.error({ error }, 'Failed to update creative');
      return reply.status(500).send({
        success: false,
        error: 'Failed to update creative',
      });
    }
  });

  /**
   * DELETE /:id - Delete a creative
   */
  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = IdParamSchema.parse(request.params);

      await service.deleteCreative(id);

      return reply.send({
        success: true,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to delete creative');
      return reply.status(500).send({
        success: false,
        error: 'Failed to delete creative',
      });
    }
  });

  // ===========================================================================
  // Generation Endpoints
  // ===========================================================================

  /**
   * POST /:id/generate/video - Start video generation
   */
  app.post(
    '/:id/generate/video',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = IdParamSchema.parse(request.params);
        const body = GenerateVideoBodySchema.parse(request.body);

        // Update creative with generation params if provided
        if (body.videoModelId || body.videoPrompt || body.sourceImageUrl) {
          await service.updateCreative(id, {
            videoModelId: body.videoModelId,
            videoPrompt: body.videoPrompt,
            sourceImageUrl: body.sourceImageUrl,
            videoDurationSeconds: body.durationSeconds,
          });
        }

        const result = await service.startVideoGeneration(id);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to start video generation';
        logger.error({ error }, 'Failed to start video generation');
        return reply.status(400).send({
          success: false,
          error: errorMessage,
        });
      }
    }
  );

  /**
   * POST /:id/generate/voiceover - Start voiceover generation
   */
  app.post(
    '/:id/generate/voiceover',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = IdParamSchema.parse(request.params);
        const body = GenerateVoiceoverBodySchema.parse(request.body);

        // Update creative with voiceover params if provided
        if (body.voiceId || body.scriptText) {
          await service.updateCreative(id, {
            voiceId: body.voiceId,
            scriptText: body.scriptText,
          });
        }

        const result = await service.startVoiceoverGeneration(id);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to start voiceover generation';
        logger.error({ error }, 'Failed to start voiceover generation');
        return reply.status(400).send({
          success: false,
          error: errorMessage,
        });
      }
    }
  );

  /**
   * GET /:id/status - Get generation status
   */
  app.get(
    '/:id/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = IdParamSchema.parse(request.params);

        const creative = await service.getCreative(id);
        if (!creative) {
          return reply.status(404).send({
            success: false,
            error: 'Creative not found',
          });
        }

        const assets = await service.getAssetsByCreativeId(id);

        return reply.send({
          success: true,
          data: {
            status: creative.status,
            generationStartedAt: creative.generation_started_at,
            generationCompletedAt: creative.generation_completed_at,
            generationError: creative.generation_error,
            videoUrl: creative.video_url,
            voiceoverUrl: creative.voiceover_url,
            finalVideoUrl: creative.final_video_url,
            assets: assets.map((a) => ({
              id: a.id,
              type: a.asset_type,
              status: a.status,
              url: a.url,
              error: a.generation_error,
            })),
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get generation status');
        return reply.status(500).send({
          success: false,
          error: 'Failed to get generation status',
        });
      }
    }
  );

  /**
   * POST /:id/upload-combined - Upload client-combined video
   */
  app.post(
    '/:id/upload-combined',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = IdParamSchema.parse(request.params);
        const body = UploadCombinedBodySchema.parse(request.body);

        const creative = await service.uploadCombinedVideo(id, body);

        return reply.send({
          success: true,
          data: creative,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to upload combined video');
        return reply.status(500).send({
          success: false,
          error: 'Failed to upload combined video',
        });
      }
    }
  );

  // ===========================================================================
  // Publishing Endpoints
  // ===========================================================================

  /**
   * POST /:id/publish/google - Publish to Google Ads
   */
  app.post(
    '/:id/publish/google',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = IdParamSchema.parse(request.params);
        const body = PublishBodySchema.parse(request.body);

        const creative = await service.getCreative(id);
        if (!creative) {
          return reply.status(404).send({
            success: false,
            error: 'Creative not found',
          });
        }

        if (!creative.final_video_url) {
          return reply.status(400).send({
            success: false,
            error: 'Creative must have a final video to publish',
          });
        }

        // TODO: Implement Google Ads upload
        // This requires the Google Ads API client and asset upload

        logger.info({ creativeId: id, campaignId: body.campaignId }, 'Google Ads publish requested');

        return reply.send({
          success: true,
          data: {
            message: 'Google Ads publishing not yet implemented',
            creativeId: id,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to publish to Google Ads');
        return reply.status(500).send({
          success: false,
          error: 'Failed to publish to Google Ads',
        });
      }
    }
  );

  /**
   * POST /:id/publish/facebook - Publish to Facebook Ads
   */
  app.post(
    '/:id/publish/facebook',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = IdParamSchema.parse(request.params);
        const body = PublishBodySchema.parse(request.body);

        const creative = await service.getCreative(id);
        if (!creative) {
          return reply.status(404).send({
            success: false,
            error: 'Creative not found',
          });
        }

        if (!creative.final_video_url) {
          return reply.status(400).send({
            success: false,
            error: 'Creative must have a final video to publish',
          });
        }

        // TODO: Implement Facebook Ads upload
        // This requires the Facebook Marketing API

        logger.info({ creativeId: id, adSetId: body.adSetId }, 'Facebook Ads publish requested');

        return reply.send({
          success: true,
          data: {
            message: 'Facebook Ads publishing not yet implemented',
            creativeId: id,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to publish to Facebook Ads');
        return reply.status(500).send({
          success: false,
          error: 'Failed to publish to Facebook Ads',
        });
      }
    }
  );

  // ===========================================================================
  // Presigned Upload Endpoint
  // ===========================================================================

  /**
   * POST /presign-upload - Get presigned URL for direct S3 upload
   */
  app.post('/presign-upload', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = PresignUploadBodySchema.parse(request.body);

      const timestamp = Date.now();
      const extension = body.contentType === 'video/webm' ? 'webm' : 'mp4';
      const s3Key = `creatives/${body.creativeId}/final-${timestamp}.${extension}`;

      // Generate presigned PUT URL (valid for 15 minutes)
      const uploadUrl = await getSignedUrl(
        s3Client,
        new PutObjectCommand({
          Bucket: S3_MEDIA_BUCKET,
          Key: s3Key,
          ContentType: body.contentType,
          ContentLength: body.fileSize,
        }),
        { expiresIn: 900 }
      );

      const publicUrl = `${S3_CDN_URL}/${s3Key}`;

      logger.info(
        { creativeId: body.creativeId, s3Key, contentType: body.contentType },
        'Generated presigned upload URL for creative'
      );

      return reply.send({
        success: true,
        data: {
          uploadUrl,
          s3Key,
          publicUrl,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }
      logger.error({ error }, 'Failed to generate presigned URL');
      return reply.status(500).send({
        success: false,
        error: 'Failed to generate upload URL',
      });
    }
  });

  // ===========================================================================
  // Video Models Endpoint
  // ===========================================================================

  /**
   * GET /video-models - List available video models
   */
  app.get('/video-models', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const models = service.getVideoModels();

      return reply.send({
        success: true,
        data: {
          models,
          defaultModel: 'fal/kling-1.6-standard',
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list video models');
      return reply.status(500).send({
        success: false,
        error: 'Failed to list video models',
      });
    }
  });
}
