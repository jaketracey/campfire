/**
 * Admin Video Provider Settings Routes
 * Endpoints for managing video provider configurations, models, and routing rules.
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
  CreateRoutingRuleSchema,
  UpdateRoutingRuleSchema,
  ProviderListQuerySchema,
  ModelListQuerySchema,
  RoutingRuleListQuerySchema,
} from '../services/provider-settings.js';
import {
  VIDEO_USE_CASE_TYPES,
  type UseCaseType,
  type ProviderConfig,
  type ModelConfig,
  type RoutingRule,
} from '../db/types.js';
import { logger } from '../observability/logger.js';
import { NotFoundError } from '../repositories/errors.js';

// Request param schemas
const ProviderIdParamsSchema = z.object({
  providerId: z.string().uuid(),
});

const ModelIdParamsSchema = z.object({
  modelId: z.string().uuid(),
});

const RuleIdParamsSchema = z.object({
  ruleId: z.string().uuid(),
});

const VideoUseCaseParamsSchema = z.object({
  useCase: z.enum(VIDEO_USE_CASE_TYPES as unknown as [string, ...string[]]),
});

/**
 * Register admin video provider routes
 * Prefix: /admin/video-providers
 */
export async function adminVideoProvidersRoutes(app: FastifyInstance): Promise<void> {
  const service = getProviderSettingsService();

  // All routes require admin role
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // Video Providers
  // ===========================================================================

  /**
   * POST /admin/video-providers - Create a new video provider
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
      const provider = await service.createVideoProvider(bodyResult.data);

      logger.info(
        { providerId: provider.id, provider: provider.provider, adminUserId: request.user!.userId },
        'Video provider created via admin'
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
      logger.error({ error: err.message }, 'Failed to create video provider');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to create video provider',
      });
    }
  });

  /**
   * GET /admin/video-providers - List all video providers with health status
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

    const result = await service.listVideoProviders(queryResult.data);

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
          category: 'video',
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
   * GET /admin/video-providers/:providerId - Get video provider details with models
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

    const provider = await service.getVideoProviderWithModels(paramsResult.data.providerId);

    if (!provider) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Video provider not found',
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
        category: 'video',
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
          metadata: m.metadata,
          createdAt: m.created_at.toISOString(),
          updatedAt: m.updated_at.toISOString(),
        })),
        createdAt: provider.created_at.toISOString(),
        updatedAt: provider.updated_at.toISOString(),
      },
    });
  });

  /**
   * PATCH /admin/video-providers/:providerId - Update a video provider
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
      const provider = await service.updateVideoProvider(paramsResult.data.providerId, bodyResult.data);

      logger.info(
        { providerId: provider.id, adminUserId: request.user!.userId },
        'Video provider updated via admin'
      );

      return reply.send({
        success: true,
        data: mapProviderToResponse(provider),
      });
    } catch (error) {
      if (error instanceof NotFoundError || (error as Error).message.includes('not found')) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Video provider not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to update video provider');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to update video provider',
      });
    }
  });

  /**
   * DELETE /admin/video-providers/:providerId - Delete a video provider
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
      await service.deleteVideoProvider(paramsResult.data.providerId);

      logger.info(
        { providerId: paramsResult.data.providerId, adminUserId: request.user!.userId },
        'Video provider deleted via admin'
      );

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError || (error as Error).message.includes('not found')) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Video provider not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to delete video provider');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to delete video provider',
      });
    }
  });

  /**
   * POST /admin/video-providers/:providerId/test - Test video provider connection
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

    const result = await service.testVideoProviderConnection(paramsResult.data.providerId);

    logger.info(
      { providerId: paramsResult.data.providerId, success: result.success, adminUserId: request.user!.userId },
      'Video provider connection tested via admin'
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
  // Video Models
  // ===========================================================================

  /**
   * POST /admin/video-providers/:providerId/models - Add a model to a video provider
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
      const model = await service.createVideoModel(bodyResult.data);

      logger.info(
        { modelId: model.id, providerId: paramsResult.data.providerId, adminUserId: request.user!.userId },
        'Video model created via admin'
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
      if (err.name === 'ForeignKeyError' || err.message.includes('not found')) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Video provider not found',
        });
      }
      logger.error({ error: err.message }, 'Failed to create video model');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to create video model',
      });
    }
  });

  /**
   * GET /admin/video-providers/:providerId/models - List models for a video provider
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

    // Verify it's a video provider
    const provider = await service.getVideoProvider(paramsResult.data.providerId);
    if (!provider) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Video provider not found',
      });
    }

    const queryResult = ModelListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const result = await service.listVideoModels(paramsResult.data.providerId, queryResult.data);

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
          metadata: m.metadata,
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

/**
 * Register admin video models routes (separate from provider-scoped routes)
 * Prefix: /admin/video-models
 */
export async function adminVideoModelsRoutes(app: FastifyInstance): Promise<void> {
  const service = getProviderSettingsService();

  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/video-models - List all video models
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

    const result = await service.listAllVideoModels(queryResult.data);

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
          metadata: m.metadata,
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
   * PATCH /admin/video-models/:modelId - Update a video model
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
      // Use the base updateModel since we don't have video-specific logic here
      const model = await service.updateModel(paramsResult.data.modelId, bodyResult.data);

      logger.info(
        { modelId: model.id, adminUserId: request.user!.userId },
        'Video model updated via admin'
      );

      return reply.send({
        success: true,
        data: mapModelToResponse(model),
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Video model not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to update video model');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to update video model',
      });
    }
  });

  /**
   * DELETE /admin/video-models/:modelId - Delete a video model
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
        'Video model deleted via admin'
      );

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Video model not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to delete video model');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to delete video model',
      });
    }
  });
}

/**
 * Register admin video routing rules routes
 * Prefix: /admin/video-routing
 */
export async function adminVideoRoutingRoutes(app: FastifyInstance): Promise<void> {
  const service = getProviderSettingsService();

  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // Video Routing Rules
  // ===========================================================================

  /**
   * POST /admin/video-routing/rules - Create a video routing rule
   */
  app.post('/rules', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = CreateRoutingRuleSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    // Validate it's a video use case
    if (!VIDEO_USE_CASE_TYPES.includes(bodyResult.data.useCase as UseCaseType)) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: `Invalid video use case. Valid options: ${VIDEO_USE_CASE_TYPES.join(', ')}`,
      });
    }

    try {
      const rule = await service.createVideoRoutingRule(bodyResult.data);

      logger.info(
        { ruleId: rule.id, useCase: rule.use_case, adminUserId: request.user!.userId },
        'Video routing rule created via admin'
      );

      return reply.status(201).send({
        success: true,
        data: mapRoutingRuleToResponse(rule),
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
          message: 'Model not found',
        });
      }
      logger.error({ error: err.message }, 'Failed to create video routing rule');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to create video routing rule',
      });
    }
  });

  /**
   * GET /admin/video-routing/rules - List all video routing rules
   */
  app.get('/rules', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = RoutingRuleListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const result = await service.listVideoRoutingRules(queryResult.data);

    return reply.send({
      success: true,
      data: {
        rules: result.data.map(r => ({
          id: r.id,
          useCase: r.use_case,
          tier: r.tier,
          modelConfigId: r.model_config_id,
          weight: r.weight,
          isEnabled: r.is_enabled,
          maxRetries: r.max_retries,
          timeoutMs: r.timeout_ms,
          model: r.model ? {
            id: r.model.id,
            modelId: r.model.model_id,
            displayName: r.model.display_name,
            isEnabled: r.model.is_enabled,
            provider: r.model.provider,
            providerDisplayName: r.model.provider_display_name,
            providerIsEnabled: r.model.provider_is_enabled,
          } : null,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
        hasMore: result.hasMore,
      },
    });
  });

  /**
   * GET /admin/video-routing/use-cases/:useCase - Get routing for a specific video use case
   */
  app.get('/use-cases/:useCase', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = VideoUseCaseParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: `Invalid use case. Valid options: ${VIDEO_USE_CASE_TYPES.join(', ')}`,
        details: paramsResult.error.issues,
      });
    }

    const rules = await service.getVideoRoutingRulesForUseCase(paramsResult.data.useCase as UseCaseType);

    return reply.send({
      success: true,
      data: {
        useCase: paramsResult.data.useCase,
        rules: rules.map(r => ({
          id: r.id,
          tier: r.tier,
          modelConfigId: r.model_config_id,
          weight: r.weight,
          isEnabled: r.is_enabled,
          maxRetries: r.max_retries,
          timeoutMs: r.timeout_ms,
          model: r.model ? {
            id: r.model.id,
            modelId: r.model.model_id,
            displayName: r.model.display_name,
            provider: r.model.provider,
            providerDisplayName: r.model.provider_display_name,
          } : null,
        })),
      },
    });
  });

  /**
   * PATCH /admin/video-routing/rules/:ruleId - Update a video routing rule
   */
  app.patch('/rules/:ruleId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = RuleIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid rule ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateRoutingRuleSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const rule = await service.updateRoutingRule(paramsResult.data.ruleId, bodyResult.data);

      logger.info(
        { ruleId: rule.id, adminUserId: request.user!.userId },
        'Video routing rule updated via admin'
      );

      return reply.send({
        success: true,
        data: mapRoutingRuleToResponse(rule),
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Video routing rule not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to update video routing rule');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to update video routing rule',
      });
    }
  });

  /**
   * DELETE /admin/video-routing/rules/:ruleId - Delete a video routing rule
   */
  app.delete('/rules/:ruleId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = RuleIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid rule ID',
        details: paramsResult.error.issues,
      });
    }

    try {
      await service.deleteRoutingRule(paramsResult.data.ruleId);

      logger.info(
        { ruleId: paramsResult.data.ruleId, adminUserId: request.user!.userId },
        'Video routing rule deleted via admin'
      );

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Video routing rule not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to delete video routing rule');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to delete video routing rule',
      });
    }
  });

  // ===========================================================================
  // Configuration Utilities
  // ===========================================================================

  /**
   * POST /admin/video-routing/validate - Validate current video configuration
   */
  app.post('/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check each video use case has at least one enabled model
    for (const useCase of VIDEO_USE_CASE_TYPES) {
      const rules = await service.getVideoRoutingRulesForUseCase(useCase);
      if (rules.length === 0) {
        warnings.push(`Video use case '${useCase}' has no routing rules configured`);
      }
    }

    // Check all video providers have at least one enabled model
    const { data: providers } = await service.listVideoProviders({ isEnabled: true, limit: 100, offset: 0 });
    for (const provider of providers) {
      if (provider.model_count === 0) {
        warnings.push(`Video provider '${provider.display_name}' has no models configured`);
      }
      if (!provider.has_api_key) {
        warnings.push(`Video provider '${provider.display_name}' has no API key configured`);
      }
    }

    return reply.send({
      success: true,
      data: {
        valid: errors.length === 0,
        errors,
        warnings,
      },
    });
  });

  /**
   * POST /admin/video-routing/sync - Sync video configuration to orchestrator
   */
  app.post('/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.syncVideoConfigWithOrchestrator();

    logger.info(
      { success: result.success, adminUserId: request.user!.userId },
      'Video configuration synced to orchestrator via admin'
    );

    return reply.send({
      success: true,
      data: result,
    });
  });

  /**
   * GET /admin/video-routing/use-cases - Get list of available video use cases
   */
  app.get('/use-cases', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      success: true,
      data: {
        useCases: VIDEO_USE_CASE_TYPES.map(uc => ({
          id: uc,
          label: uc === 'video_generation' ? 'Video Generation'
               : uc === 'video_from_image' ? 'Image-to-Video'
               : uc === 'video_lip_sync' ? 'Lip Sync Video'
               : uc === 'video_motion_brush' ? 'Motion Brush'
               : uc,
          description: uc === 'video_generation' ? 'Generate video from text prompts'
                     : uc === 'video_from_image' ? 'Animate a static image into video'
                     : uc === 'video_lip_sync' ? 'Generate video with lip sync support'
                     : uc === 'video_motion_brush' ? 'Generate video with motion brush controls'
                     : '',
        })),
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
    category: 'video',
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
    metadata: model.metadata,
    createdAt: model.created_at.toISOString(),
    updatedAt: model.updated_at.toISOString(),
  };
}

function mapRoutingRuleToResponse(rule: RoutingRule) {
  return {
    id: rule.id,
    useCase: rule.use_case,
    tier: rule.tier,
    modelConfigId: rule.model_config_id,
    weight: rule.weight,
    isEnabled: rule.is_enabled,
    maxRetries: rule.max_retries,
    timeoutMs: rule.timeout_ms,
    createdAt: rule.created_at.toISOString(),
    updatedAt: rule.updated_at.toISOString(),
  };
}
