/**
 * Admin Provider Settings Routes
 * Endpoints for managing AI provider configurations and provider-scoped models.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import {
  getProviderSettingsService,
  CreateProviderSchema,
  UpdateProviderSchema,
  CreateModelSchema,
  UpdateModelSchema,
  ProviderListQuerySchema,
  ModelListQuerySchema,
} from '../services/provider-settings.js';
import {
  type ProviderConfig,
  type ModelConfig,
} from '../db/types.js';
import { logger } from '../observability/logger.js';
import { NotFoundError } from '../repositories/errors.js';

// Request param schemas
const ProviderIdParamsSchema = z.object({
  providerId: z.string().uuid(),
});

/**
 * Register admin provider settings routes
 */
export async function adminProvidersRoutes(app: FastifyInstance): Promise<void> {
  const service = getProviderSettingsService();

  // All routes require admin role
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // Providers
  // ===========================================================================

  /**
   * POST /admin/providers - Create a new provider
   */
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = CreateProviderSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const provider = await service.createProvider(bodyResult.data);

      logger.info(
        { providerId: provider.id, provider: provider.provider, adminUserId: request.user!.userId },
        'Provider created via admin'
      );

      return reply.status(201).send({
        success: true,
        data: mapProviderToResponse(provider),
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'DuplicateError') {
        return reply.status(409).send({
          error: 'Conflict',
          message: err.message,
        });
      }
      logger.error({ error: err.message }, 'Failed to create provider');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to create provider',
      });
    }
  });

  /**
   * GET /admin/providers - List all providers with health status
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = ProviderListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const result = await service.listProviders(queryResult.data);

    return reply.send({
      success: true,
      data: {
        providers: result.data.map(p => ({
          id: p.id,
          provider: p.provider,
          displayName: p.display_name,
          isEnabled: p.is_enabled,
          hasApiKey: p.has_api_key,
          apiBaseUrl: p.api_base_url,
          rateLimitRpm: p.rate_limit_rpm,
          rateLimitTpm: p.rate_limit_tpm,
          maxConcurrentRequests: p.max_concurrent_requests,
          priority: p.priority,
          modelCount: p.model_count,
          health: p.health ? {
            isAvailable: p.health.is_available,
            lastCheckAt: p.health.last_check_at?.toISOString() ?? null,
            avgLatencyMs: p.health.avg_latency_ms,
            successRate: p.health.success_rate,
            errorCount: p.health.error_count,
          } : null,
          createdAt: p.created_at.toISOString(),
          updatedAt: p.updated_at.toISOString(),
        })),
        hasMore: result.hasMore,
      },
    });
  });

  /**
   * GET /admin/providers/:providerId - Get provider details with models
   */
  app.get('/:providerId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ProviderIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid provider ID',
        details: paramsResult.error.issues,
      });
    }

    const provider = await service.getProviderWithModels(paramsResult.data.providerId);

    if (!provider) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Provider not found',
      });
    }

    return reply.send({
      success: true,
      data: {
        id: provider.id,
        provider: provider.provider,
        displayName: provider.display_name,
        isEnabled: provider.is_enabled,
        hasApiKey: provider.has_api_key,
        apiBaseUrl: provider.api_base_url,
        rateLimitRpm: provider.rate_limit_rpm,
        rateLimitTpm: provider.rate_limit_tpm,
        maxConcurrentRequests: provider.max_concurrent_requests,
        priority: provider.priority,
        metadata: provider.metadata,
        models: provider.models.map(m => ({
          id: m.id,
          modelId: m.model_id,
          displayName: m.display_name,
          isEnabled: m.is_enabled,
          contextWindow: m.context_window,
          maxOutputTokens: m.max_output_tokens,
          inputCostPerMillion: m.input_cost_per_million,
          outputCostPerMillion: m.output_cost_per_million,
          capabilities: m.capabilities,
          createdAt: m.created_at.toISOString(),
          updatedAt: m.updated_at.toISOString(),
        })),
        createdAt: provider.created_at.toISOString(),
        updatedAt: provider.updated_at.toISOString(),
      },
    });
  });

  /**
   * PATCH /admin/providers/:providerId - Update a provider
   */
  app.patch('/:providerId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ProviderIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid provider ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateProviderSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const provider = await service.updateProvider(paramsResult.data.providerId, bodyResult.data);

      logger.info(
        { providerId: provider.id, adminUserId: request.user!.userId },
        'Provider updated via admin'
      );

      return reply.send({
        success: true,
        data: mapProviderToResponse(provider),
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Provider not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to update provider');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to update provider',
      });
    }
  });

  /**
   * DELETE /admin/providers/:providerId - Delete a provider
   */
  app.delete('/:providerId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ProviderIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid provider ID',
        details: paramsResult.error.issues,
      });
    }

    try {
      await service.deleteProvider(paramsResult.data.providerId);

      logger.info(
        { providerId: paramsResult.data.providerId, adminUserId: request.user!.userId },
        'Provider deleted via admin'
      );

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Provider not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to delete provider');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to delete provider',
      });
    }
  });

  /**
   * GET /admin/providers/:providerId/discover-models - Discover available models from provider API
   */
  app.get('/:providerId/discover-models', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ProviderIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid provider ID',
        details: paramsResult.error.issues,
      });
    }

    const result = await service.discoverProviderModels(paramsResult.data.providerId);

    logger.info(
      { providerId: paramsResult.data.providerId, modelCount: result.models.length, success: result.success, adminUserId: request.user!.userId },
      'Provider models discovered via admin'
    );

    return reply.send({
      success: true,
      data: result,
    });
  });

  /**
   * POST /admin/providers/:providerId/test - Test provider connection
   */
  app.post('/:providerId/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ProviderIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid provider ID',
        details: paramsResult.error.issues,
      });
    }

    const result = await service.testProviderConnection(paramsResult.data.providerId);

    logger.info(
      { providerId: paramsResult.data.providerId, success: result.success, adminUserId: request.user!.userId },
      'Provider connection tested via admin'
    );

    return reply.send({
      success: true,
      data: {
        success: result.success,
        latencyMs: result.latencyMs,
        error: result.error,
      },
    });
  });

  // ===========================================================================
  // Models
  // ===========================================================================

  /**
   * POST /admin/providers/:providerId/models - Add a model to a provider
   */
  app.post('/:providerId/models', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ProviderIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid provider ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = CreateModelSchema.safeParse({
      ...request.body as object,
      providerConfigId: paramsResult.data.providerId,
    });
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const model = await service.createModel(bodyResult.data);

      logger.info(
        { modelId: model.id, providerId: paramsResult.data.providerId, adminUserId: request.user!.userId },
        'Model created via admin'
      );

      return reply.status(201).send({
        success: true,
        data: mapModelToResponse(model),
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'DuplicateError') {
        return reply.status(409).send({
          error: 'Conflict',
          message: err.message,
        });
      }
      if (err.name === 'ForeignKeyError') {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Provider not found',
        });
      }
      logger.error({ error: err.message }, 'Failed to create model');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to create model',
      });
    }
  });

  /**
   * GET /admin/providers/:providerId/models - List models for a provider
   */
  app.get('/:providerId/models', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ProviderIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid provider ID',
        details: paramsResult.error.issues,
      });
    }

    const queryResult = ModelListQuerySchema.safeParse({
      ...request.query as object,
      providerConfigId: paramsResult.data.providerId,
    });
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
}

// ===========================================================================
// Response Mappers
// ===========================================================================

function mapProviderToResponse(provider: ProviderConfig) {
  return {
    id: provider.id,
    provider: provider.provider,
    displayName: provider.display_name,
    isEnabled: provider.is_enabled,
    apiBaseUrl: provider.api_base_url,
    rateLimitRpm: provider.rate_limit_rpm,
    rateLimitTpm: provider.rate_limit_tpm,
    maxConcurrentRequests: provider.max_concurrent_requests,
    priority: provider.priority,
    createdAt: provider.created_at.toISOString(),
    updatedAt: provider.updated_at.toISOString(),
  };
}

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
