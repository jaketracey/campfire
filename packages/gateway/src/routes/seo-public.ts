/**
 * Public SEO Routes
 * Public endpoints for SEO pages (no authentication required).
 * These are consumed by the Next.js frontend for SSR.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../observability/logger.js';
import { getSeoPagesRepository } from '../repositories/seo-pages.js';
import { getCompanionsRepository } from '../repositories/companions.js';

// Params schemas
const SlugParamsSchema = z.object({
  slug: z.string().min(1).max(100),
});

/**
 * Register public SEO routes (no authentication required)
 */
export async function seoPublicRoutes(app: FastifyInstance): Promise<void> {
  const seoPagesRepo = getSeoPagesRepository();
  const companionsRepo = getCompanionsRepository();

  /**
   * GET /public/companions/:slug
   * Returns a published SEO page by slug for SSR rendering
   */
  app.get('/companions/:slug', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = SlugParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_SLUG',
          message: 'Invalid slug format',
        },
      });
    }

    const { slug } = paramsResult.data;

    try {
      const seoPage = await seoPagesRepo.findPublishedBySlug(slug);

      if (!seoPage) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PAGE_NOT_FOUND',
            message: 'SEO page not found or not published',
          },
        });
      }

      // Get companion data for additional context
      const companion = await companionsRepo.findByIdWithAvatar(seoPage.companion_id);

      return reply.send({
        success: true,
        data: {
          id: seoPage.id,
          slug: seoPage.slug,
          title: seoPage.title,
          metaDescription: seoPage.meta_description,
          ogTitle: seoPage.og_title,
          ogDescription: seoPage.og_description,
          ogImageUrl: seoPage.og_image_url,
          contentHtml: seoPage.content_html,
          contentJson: seoPage.content_json,
          publishedAt: seoPage.published_at?.toISOString() ?? null,
          updatedAt: seoPage.updated_at.toISOString(),
          companion: companion ? {
            id: companion.id,
            name: companion.name,
            avatarUrl: companion.activeAvatar?.asset_url ?? null,
            spec: {
              identity: companion.spec.identity,
              personality: companion.spec.personality,
            },
          } : null,
        },
      });
    } catch (error) {
      logger.error({ error, slug }, 'Error fetching SEO page');
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
   * GET /public/sitemap
   * Returns all published SEO pages for sitemap generation
   */
  app.get('/sitemap', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const entries = await seoPagesRepo.listPublishedForSitemap();

      return reply.send({
        success: true,
        data: {
          pages: entries.map((entry) => ({
            slug: entry.slug,
            updatedAt: entry.updated_at.toISOString(),
          })),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching sitemap data');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch sitemap data',
        },
      });
    }
  });
}
