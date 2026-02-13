/**
 * Admin Routing Rules Routes
 * Endpoints for managing AI routing rules, effective routing, and configuration utilities.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import {
  getProviderSettingsService,
  CreateRoutingRuleSchema,
  UpdateRoutingRuleSchema,
  RoutingRuleListQuerySchema,
} from '../services/provider-settings.js';
import {
  USE_CASE_TYPES,
  type UseCaseType,
  type RoutingRule,
} from '../db/types.js';
import { logger } from '../observability/logger.js';
import { NotFoundError } from '../repositories/errors.js';

// Request param schemas
const RuleIdParamsSchema = z.object({
  ruleId: z.string().uuid(),
});

const UseCaseParamsSchema = z.object({
  useCase: z.enum(USE_CASE_TYPES as unknown as [string, ...string[]]),
});

const EffectiveRoutingQuerySchema = z.object({
  companionId: z.string().uuid().optional(),
  useCase: z.enum(USE_CASE_TYPES as unknown as [string, ...string[]]),
});

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

// ===========================================================================
// Response Mappers
// ===========================================================================

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
