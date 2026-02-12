/**
 * Admin Influencer Models Routes
 * REST endpoints for managing LoRA training
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { withSpan } from '../observability/tracing.js';
import { logger } from '../observability/logger.js';
import { DuplicateError, NotFoundError, ValidationError } from '../repositories/errors.js';
import {
  getInfluencerModelsService,
  CreateModelSchema,
  UpdateModelSchema,
  GenerateSampleSchema,
  InfluencerServiceError,
} from '../services/influencer-models.js';
import type { InfluencerModelStatus, InfluencerSampleStatus } from '../repositories/influencer-models.js';

// =========================================================================
// Request Schemas
// =========================================================================

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  status: z.enum(['pending', 'uploading', 'training', 'downloading', 'ready', 'failed']).optional(),
  search: z.string().trim().max(255).optional(),
});

const PresignUploadSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().regex(/^image\/(jpeg|png|webp)$/),
});

const ConfirmUploadSchema = z.object({
  s3Key: z.string().min(1),
});

const RemoveImageSchema = z.object({
  s3Key: z.string().min(1),
});

const ListSamplesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ModelIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const ModelSampleParamsSchema = z.object({
  id: z.string().uuid(),
  sampleId: z.string().uuid(),
});

function sendValidationError(
  reply: FastifyReply,
  message: string,
  details: unknown
) {
  return reply.status(400).send({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message,
      details,
    },
  });
}

function sendServiceError(
  reply: FastifyReply,
  error: unknown,
  fallbackMessage: string
) {
  if (error instanceof InfluencerServiceError) {
    return reply.status(error.httpStatus).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }

  if (error instanceof NotFoundError) {
    return reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: error.message,
      },
    });
  }

  if (error instanceof DuplicateError) {
    return reply.status(409).send({
      success: false,
      error: {
        code: 'DUPLICATE',
        message: error.message,
      },
    });
  }

  if (error instanceof ValidationError) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.field ? { field: error.field } : undefined,
      },
    });
  }

  return reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: fallbackMessage,
    },
  });
}

// =========================================================================
// Routes
// =========================================================================

export async function adminInfluencerModelsRoutes(app: FastifyInstance): Promise<void> {
  const service = getInfluencerModelsService();

  logger.info('Registering admin influencer models routes');

  // All routes require admin role
  app.addHook('preHandler', requireAdmin);

  // =========================================================================
  // Stats
  // =========================================================================

  /**
   * GET /admin/influencer-models/stats - Get model statistics
   */
  app.get('/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('admin.influencer-models.stats', async () => {
      try {
        const stats = await service.getStats();
        return reply.send({
          success: true,
          data: stats,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get influencer model stats');
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to get stats' },
        });
      }
    });
  });

  // =========================================================================
  // CRUD
  // =========================================================================

  /**
   * POST /admin/influencer-models - Create a new model
   */
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('admin.influencer-models.create', async (span) => {
      const parseResult = CreateModelSchema.safeParse(request.body);
      if (!parseResult.success) {
        return sendValidationError(reply, 'Invalid request body', parseResult.error.flatten());
      }

      try {
        const model = await service.create(parseResult.data);
        span.setAttributes({ 'model.id': model.id });

        logger.info({ modelId: model.id, name: model.name }, 'Influencer model created via admin');

        return reply.status(201).send({
          success: true,
          data: formatModelResponse(model),
        });
      } catch (error) {
        logger.error({ error }, 'Failed to create influencer model');
        return sendServiceError(reply, error, 'Failed to create model');
      }
    });
  });

  /**
   * GET /admin/influencer-models - List all models
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('admin.influencer-models.list', async () => {
      const parseResult = ListQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return sendValidationError(reply, 'Invalid query parameters', parseResult.error.flatten());
      }

      try {
        const result = await service.list(parseResult.data);
        return reply.send({
          success: true,
          data: {
            models: result.data.map(formatModelResponse),
            hasMore: result.hasMore,
            limit: result.limit,
            offset: result.offset,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to list influencer models');
        return sendServiceError(reply, error, 'Failed to list models');
      }
    });
  });

  /**
   * GET /admin/influencer-models/:id - Get a model by ID
   */
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    return withSpan('admin.influencer-models.get', async (span) => {
      const paramsResult = ModelIdParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
      }

      const { id } = paramsResult.data;
      span.setAttributes({ 'model.id': id });

      try {
        const model = await service.getById(id);
        if (!model) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Model not found' },
          });
        }

        // Get image URLs if there are training images
        let imageUrls: { s3Key: string; url: string }[] = [];
        if (model.training_images_s3_keys.length > 0) {
          imageUrls = await service.getImageUrls(id);
        }

        return reply.send({
          success: true,
          data: {
            ...formatModelResponse(model),
            imageUrls,
          },
        });
      } catch (error) {
        logger.error({ error, id }, 'Failed to get influencer model');
        return sendServiceError(reply, error, 'Failed to get model');
      }
    });
  });

  /**
   * PATCH /admin/influencer-models/:id - Update a model
   */
  app.patch('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    return withSpan('admin.influencer-models.update', async (span) => {
      const paramsResult = ModelIdParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
      }

      const { id } = paramsResult.data;
      span.setAttributes({ 'model.id': id });

      const parseResult = UpdateModelSchema.safeParse(request.body);
      if (!parseResult.success) {
        return sendValidationError(reply, 'Invalid request body', parseResult.error.flatten());
      }

      try {
        const model = await service.update(id, parseResult.data);
        logger.info({ modelId: id }, 'Influencer model updated via admin');

        return reply.send({
          success: true,
          data: formatModelResponse(model),
        });
      } catch (error) {
        logger.error({ error, id }, 'Failed to update influencer model');
        return sendServiceError(reply, error, 'Failed to update model');
      }
    });
  });

  /**
   * DELETE /admin/influencer-models/:id - Delete a model
   */
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    return withSpan('admin.influencer-models.delete', async (span) => {
      const paramsResult = ModelIdParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
      }

      const { id } = paramsResult.data;
      span.setAttributes({ 'model.id': id });

      try {
        await service.delete(id);
        logger.info({ modelId: id }, 'Influencer model deleted via admin');

        return reply.send({
          success: true,
          data: { deleted: true },
        });
      } catch (error) {
        logger.error({ error, id }, 'Failed to delete influencer model');
        return sendServiceError(reply, error, 'Failed to delete model');
      }
    });
  });

  // =========================================================================
  // Image Upload
  // =========================================================================

  /**
   * POST /admin/influencer-models/:id/presign-upload - Get presigned URL for image upload
   */
  app.post(
    '/:id/presign-upload',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      return withSpan('admin.influencer-models.presign-upload', async (span) => {
        const paramsResult = ModelIdParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
        }

        const { id } = paramsResult.data;
        span.setAttributes({ 'model.id': id });

        const parseResult = PresignUploadSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendValidationError(reply, 'Invalid request body', parseResult.error.flatten());
        }

        try {
          const { uploadUrl, s3Key } = await service.getPresignedUploadUrl(
            id,
            parseResult.data.filename,
            parseResult.data.contentType
          );

          return reply.send({
            success: true,
            data: { uploadUrl, s3Key },
          });
        } catch (error) {
          logger.error({ error, id }, 'Failed to get presigned upload URL');
          return sendServiceError(reply, error, 'Failed to get upload URL');
        }
      });
    }
  );

  /**
   * POST /admin/influencer-models/:id/confirm-upload - Confirm image upload
   */
  app.post(
    '/:id/confirm-upload',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      return withSpan('admin.influencer-models.confirm-upload', async (span) => {
        const paramsResult = ModelIdParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
        }

        const { id } = paramsResult.data;
        span.setAttributes({ 'model.id': id });

        const parseResult = ConfirmUploadSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendValidationError(reply, 'Invalid request body', parseResult.error.flatten());
        }

        try {
          const model = await service.confirmImageUpload(id, parseResult.data.s3Key);

          return reply.send({
            success: true,
            data: formatModelResponse(model),
          });
        } catch (error) {
          logger.error({ error, id }, 'Failed to confirm image upload');
          return sendServiceError(reply, error, 'Failed to confirm upload');
        }
      });
    }
  );

  /**
   * DELETE /admin/influencer-models/:id/images - Remove an image
   */
  app.delete(
    '/:id/images',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      return withSpan('admin.influencer-models.remove-image', async (span) => {
        const paramsResult = ModelIdParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
        }

        const { id } = paramsResult.data;
        span.setAttributes({ 'model.id': id });

        const parseResult = RemoveImageSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendValidationError(reply, 'Invalid request body', parseResult.error.flatten());
        }

        try {
          const model = await service.removeImage(id, parseResult.data.s3Key);

          return reply.send({
            success: true,
            data: formatModelResponse(model),
          });
        } catch (error) {
          logger.error({ error, id }, 'Failed to remove image');
          return sendServiceError(reply, error, 'Failed to remove image');
        }
      });
    }
  );

  // =========================================================================
  // Training
  // =========================================================================

  /**
   * POST /admin/influencer-models/:id/train - Start training
   */
  app.post(
    '/:id/train',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      return withSpan('admin.influencer-models.train', async (span) => {
        const paramsResult = ModelIdParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
        }

        const { id } = paramsResult.data;
        span.setAttributes({ 'model.id': id });

        try {
          const model = await service.startTraining(id);
          logger.info({ modelId: id }, 'Training started via admin');

          return reply.send({
            success: true,
            data: formatModelResponse(model),
          });
        } catch (error) {
          logger.error({ error, id }, 'Failed to start training');
          return sendServiceError(reply, error, 'Failed to start training');
        }
      });
    }
  );

  /**
   * GET /admin/influencer-models/:id/training-status - Check training status
   */
  app.get(
    '/:id/training-status',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      return withSpan('admin.influencer-models.training-status', async (span) => {
        const paramsResult = ModelIdParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
        }

        const { id } = paramsResult.data;
        span.setAttributes({ 'model.id': id });

        try {
          const model = await service.checkTrainingStatus(id);

          return reply.send({
            success: true,
            data: formatModelResponse(model),
          });
        } catch (error) {
          logger.error({ error, id }, 'Failed to check training status');
          return sendServiceError(reply, error, 'Failed to check status');
        }
      });
    }
  );

  /**
   * GET /admin/influencer-models/:id/lora-download - Get LoRA download URL
   */
  app.get(
    '/:id/lora-download',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      return withSpan('admin.influencer-models.lora-download', async (span) => {
        const paramsResult = ModelIdParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
        }

        const { id } = paramsResult.data;
        span.setAttributes({ 'model.id': id });

        try {
          const url = await service.getLoraDownloadUrl(id);
          if (!url) {
            return reply.status(404).send({
              success: false,
              error: { code: 'NOT_FOUND', message: 'LoRA not available' },
            });
          }

          return reply.send({
            success: true,
            data: { downloadUrl: url },
          });
        } catch (error) {
          logger.error({ error, id }, 'Failed to get LoRA download URL');
          return sendServiceError(reply, error, 'Failed to get download URL');
        }
      });
    }
  );

  // =========================================================================
  // Sample Generation
  // =========================================================================

  /**
   * POST /admin/influencer-models/:id/samples - Generate a sample image
   */
  app.post(
    '/:id/samples',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      return withSpan('admin.influencer-models.generate-sample', async (span) => {
        const paramsResult = ModelIdParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
        }

        const { id } = paramsResult.data;
        span.setAttributes({ 'model.id': id });

        const parseResult = GenerateSampleSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendValidationError(reply, 'Invalid request body', parseResult.error.flatten());
        }

        try {
          const sample = await service.generateSample(id, parseResult.data);
          logger.info({ modelId: id, sampleId: sample.id }, 'Sample generation started via admin');

          return reply.status(201).send({
            success: true,
            data: formatSampleResponse(sample),
          });
        } catch (error) {
          logger.error({ error, id }, 'Failed to generate sample');
          return sendServiceError(reply, error, 'Failed to generate sample');
        }
      });
    }
  );

  /**
   * GET /admin/influencer-models/:id/samples - List samples for a model
   */
  app.get(
    '/:id/samples',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      return withSpan('admin.influencer-models.list-samples', async (span) => {
        const paramsResult = ModelIdParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid model ID', paramsResult.error.flatten());
        }

        const { id } = paramsResult.data;
        span.setAttributes({ 'model.id': id });

        const parseResult = ListSamplesQuerySchema.safeParse(request.query);
        if (!parseResult.success) {
          return sendValidationError(reply, 'Invalid query parameters', parseResult.error.flatten());
        }

        try {
          const samples = await service.listSamples(id, parseResult.data.limit);
          return reply.send({
            success: true,
            data: {
              samples: samples.map(formatSampleResponse),
            },
          });
        } catch (error) {
          logger.error({ error, id }, 'Failed to list samples');
          return sendServiceError(reply, error, 'Failed to list samples');
        }
      });
    }
  );

  /**
   * GET /admin/influencer-models/:id/samples/:sampleId - Get a sample
   */
  app.get(
    '/:id/samples/:sampleId',
    async (
      request: FastifyRequest<{ Params: { id: string; sampleId: string } }>,
      reply: FastifyReply
    ) => {
      return withSpan('admin.influencer-models.get-sample', async (span) => {
        const paramsResult = ModelSampleParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid path parameters', paramsResult.error.flatten());
        }

        const { id, sampleId } = paramsResult.data;
        span.setAttributes({ 'model.id': id, 'sample.id': sampleId });

        try {
          const sample = await service.getSample(sampleId);
          if (!sample || sample.model_id !== id) {
            return reply.status(404).send({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Sample not found' },
            });
          }

          return reply.send({
            success: true,
            data: formatSampleResponse(sample),
          });
        } catch (error) {
          logger.error({ error, id, sampleId }, 'Failed to get sample');
          return sendServiceError(reply, error, 'Failed to get sample');
        }
      });
    }
  );

  /**
   * DELETE /admin/influencer-models/:id/samples/:sampleId - Delete a sample
   */
  app.delete(
    '/:id/samples/:sampleId',
    async (
      request: FastifyRequest<{ Params: { id: string; sampleId: string } }>,
      reply: FastifyReply
    ) => {
      return withSpan('admin.influencer-models.delete-sample', async (span) => {
        const paramsResult = ModelSampleParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid path parameters', paramsResult.error.flatten());
        }

        const { id, sampleId } = paramsResult.data;
        span.setAttributes({ 'model.id': id, 'sample.id': sampleId });

        try {
          // Verify sample belongs to the model
          const sample = await service.getSample(sampleId);
          if (!sample || sample.model_id !== id) {
            return reply.status(404).send({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Sample not found' },
            });
          }

          await service.deleteSample(sampleId);
          logger.info({ modelId: id, sampleId }, 'Sample deleted via admin');

          return reply.send({
            success: true,
            data: { deleted: true },
          });
        } catch (error) {
          logger.error({ error, id, sampleId }, 'Failed to delete sample');
          return sendServiceError(reply, error, 'Failed to delete sample');
        }
      });
    }
  );

  /**
   * POST /admin/influencer-models/:id/samples/:sampleId/refresh-url - Refresh presigned URL
   */
  app.post(
    '/:id/samples/:sampleId/refresh-url',
    async (
      request: FastifyRequest<{ Params: { id: string; sampleId: string } }>,
      reply: FastifyReply
    ) => {
      return withSpan('admin.influencer-models.refresh-sample-url', async (span) => {
        const paramsResult = ModelSampleParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return sendValidationError(reply, 'Invalid path parameters', paramsResult.error.flatten());
        }

        const { id, sampleId } = paramsResult.data;
        span.setAttributes({ 'model.id': id, 'sample.id': sampleId });

        try {
          // Verify sample belongs to the model
          const sample = await service.getSample(sampleId);
          if (!sample || sample.model_id !== id) {
            return reply.status(404).send({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Sample not found' },
            });
          }

          const url = await service.refreshSampleUrl(sampleId);
          if (!url) {
            return reply.status(404).send({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Sample image not available' },
            });
          }

          return reply.send({
            success: true,
            data: { imageUrl: url },
          });
        } catch (error) {
          logger.error({ error, id, sampleId }, 'Failed to refresh sample URL');
          return sendServiceError(reply, error, 'Failed to refresh URL');
        }
      });
    }
  );
}

// =========================================================================
// Response Formatter
// =========================================================================

function formatModelResponse(model: {
  id: string;
  name: string;
  trigger_word: string;
  training_steps: number;
  is_style: boolean;
  status: InfluencerModelStatus;
  status_message: string | null;
  training_images_s3_keys: string[];
  lora_s3_key: string | null;
  fal_training_job_id: string | null;
  created_at: Date;
  updated_at: Date;
  training_started_at: Date | null;
  training_completed_at: Date | null;
}) {
  return {
    id: model.id,
    name: model.name,
    triggerWord: model.trigger_word,
    trainingSteps: model.training_steps,
    isStyle: model.is_style,
    status: model.status,
    statusMessage: model.status_message,
    imageCount: model.training_images_s3_keys.length,
    hasLora: !!model.lora_s3_key,
    falJobId: model.fal_training_job_id,
    createdAt: model.created_at.toISOString(),
    updatedAt: model.updated_at.toISOString(),
    trainingStartedAt: model.training_started_at?.toISOString() ?? null,
    trainingCompletedAt: model.training_completed_at?.toISOString() ?? null,
  };
}

function formatSampleResponse(sample: {
  id: string;
  model_id: string;
  prompt: string;
  negative_prompt: string | null;
  guidance_scale: number;
  lora_scale: number;
  num_inference_steps: number;
  seed: number | null;
  width: number;
  height: number;
  status: InfluencerSampleStatus;
  error_message: string | null;
  fal_request_id: string | null;
  image_s3_key: string | null;
  image_url: string | null;
  created_at: Date;
  completed_at: Date | null;
}) {
  return {
    id: sample.id,
    modelId: sample.model_id,
    prompt: sample.prompt,
    negativePrompt: sample.negative_prompt,
    guidanceScale: sample.guidance_scale,
    loraScale: sample.lora_scale,
    numInferenceSteps: sample.num_inference_steps,
    seed: sample.seed,
    width: sample.width,
    height: sample.height,
    status: sample.status,
    errorMessage: sample.error_message,
    imageUrl: sample.image_url,
    createdAt: sample.created_at.toISOString(),
    completedAt: sample.completed_at?.toISOString() ?? null,
  };
}
