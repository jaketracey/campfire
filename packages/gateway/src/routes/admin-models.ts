/**
 * Admin Model Routes
 * Endpoints for managing AI models (separate from provider-scoped routes).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import {
  getProviderSettingsService,
  UpdateModelSchema,
  ModelListQuerySchema,
} from '../services/provider-settings.js';
import {
  type ModelConfig,
} from '../db/types.js';
import { logger } from '../observability/logger.js';
import { NotFoundError } from '../repositories/errors.js';

// Request param schemas
const ModelIdParamsSchema = z.object({
  modelId: z.string().uuid(),
});

/**
 * Register admin model routes (separate from provider-scoped routes)
 */
export async function adminModelsRoutes(app: FastifyInstance): Promise<void> {
  const service = getProviderSettingsService();

  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/models - List all models
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = ModelListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const result = await service.listModels(queryResult.data);

    return reply.send({
      success: true,
      data: {
        models: result.data.map(m => ({
          id: m.id,
          providerConfigId: m.provider_config_id,
          modelId: m.model_id,
          displayName: m.display_name,
          isEnabled: m.is_enabled,
          contextWindow: m.context_window,
          maxOutputTokens: m.max_output_tokens,
          inputCostPerMillion: m.input_cost_per_million,
          outputCostPerMillion: m.output_cost_per_million,
          capabilities: m.capabilities,
          provider: m.provider,
          providerDisplayName: m.provider_display_name,
          providerIsEnabled: m.provider_is_enabled,
          createdAt: m.created_at.toISOString(),
          updatedAt: m.updated_at.toISOString(),
        })),
        hasMore: result.hasMore,
      },
    });
  });

  /**
   * PATCH /admin/models/:modelId - Update a model
   */
  app.patch('/:modelId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ModelIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid model ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateModelSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const model = await service.updateModel(paramsResult.data.modelId, bodyResult.data);

      logger.info(
        { modelId: model.id, adminUserId: request.user!.userId },
        'Model updated via admin'
      );

      return reply.send({
        success: true,
        data: mapModelToResponse(model),
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Model not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to update model');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to update model',
      });
    }
  });

  /**
   * DELETE /admin/models/:modelId - Delete a model
   */
  app.delete('/:modelId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ModelIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid model ID',
        details: paramsResult.error.issues,
      });
    }

    try {
      await service.deleteModel(paramsResult.data.modelId);

      logger.info(
        { modelId: paramsResult.data.modelId, adminUserId: request.user!.userId },
        'Model deleted via admin'
      );

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Model not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to delete model');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to delete model',
      });
    }
  });
}

// ===========================================================================
// Response Mappers
// ===========================================================================

function mapModelToResponse(model: ModelConfig) {
  return {
    id: model.id,
    providerConfigId: model.provider_config_id,
    modelId: model.model_id,
    displayName: model.display_name,
    isEnabled: model.is_enabled,
    contextWindow: model.context_window,
    maxOutputTokens: model.max_output_tokens,
    inputCostPerMillion: model.input_cost_per_million,
    outputCostPerMillion: model.output_cost_per_million,
    capabilities: model.capabilities,
    createdAt: model.created_at.toISOString(),
    updatedAt: model.updated_at.toISOString(),
  };
}
