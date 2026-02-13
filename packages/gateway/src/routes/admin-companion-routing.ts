/**
 * Admin Companion Routing Override Routes
 * Endpoints for managing per-companion routing overrides.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import {
  getProviderSettingsService,
  CreateCompanionOverrideSchema,
  UpdateCompanionOverrideSchema,
} from '../services/provider-settings.js';
import {
  type UseCaseType,
  type CompanionRoutingOverride,
} from '../db/types.js';
import { logger } from '../observability/logger.js';
import { NotFoundError } from '../repositories/errors.js';

// Request param schemas
const CompanionIdParamsSchema = z.object({
  companionId: z.string().uuid(),
});

const OverrideIdParamsSchema = z.object({
  companionId: z.string().uuid(),
  overrideId: z.string().uuid(),
});

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
