/**
 * Admin Provider Settings Routes
 * Endpoints for managing AI provider configurations, models, and routing rules.
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
  CreateCompanionOverrideSchema,
  UpdateCompanionOverrideSchema,
  ProviderListQuerySchema,
  ModelListQuerySchema,
  RoutingRuleListQuerySchema,
} from '../services/provider-settings.js';
import {
  USE_CASE_TYPES,
  type UseCaseType,
  type ProviderConfig,
  type ModelConfig,
  type RoutingRule,
  type CompanionRoutingOverride,
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

const CompanionIdParamsSchema = z.object({
  companionId: z.string().uuid(),
});

const OverrideIdParamsSchema = z.object({
  companionId: z.string().uuid(),
  overrideId: z.string().uuid(),
});

const UseCaseParamsSchema = z.object({
  useCase: z.enum(USE_CASE_TYPES as unknown as [string, ...string[]]),
});

const EffectiveRoutingQuerySchema = z.object({
  companionId: z.string().uuid().optional(),
  useCase: z.enum(USE_CASE_TYPES as unknown as [string, ...string[]]),
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

/**
 * Register admin routing rules routes
 */
export async function adminRoutingRoutes(app: FastifyInstance): Promise<void> {
  const service = getProviderSettingsService();

  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // Routing Rules
  // ===========================================================================

  /**
   * POST /admin/routing/rules - Create a routing rule
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

    try {
      const rule = await service.createRoutingRule(bodyResult.data);

      logger.info(
        { ruleId: rule.id, useCase: rule.use_case, adminUserId: request.user!.userId },
        'Routing rule created via admin'
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
      logger.error({ error: err.message }, 'Failed to create routing rule');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to create routing rule',
      });
    }
  });

  /**
   * GET /admin/routing/rules - List all routing rules
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

    const result = await service.listRoutingRules(queryResult.data);

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
   * GET /admin/routing/use-cases/:useCase - Get routing for a specific use case
   */
  app.get('/use-cases/:useCase', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UseCaseParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid use case',
        details: paramsResult.error.issues,
      });
    }

    const rules = await service.getRoutingRulesForUseCase(paramsResult.data.useCase as UseCaseType);

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
   * PATCH /admin/routing/rules/:ruleId - Update a routing rule
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
        'Routing rule updated via admin'
      );

      return reply.send({
        success: true,
        data: mapRoutingRuleToResponse(rule),
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Routing rule not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to update routing rule');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to update routing rule',
      });
    }
  });

  /**
   * DELETE /admin/routing/rules/:ruleId - Delete a routing rule
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
        'Routing rule deleted via admin'
      );

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Routing rule not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to delete routing rule');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to delete routing rule',
      });
    }
  });

  // ===========================================================================
  // Effective Routing & Utilities
  // ===========================================================================

  /**
   * GET /admin/routing/effective - Get effective routing for a companion/use-case
   */
  app.get('/effective', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = EffectiveRoutingQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const config = await service.getEffectiveRouting(
      queryResult.data.companionId ?? null,
      queryResult.data.useCase as UseCaseType
    );

    return reply.send({
      success: true,
      data: {
        companionId: config.companion_id,
        useCase: config.use_case,
        hasOverrides: config.has_overrides,
        entries: config.entries.map(e => ({
          tier: e.tier,
          modelConfigId: e.model_config_id,
          modelId: e.model_id,
          provider: e.provider,
          weight: e.weight,
          maxRetries: e.max_retries,
          timeoutMs: e.timeout_ms,
          isOverride: e.is_override,
        })),
      },
    });
  });

  /**
   * POST /admin/routing/validate - Validate current configuration
   */
  app.post('/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.validateConfiguration();

    return reply.send({
      success: true,
      data: result,
    });
  });

  /**
   * POST /admin/routing/sync - Sync configuration to orchestrator
   */
  app.post('/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.syncWithOrchestrator();

    logger.info(
      { success: result.success, adminUserId: request.user!.userId },
      'Configuration synced to orchestrator via admin'
    );

    return reply.send({
      success: true,
      data: result,
    });
  });

  /**
   * GET /admin/routing/export - Export current configuration
   */
  app.get('/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = await service.exportConfiguration();

    return reply.send({
      success: true,
      data: config,
    });
  });
}

/**
 * Register admin companion routing override routes
 */
export async function adminCompanionRoutingRoutes(app: FastifyInstance): Promise<void> {
  const service = getProviderSettingsService();

  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/companions/:companionId/routing - Get companion overrides
   */
  app.get('/:companionId/routing', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = CompanionIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid companion ID',
        details: paramsResult.error.issues,
      });
    }

    const useCase = (request.query as { useCase?: string }).useCase as UseCaseType | undefined;
    const result = await service.listCompanionOverrides(paramsResult.data.companionId, useCase);

    return reply.send({
      success: true,
      data: {
        overrides: result.data.map(o => ({
          id: o.id,
          companionId: o.companion_id,
          useCase: o.use_case,
          tier: o.tier,
          modelConfigId: o.model_config_id,
          weight: o.weight,
          isEnabled: o.is_enabled,
          maxRetries: o.max_retries,
          timeoutMs: o.timeout_ms,
          createdAt: o.created_at.toISOString(),
          updatedAt: o.updated_at.toISOString(),
        })),
        hasMore: result.hasMore,
      },
    });
  });

  /**
   * POST /admin/companions/:companionId/routing - Create companion override
   */
  app.post('/:companionId/routing', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = CompanionIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid companion ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = CreateCompanionOverrideSchema.safeParse({
      ...request.body as object,
      companionId: paramsResult.data.companionId,
    });
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const override = await service.createCompanionOverride(bodyResult.data);

      logger.info(
        { overrideId: override.id, companionId: paramsResult.data.companionId, adminUserId: request.user!.userId },
        'Companion override created via admin'
      );

      return reply.status(201).send({
        success: true,
        data: mapCompanionOverrideToResponse(override),
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'DuplicateError') {
        return reply.status(409).send({
          error: 'Conflict',
          message: err.message,
        });
      }
      logger.error({ error: err.message }, 'Failed to create companion override');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to create companion override',
      });
    }
  });

  /**
   * PATCH /admin/companions/:companionId/routing/:overrideId - Update companion override
   */
  app.patch('/:companionId/routing/:overrideId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = OverrideIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid parameters',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateCompanionOverrideSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const override = await service.updateCompanionOverride(paramsResult.data.overrideId, bodyResult.data);

      logger.info(
        { overrideId: override.id, adminUserId: request.user!.userId },
        'Companion override updated via admin'
      );

      return reply.send({
        success: true,
        data: mapCompanionOverrideToResponse(override),
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Override not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to update companion override');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to update companion override',
      });
    }
  });

  /**
   * DELETE /admin/companions/:companionId/routing/:overrideId - Delete companion override
   */
  app.delete('/:companionId/routing/:overrideId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = OverrideIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid parameters',
        details: paramsResult.error.issues,
      });
    }

    try {
      await service.deleteCompanionOverride(paramsResult.data.overrideId);

      logger.info(
        { overrideId: paramsResult.data.overrideId, adminUserId: request.user!.userId },
        'Companion override deleted via admin'
      );

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Override not found',
        });
      }
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to delete companion override');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to delete companion override',
      });
    }
  });

  /**
   * POST /admin/companions/:companionId/routing/copy-defaults - Copy platform defaults
   */
  app.post('/:companionId/routing/copy-defaults', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = CompanionIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid companion ID',
        details: paramsResult.error.issues,
      });
    }

    const useCases = (request.body as { useCases?: string[] })?.useCases as UseCaseType[] | undefined;
    const overrides = await service.copyPlatformDefaultsToCompanion(paramsResult.data.companionId, useCases);

    logger.info(
      { companionId: paramsResult.data.companionId, count: overrides.length, adminUserId: request.user!.userId },
      'Platform defaults copied to companion via admin'
    );

    return reply.send({
      success: true,
      data: {
        copied: overrides.length,
        overrides: overrides.map(o => mapCompanionOverrideToResponse(o)),
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

function mapCompanionOverrideToResponse(override: CompanionRoutingOverride) {
  return {
    id: override.id,
    companionId: override.companion_id,
    useCase: override.use_case,
    tier: override.tier,
    modelConfigId: override.model_config_id,
    weight: override.weight,
    isEnabled: override.is_enabled,
    maxRetries: override.max_retries,
    timeoutMs: override.timeout_ms,
    createdAt: override.created_at.toISOString(),
    updatedAt: override.updated_at.toISOString(),
  };
}
