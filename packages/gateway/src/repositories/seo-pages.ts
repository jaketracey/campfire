/**
 * SEO Pages Repository
 * Data access for seo_pages table
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type {
  SeoPage,
  SeoPageInsert,
  SeoPageUpdate,
  SeoPageStatus,
  SeoPageContentJson,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError, validateUuid } from './errors.js';

/**
 * SEO page with companion info for admin listings
 */
export interface SeoPageWithCompanion extends SeoPage {
  companion_name: string;
  companion_avatar_url: string | null;
}

/**
 * SEO page list filters
 */
export interface SeoPageListFilters extends PaginationOptions {
  status?: SeoPageStatus;
  search?: string;
}

/**
 * Published SEO page for sitemap
 */
export interface SitemapEntry {
  slug: string;
  updated_at: Date;
}

export class SeoPagesRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Core CRUD Operations
  // ===========================================================================

  async findById(id: string, tx?: TransactionContext): Promise<SeoPage | null> {
    validateUuid(id, 'seoPage.id');

    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, slug, title, meta_description,
        og_title, og_description, og_image_url,
        content_html, content_json, status, version,
        published_at, generated_by_model, generation_error,
        created_by, created_at, updated_at
      FROM seo_pages
      WHERE id = ${id}
    `;

    return result[0] ? this.mapSeoPage(result[0]) : null;
  }

  async findBySlug(slug: string, tx?: TransactionContext): Promise<SeoPage | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, slug, title, meta_description,
        og_title, og_description, og_image_url,
        content_html, content_json, status, version,
        published_at, generated_by_model, generation_error,
        created_by, created_at, updated_at
      FROM seo_pages
      WHERE slug = ${slug}
    `;

    return result[0] ? this.mapSeoPage(result[0]) : null;
  }

  async findPublishedBySlug(slug: string, tx?: TransactionContext): Promise<SeoPage | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, slug, title, meta_description,
        og_title, og_description, og_image_url,
        content_html, content_json, status, version,
        published_at, generated_by_model, generation_error,
        created_by, created_at, updated_at
      FROM seo_pages
      WHERE slug = ${slug} AND status = 'published'
    `;

    return result[0] ? this.mapSeoPage(result[0]) : null;
  }

  async findByCompanionId(companionId: string, tx?: TransactionContext): Promise<SeoPage | null> {
    validateUuid(companionId, 'seoPage.companionId');

    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, slug, title, meta_description,
        og_title, og_description, og_image_url,
        content_html, content_json, status, version,
        published_at, generated_by_model, generation_error,
        created_by, created_at, updated_at
      FROM seo_pages
      WHERE companion_id = ${companionId}
    `;

    return result[0] ? this.mapSeoPage(result[0]) : null;
  }

  async create(data: SeoPageInsert, tx?: TransactionContext): Promise<SeoPage> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO seo_pages (
          companion_id, slug, title, meta_description,
          og_title, og_description, og_image_url,
          content_html, content_json, status, created_by
        ) VALUES (
          ${data.companion_id},
          ${data.slug},
          ${data.title},
          ${data.meta_description ?? null},
          ${data.og_title ?? null},
          ${data.og_description ?? null},
          ${data.og_image_url ?? null},
          ${data.content_html ?? ''},
          ${JSON.stringify(data.content_json ?? {})},
          ${data.status ?? 'draft'},
          ${data.created_by ?? null}
        )
        RETURNING
          id, companion_id, slug, title, meta_description,
          og_title, og_description, og_image_url,
          content_html, content_json, status, version,
          published_at, generated_by_model, generation_error,
          created_by, created_at, updated_at
      `;

      return this.mapSeoPage(result[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('SeoPage', 'companion_id/slug', data.companion_id);
      }
      throw wrapDatabaseError(error, 'Failed to create SEO page');
    }
  }

  async update(id: string, data: SeoPageUpdate, tx?: TransactionContext): Promise<SeoPage> {
    validateUuid(id, 'seoPage.id');

    const db = this.getSql(tx);

    // Build dynamic update
    const updates: Record<string, unknown> = {};
    if (data.title !== undefined) updates.title = data.title;
    if (data.meta_description !== undefined) updates.meta_description = data.meta_description;
    if (data.og_title !== undefined) updates.og_title = data.og_title;
    if (data.og_description !== undefined) updates.og_description = data.og_description;
    if (data.og_image_url !== undefined) updates.og_image_url = data.og_image_url;
    if (data.content_html !== undefined) updates.content_html = data.content_html;
    if (data.content_json !== undefined) updates.content_json = JSON.stringify(data.content_json);
    if (data.status !== undefined) updates.status = data.status;
    if (data.published_at !== undefined) updates.published_at = data.published_at;
    if (data.generated_by_model !== undefined) updates.generated_by_model = data.generated_by_model;
    if (data.generation_error !== undefined) updates.generation_error = data.generation_error;
    if (data.version !== undefined) updates.version = data.version;

    if (Object.keys(updates).length === 0) {
      const existing = await this.findById(id, tx);
      if (!existing) {
        throw new NotFoundError('SeoPage', id);
      }
      return existing;
    }

    try {
      const result = await db`
        UPDATE seo_pages
        SET ${db(updates)}
        WHERE id = ${id}
        RETURNING
          id, companion_id, slug, title, meta_description,
          og_title, og_description, og_image_url,
          content_html, content_json, status, version,
          published_at, generated_by_model, generation_error,
          created_by, created_at, updated_at
      `;

      if (!result[0]) {
        throw new NotFoundError('SeoPage', id);
      }

      return this.mapSeoPage(result[0]);
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw wrapDatabaseError(error, 'Failed to update SEO page');
    }
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    validateUuid(id, 'seoPage.id');

    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM seo_pages
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('SeoPage', id);
    }
  }

  // ===========================================================================
  // List / Query Operations
  // ===========================================================================

  async list(filters: SeoPageListFilters, tx?: TransactionContext): Promise<PaginatedResult<SeoPageWithCompanion>> {
    const db = this.getSql(tx);
    const { limit = 20, offset = 0, status, search } = filters;

    // Build WHERE conditions
    const conditions: postgres.PendingQuery<postgres.Row[]>[] = [];

    if (status) {
      conditions.push(db`sp.status = ${status}`);
    }

    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(db`(
        c.name ILIKE ${searchTerm} OR
        sp.slug ILIKE ${searchTerm} OR
        sp.title ILIKE ${searchTerm}
      )`);
    }

    const whereClause = conditions.length > 0
      ? db`WHERE ${conditions.reduce((acc, cond, i) => i === 0 ? cond : db`${acc} AND ${cond}`)}`
      : db``;

    // Count total
    const countResult = await db`
      SELECT COUNT(*) as total
      FROM seo_pages sp
      JOIN companions c ON sp.companion_id = c.id
      ${whereClause}
    `;
    const total = Number(countResult[0]?.total ?? 0);

    // Fetch page
    const result = await db`
      SELECT
        sp.id, sp.companion_id, sp.slug, sp.title, sp.meta_description,
        sp.og_title, sp.og_description, sp.og_image_url,
        sp.content_html, sp.content_json, sp.status, sp.version,
        sp.published_at, sp.generated_by_model, sp.generation_error,
        sp.created_by, sp.created_at, sp.updated_at,
        c.name as companion_name,
        ca.asset_url as companion_avatar_url
      FROM seo_pages sp
      JOIN companions c ON sp.companion_id = c.id
      LEFT JOIN companion_avatars ca ON c.active_avatar_id = ca.id
      ${whereClause}
      ORDER BY sp.updated_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const data = result.map((row) => this.mapSeoPageWithCompanion(row));

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Get all published pages for sitemap generation
   */
  async listPublishedForSitemap(tx?: TransactionContext): Promise<SitemapEntry[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT slug, updated_at
      FROM seo_pages
      WHERE status = 'published'
      ORDER BY published_at DESC
    `;

    return result.map((row) => ({
      slug: row['slug'] as string,
      updated_at: new Date(row['updated_at'] as string),
    }));
  }

  /**
   * Get companions that don't have an SEO page yet
   */
  async listCompanionsWithoutSeoPage(
    limit = 50,
    offset = 0,
    tx?: TransactionContext
  ): Promise<PaginatedResult<{ id: string; name: string; avatar_url: string | null }>> {
    const db = this.getSql(tx);

    const countResult = await db`
      SELECT COUNT(*) as total
      FROM companions c
      WHERE c.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM seo_pages sp WHERE sp.companion_id = c.id
        )
    `;
    const total = Number(countResult[0]?.total ?? 0);

    const result = await db`
      SELECT
        c.id,
        c.name,
        ca.asset_url as avatar_url
      FROM companions c
      LEFT JOIN companion_avatars ca ON c.active_avatar_id = ca.id
      WHERE c.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM seo_pages sp WHERE sp.companion_id = c.id
        )
      ORDER BY c.name ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const data = result.map((row) => ({
      id: row['id'] as string,
      name: row['name'] as string,
      avatar_url: row['avatar_url'] as string | null,
    }));

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  // ===========================================================================
  // Status Operations
  // ===========================================================================

  async publish(id: string, tx?: TransactionContext): Promise<SeoPage> {
    return this.update(id, {
      status: 'published',
      published_at: new Date(),
      version: await this.getNextVersion(id, tx),
    }, tx);
  }

  async unpublish(id: string, tx?: TransactionContext): Promise<SeoPage> {
    return this.update(id, {
      status: 'draft',
      published_at: null,
    }, tx);
  }

  async setGenerating(id: string, tx?: TransactionContext): Promise<SeoPage> {
    return this.update(id, {
      status: 'generating',
      generation_error: null,
    }, tx);
  }

  async setGenerationComplete(
    id: string,
    content: {
      content_html: string;
      content_json: SeoPageContentJson;
      title: string;
      meta_description: string;
      generated_by_model: string;
    },
    tx?: TransactionContext
  ): Promise<SeoPage> {
    return this.update(id, {
      status: 'draft',
      content_html: content.content_html,
      content_json: content.content_json,
      title: content.title,
      meta_description: content.meta_description,
      generated_by_model: content.generated_by_model,
      generation_error: null,
    }, tx);
  }

  async setGenerationError(id: string, error: string, tx?: TransactionContext): Promise<SeoPage> {
    return this.update(id, {
      status: 'draft',
      generation_error: error,
    }, tx);
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private async getNextVersion(id: string, tx?: TransactionContext): Promise<number> {
    const page = await this.findById(id, tx);
    return page ? page.version + 1 : 1;
  }

  /**
   * Generate a URL-safe slug from companion name
   */
  async generateSlug(name: string, tx?: TransactionContext): Promise<string> {
    const db = this.getSql(tx);

    // Convert to lowercase, replace spaces/special chars with hyphens
    let baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 80);

    // Check for existing slugs and add suffix if needed
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await db`
        SELECT id FROM seo_pages WHERE slug = ${slug}
      `;

      if (existing.length === 0) {
        break;
      }

      counter++;
      slug = `${baseSlug}-${counter}`;
    }

    return slug;
  }

  // ===========================================================================
  // Mappers
  // ===========================================================================

  private mapSeoPage(row: postgres.Row): SeoPage {
    return {
      id: row['id'] as string,
      companion_id: row['companion_id'] as string,
      slug: row['slug'] as string,
      title: row['title'] as string,
      meta_description: row['meta_description'] as string | null,
      og_title: row['og_title'] as string | null,
      og_description: row['og_description'] as string | null,
      og_image_url: row['og_image_url'] as string | null,
      content_html: row['content_html'] as string,
      content_json: (row['content_json'] ?? {}) as SeoPageContentJson,
      status: row['status'] as SeoPageStatus,
      version: row['version'] as number,
      published_at: row['published_at'] ? new Date(row['published_at'] as string) : null,
      generated_by_model: row['generated_by_model'] as string | null,
      generation_error: row['generation_error'] as string | null,
      created_by: row['created_by'] as string | null,
      created_at: new Date(row['created_at'] as string),
      updated_at: new Date(row['updated_at'] as string),
    };
  }

  private mapSeoPageWithCompanion(row: postgres.Row): SeoPageWithCompanion {
    return {
      ...this.mapSeoPage(row),
      companion_name: row['companion_name'] as string,
      companion_avatar_url: row['companion_avatar_url'] as string | null,
    };
  }
}

// Singleton instance
let instance: SeoPagesRepository | null = null;

export function getSeoPagesRepository(): SeoPagesRepository {
  if (!instance) {
    instance = new SeoPagesRepository();
  }
  return instance;
}
