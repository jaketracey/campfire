/**
 * Admin SEO Routes
 * SEO page management for administrators.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { getSeoPagesRepository, type SeoPageWithCompanion } from '../repositories/seo-pages.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { generateSeoContent } from '../services/seo-generation.js';
import { logger } from '../observability/logger.js';

// Params schemas
const PageIdParamsSchema = z.object({
  pageId: z.string().uuid(),
});

// Query schemas
const SeoPageListQuerySchema = z.object({
  status: z.enum(['draft', 'generating', 'published', 'archived']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const CompanionsAvailableQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Body schemas
const CreateSeoPageBodySchema = z.object({
  companionId: z.string().uuid(),
  generateNow: z.boolean().default(true),
});

const UpdateSeoPageBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  metaDescription: z.string().max(320).optional(),
  ogTitle: z.string().max(200).optional(),
  ogDescription: z.string().max(320).optional(),
  ogImageUrl: z.string().url().max(2048).optional().nullable(),
});

/**
 * Register admin SEO routes
 */
export async function adminSeoRoutes(app: FastifyInstance): Promise<void> {
  const seoPagesRepo = getSeoPagesRepository();
  const companionsRepo = getCompanionsRepository();

  // All routes require admin authentication
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // SEO Page CRUD
  // ===========================================================================

  /**
   * GET /admin/seo/pages - List all SEO pages
   */
  app.get('/pages', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = SeoPageListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: queryResult.error.issues,
        },
      });
    }

    const query = queryResult.data;

    try {
      const result = await seoPagesRepo.list({
        status: query.status,
        search: query.search,
        limit: query.limit,
        offset: query.offset,
      });

      return reply.send({
        success: true,
        data: {
          pages: result.data.map((page: SeoPageWithCompanion) => ({
            id: page.id,
            companionId: page.companion_id,
            companionName: page.companion_name,
            companionAvatarUrl: page.companion_avatar_url,
            slug: page.slug,
            title: page.title,
            status: page.status,
            version: page.version,
            publishedAt: page.published_at?.toISOString() ?? null,
            generatedByModel: page.generated_by_model,
            generationError: page.generation_error,
            createdAt: page.created_at.toISOString(),
            updatedAt: page.updated_at.toISOString(),
          })),
          hasMore: result.hasMore,
          total: result.total,
          limit: query.limit,
          offset: query.offset,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error listing SEO pages');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list SEO pages',
        },
      });
    }
  });

  /**
   * GET /admin/seo/pages/:pageId - Get a single SEO page
   */
  app.get('/pages/:pageId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = PageIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid page ID',
        },
      });
    }

    const { pageId } = paramsResult.data;

    try {
      const page = await seoPagesRepo.findById(pageId);

      if (!page) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PAGE_NOT_FOUND',
            message: 'SEO page not found',
          },
        });
      }

      // Get companion data
      const companion = await companionsRepo.findByIdWithAvatar(page.companion_id);

      return reply.send({
        success: true,
        data: {
          id: page.id,
          companionId: page.companion_id,
          companionName: companion?.name ?? null,
          companionAvatarUrl: companion?.activeAvatar?.asset_url ?? null,
          slug: page.slug,
          title: page.title,
          metaDescription: page.meta_description,
          ogTitle: page.og_title,
          ogDescription: page.og_description,
          ogImageUrl: page.og_image_url,
          contentHtml: page.content_html,
          contentJson: page.content_json,
          status: page.status,
          version: page.version,
          publishedAt: page.published_at?.toISOString() ?? null,
          generatedByModel: page.generated_by_model,
          generationError: page.generation_error,
          createdBy: page.created_by,
          createdAt: page.created_at.toISOString(),
          updatedAt: page.updated_at.toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error, pageId }, 'Error fetching SEO page');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch SEO page',
        },
      });
    }
  });

  /**
   * POST /admin/seo/pages - Create a new SEO page for a companion
   */
  app.post('/pages', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = CreateSeoPageBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: bodyResult.error.issues,
        },
      });
    }

    const { companionId, generateNow } = bodyResult.data;
    const userId = request.user!.userId;

    try {
      // Check if companion exists
      const companion = await companionsRepo.findByIdWithAvatar(companionId);
      if (!companion) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COMPANION_NOT_FOUND',
            message: 'Companion not found',
          },
        });
      }

      // Check if SEO page already exists for this companion
      const existing = await seoPagesRepo.findByCompanionId(companionId);
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'PAGE_EXISTS',
            message: 'SEO page already exists for this companion',
            pageId: existing.id,
          },
        });
      }

      // Generate slug from companion name
      const slug = await seoPagesRepo.generateSlug(companion.name);

      // Create the page
      const page = await seoPagesRepo.create({
        companion_id: companionId,
        slug,
        title: `Meet ${companion.name} - Your AI Companion`,
        meta_description: `Chat with ${companion.name}, your personalized AI companion.`,
        og_title: companion.name,
        og_description: null,
        og_image_url: companion.activeAvatar?.asset_url ?? null,
        status: generateNow ? 'generating' : 'draft',
        created_by: userId,
      });

      // If generateNow is true, trigger generation in background
      if (generateNow) {
        // Fire and forget - generation happens async
        generateSeoContent(page.id, companion).catch((error) => {
          logger.error({ error, pageId: page.id }, 'Background SEO generation failed');
        });
      }

      return reply.status(201).send({
        success: true,
        data: {
          id: page.id,
          slug: page.slug,
          status: page.status,
          message: generateNow
            ? 'SEO page created and generation started'
            : 'SEO page created in draft mode',
        },
      });
    } catch (error) {
      logger.error({ error, companionId }, 'Error creating SEO page');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create SEO page',
        },
      });
    }
  });

  /**
   * PATCH /admin/seo/pages/:pageId - Update SEO page metadata
   */
  app.patch('/pages/:pageId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = PageIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid page ID',
        },
      });
    }

    const bodyResult = UpdateSeoPageBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: bodyResult.error.issues,
        },
      });
    }

    const { pageId } = paramsResult.data;
    const updates = bodyResult.data;

    try {
      const page = await seoPagesRepo.update(pageId, {
        title: updates.title,
        meta_description: updates.metaDescription,
        og_title: updates.ogTitle,
        og_description: updates.ogDescription,
        og_image_url: updates.ogImageUrl,
      });

      return reply.send({
        success: true,
        data: {
          id: page.id,
          slug: page.slug,
          title: page.title,
          status: page.status,
          updatedAt: page.updated_at.toISOString(),
        },
      });
    } catch (error: unknown) {
      if ((error as Error).message?.includes('not found')) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PAGE_NOT_FOUND',
            message: 'SEO page not found',
          },
        });
      }
      logger.error({ error, pageId }, 'Error updating SEO page');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update SEO page',
        },
      });
    }
  });

  /**
   * DELETE /admin/seo/pages/:pageId - Delete an SEO page
   */
  app.delete('/pages/:pageId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = PageIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid page ID',
        },
      });
    }

    const { pageId } = paramsResult.data;

    try {
      await seoPagesRepo.delete(pageId);

      return reply.send({
        success: true,
        data: {
          message: 'SEO page deleted successfully',
        },
      });
    } catch (error: unknown) {
      if ((error as Error).message?.includes('not found')) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PAGE_NOT_FOUND',
            message: 'SEO page not found',
          },
        });
      }
      logger.error({ error, pageId }, 'Error deleting SEO page');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete SEO page',
        },
      });
    }
  });

  // ===========================================================================
  // Actions
  // ===========================================================================

  /**
   * POST /admin/seo/pages/:pageId/regenerate - Regenerate content with AI
   */
  app.post('/pages/:pageId/regenerate', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = PageIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid page ID',
        },
      });
    }

    const { pageId } = paramsResult.data;

    try {
      const page = await seoPagesRepo.findById(pageId);
      if (!page) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PAGE_NOT_FOUND',
            message: 'SEO page not found',
          },
        });
      }

      // Get companion for regeneration
      const companion = await companionsRepo.findByIdWithAvatar(page.companion_id);
      if (!companion) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COMPANION_NOT_FOUND',
            message: 'Associated companion not found',
          },
        });
      }

      // Set status to generating
      await seoPagesRepo.setGenerating(pageId);

      // Trigger regeneration in background
      generateSeoContent(pageId, companion).catch((error) => {
        logger.error({ error, pageId }, 'Background SEO regeneration failed');
      });

      return reply.send({
        success: true,
        data: {
          message: 'SEO content regeneration started',
          pageId,
        },
      });
    } catch (error) {
      logger.error({ error, pageId }, 'Error triggering SEO regeneration');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to trigger regeneration',
        },
      });
    }
  });

  /**
   * POST /admin/seo/pages/:pageId/publish - Publish an SEO page
   */
  app.post('/pages/:pageId/publish', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = PageIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid page ID',
        },
      });
    }

    const { pageId } = paramsResult.data;

    try {
      const page = await seoPagesRepo.findById(pageId);
      if (!page) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PAGE_NOT_FOUND',
            message: 'SEO page not found',
          },
        });
      }

      if (page.status === 'generating') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'GENERATION_IN_PROGRESS',
            message: 'Cannot publish while content is generating',
          },
        });
      }

      if (!page.content_html || page.content_html.trim() === '') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'NO_CONTENT',
            message: 'Cannot publish page without generated content',
          },
        });
      }

      const updated = await seoPagesRepo.publish(pageId);

      return reply.send({
        success: true,
        data: {
          id: updated.id,
          slug: updated.slug,
          status: updated.status,
          publishedAt: updated.published_at?.toISOString(),
          version: updated.version,
        },
      });
    } catch (error) {
      logger.error({ error, pageId }, 'Error publishing SEO page');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to publish SEO page',
        },
      });
    }
  });

  /**
   * POST /admin/seo/pages/:pageId/unpublish - Unpublish an SEO page
   */
  app.post('/pages/:pageId/unpublish', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = PageIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid page ID',
        },
      });
    }

    const { pageId } = paramsResult.data;

    try {
      const updated = await seoPagesRepo.unpublish(pageId);

      return reply.send({
        success: true,
        data: {
          id: updated.id,
          slug: updated.slug,
          status: updated.status,
        },
      });
    } catch (error: unknown) {
      if ((error as Error).message?.includes('not found')) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PAGE_NOT_FOUND',
            message: 'SEO page not found',
          },
        });
      }
      logger.error({ error, pageId }, 'Error unpublishing SEO page');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to unpublish SEO page',
        },
      });
    }
  });

  // ===========================================================================
  // Companion Helpers
  // ===========================================================================

  /**
   * GET /admin/seo/companions/available - List companions without SEO pages
   */
  app.get('/companions/available', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CompanionsAvailableQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
        },
      });
    }

    const { limit, offset } = queryResult.data;

    try {
      const result = await seoPagesRepo.listCompanionsWithoutSeoPage(limit, offset);

      return reply.send({
        success: true,
        data: {
          companions: result.data.map((c: { id: string; name: string; avatar_url: string | null }) => ({
            id: c.id,
            name: c.name,
            avatarUrl: c.avatar_url,
          })),
          hasMore: result.hasMore,
          total: result.total,
          limit,
          offset,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error listing available companions');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list available companions',
        },
      });
    }
  });
}
