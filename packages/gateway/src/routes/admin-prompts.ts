/**
 * Admin Prompt Templates Routes
 * Exposes CRUD + validation for versioned prompt templates.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { getPromptTemplatesService, PromptTemplateValidationError } from '../services/prompt-templates.js';

const AdminAreaSchema = z.enum(['routing', 'image_routing', 'video_routing', 'other']);

const ListPromptsQuerySchema = z.object({
  adminArea: AdminAreaSchema.optional(),
  version: z.string().min(1).optional(),
  companionId: z.string().uuid().optional(),
});

const UpdatePromptParamsSchema = z.object({
  key: z.string().min(1),
});

const UpdatePromptBodySchema = z.object({
  template: z.string().min(1),
  version: z.string().min(1).optional(),
  companionId: z.string().uuid().optional(),
});

const ValidateBodySchema = z.object({
  adminArea: AdminAreaSchema.optional(),
  version: z.string().min(1).optional(),
  companionId: z.string().uuid().optional(),
});

const CreateVersionBodySchema = z.object({
  fromVersion: z.string().min(1),
  toVersion: z.string().min(1),
});

const UpdateSettingsBodySchema = z.object({
  defaultVersion: z.string().min(1),
});

export async function adminPromptsRoutes(app: FastifyInstance): Promise<void> {
  const service = getPromptTemplatesService();

  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/prompts - List prompt templates (effective for optional companion)
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = ListPromptsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: parsed.error.issues,
      });
    }

    const data = await service.listPrompts({
      adminArea: parsed.data.adminArea,
      version: parsed.data.version,
      companionId: parsed.data.companionId ?? null,
    });

    return reply.send({ success: true, data });
  });

  /**
   * POST /admin/prompts/validate - Validate prompt completeness and syntax
   */
  app.post('/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = ValidateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parsed.error.issues,
      });
    }

    const data = await service.validate({
      adminArea: parsed.data.adminArea,
      version: parsed.data.version,
      companionId: parsed.data.companionId ?? null,
    });

    return reply.send({ success: true, data });
  });

  /**
   * GET /admin/prompts/versions - List available versions + current default
   */
  app.get('/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({ adminArea: AdminAreaSchema.optional() }).safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: parsed.error.issues,
      });
    }

    const [versions, defaultVersion] = await Promise.all([
      service.listVersions(parsed.data.adminArea),
      service.getDefaultVersion(),
    ]);

    return reply.send({
      success: true,
      data: { versions, defaultVersion },
    });
  });

  /**
   * POST /admin/prompts/versions - Create a new version by cloning from an existing version
   */
  app.post('/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateVersionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parsed.error.issues,
      });
    }

    const result = await service.createVersion(parsed.data);
    logger.info(
      { ...parsed.data, copied: result.copied, adminUserId: request.user!.userId },
      'Prompt version created'
    );

    return reply.status(201).send({ success: true, data: result });
  });

  /**
   * PATCH /admin/prompts/settings - Update default prompt version
   */
  app.patch('/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = UpdateSettingsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parsed.error.issues,
      });
    }

    const data = await service.setDefaultVersion(parsed.data.defaultVersion);
    logger.info({ defaultVersion: data.defaultVersion, adminUserId: request.user!.userId }, 'Default prompt version updated');
    return reply.send({ success: true, data });
  });

  /**
   * PUT /admin/prompts/:key - Update a prompt template
   */
  app.put('/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = UpdatePromptParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid prompt key',
        details: params.error.issues,
      });
    }

    const body = UpdatePromptBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: body.error.issues,
      });
    }

    try {
      const data = await service.updatePrompt({
        key: params.data.key,
        template: body.data.template,
        version: body.data.version,
        companionId: body.data.companionId ?? null,
      });

      logger.info(
        {
          promptKey: params.data.key,
          version: data.version,
          companionId: body.data.companionId ?? null,
          adminUserId: request.user!.userId,
        },
        'Prompt template updated'
      );

      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof PromptTemplateValidationError) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: err.message,
        });
      }
      throw err;
    }
  });
}

