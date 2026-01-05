/**
 * Gift Templates Repository
 * Data access for the global gift template library.
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type {
  GiftTemplate,
  GiftTemplateInsert,
  GiftTemplateStatus,
  GiftTemplateCategory,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { validateUuid, wrapDatabaseError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export type GiftTemplateSortBy = 'popular' | 'trending' | 'recent';

export interface GiftTemplateListFilters extends PaginationOptions {
  category?: GiftTemplateCategory;
  tier?: string;
  sort?: GiftTemplateSortBy;
  status?: GiftTemplateStatus;
  /** Filter by companion - shows templates for this companion OR public templates */
  companionId?: string;
}

// ============================================================================
// Repository
// ============================================================================

export class GiftTemplatesRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  /**
   * List gift templates with filtering and sorting
   */
  async listTemplates(
    filters: GiftTemplateListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<GiftTemplate>> {
    const db = this.getSql(tx);
    const {
      category,
      tier,
      sort = 'popular',
      status = 'active',
      companionId,
      limit = 20,
      offset = 0,
    } = filters;

    // Build dynamic WHERE clause
    const conditions: string[] = ['status = $1'];
    const params: unknown[] = [status];
    let paramIndex = 2;

    if (category) {
      conditions.push(`category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    if (tier) {
      conditions.push(`tier = $${paramIndex}`);
      params.push(tier);
      paramIndex++;
    }

    // Filter by companion visibility: show templates for this companion OR public templates
    if (companionId) {
      conditions.push(`(source_companion_id = $${paramIndex} OR is_public = true)`);
      params.push(companionId);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Determine ORDER BY
    let orderBy: string;
    switch (sort) {
      case 'trending':
        orderBy = 'sends_last_7_days DESC, total_sends DESC';
        break;
      case 'recent':
        orderBy = 'created_at DESC';
        break;
      case 'popular':
      default:
        orderBy = 'total_sends DESC, created_at DESC';
        break;
    }

    // Use raw query for dynamic conditions
    try {
      const countResult = await db.unsafe<{ count: string }[]>(
        `SELECT COUNT(*) as count FROM gift_templates WHERE ${whereClause}`,
        params as (string | number | boolean | null)[]
      );
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const dataParams = [...params, limit, offset];
      const result = await db.unsafe<GiftTemplate[]>(
        `SELECT
          id, name, description, visual_prompt, emotional_meaning,
          image_url, s3_bucket, s3_key,
          category, token_cost, tier, status,
          total_sends, sends_last_7_days, sends_last_30_days, last_sent_at,
          source_gift_id, source_companion_id, is_public, content_hash,
          created_at, updated_at
        FROM gift_templates
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        dataParams as (string | number | boolean | null)[]
      );

      return {
        data: result.map(this.mapTemplate),
        total,
        hasMore: offset + result.length < total,
      };
    } catch (error) {
      throw wrapDatabaseError(error, 'listTemplates');
    }
  }

  /**
   * Find a template by ID
   */
  async findById(id: string, tx?: TransactionContext): Promise<GiftTemplate | null> {
    validateUuid(id, 'template ID');
    const db = this.getSql(tx);

    try {
      const result = await db`
        SELECT
          id, name, description, visual_prompt, emotional_meaning,
          image_url, s3_bucket, s3_key,
          category, token_cost, tier, status,
          total_sends, sends_last_7_days, sends_last_30_days, last_sent_at,
          source_gift_id, source_companion_id, is_public, content_hash,
          created_at, updated_at
        FROM gift_templates
        WHERE id = ${id}
      `;

      return result[0] ? this.mapTemplate(result[0]) : null;
    } catch (error) {
      throw wrapDatabaseError(error, 'findById');
    }
  }

  /**
   * Find a template by content hash
   */
  async findByContentHash(hash: string, tx?: TransactionContext): Promise<GiftTemplate | null> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        SELECT
          id, name, description, visual_prompt, emotional_meaning,
          image_url, s3_bucket, s3_key,
          category, token_cost, tier, status,
          total_sends, sends_last_7_days, sends_last_30_days, last_sent_at,
          source_gift_id, source_companion_id, is_public, content_hash,
          created_at, updated_at
        FROM gift_templates
        WHERE content_hash = ${hash}
      `;

      return result[0] ? this.mapTemplate(result[0]) : null;
    } catch (error) {
      throw wrapDatabaseError(error, 'findByContentHash');
    }
  }

  /**
   * Create a new template (used when a gift is generated)
   * Uses ON CONFLICT DO NOTHING for deduplication
   */
  async createTemplate(
    data: GiftTemplateInsert,
    tx?: TransactionContext
  ): Promise<GiftTemplate | null> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO gift_templates (
          name, description, visual_prompt, emotional_meaning,
          image_url, s3_bucket, s3_key,
          category, token_cost, tier,
          source_gift_id, source_companion_id, is_public, content_hash
        ) VALUES (
          ${data.name},
          ${data.description ?? null},
          ${data.visual_prompt ?? null},
          ${data.emotional_meaning ?? null},
          ${data.image_url},
          ${data.s3_bucket ?? null},
          ${data.s3_key ?? null},
          ${data.category ?? 'other'},
          ${data.token_cost},
          ${data.tier ?? 'medium'},
          ${data.source_gift_id ?? null},
          ${data.source_companion_id ?? null},
          ${data.is_public ?? false},
          ${data.content_hash}
        )
        ON CONFLICT (content_hash) DO NOTHING
        RETURNING
          id, name, description, visual_prompt, emotional_meaning,
          image_url, s3_bucket, s3_key,
          category, token_cost, tier, status,
          total_sends, sends_last_7_days, sends_last_30_days, last_sent_at,
          source_gift_id, source_companion_id, is_public, content_hash,
          created_at, updated_at
      `;

      if (result.length === 0) {
        // Duplicate - content hash already exists
        logger.debug({ contentHash: data.content_hash }, 'Gift template already exists, skipping');
        return null;
      }

      logger.info({ templateId: result[0].id, name: data.name }, 'Gift template created');
      return this.mapTemplate(result[0]);
    } catch (error) {
      throw wrapDatabaseError(error, 'createTemplate');
    }
  }

  /**
   * Increment popularity counters when a gift is sent from this template
   */
  async incrementPopularity(templateId: string, tx?: TransactionContext): Promise<void> {
    validateUuid(templateId, 'template ID');
    const db = this.getSql(tx);

    try {
      await db`
        UPDATE gift_templates
        SET
          total_sends = total_sends + 1,
          sends_last_7_days = sends_last_7_days + 1,
          sends_last_30_days = sends_last_30_days + 1,
          last_sent_at = NOW()
        WHERE id = ${templateId}
      `;
    } catch (error) {
      throw wrapDatabaseError(error, 'incrementPopularity');
    }
  }

  /**
   * Update template status (for moderation)
   */
  async updateStatus(
    templateId: string,
    status: GiftTemplateStatus,
    tx?: TransactionContext
  ): Promise<GiftTemplate | null> {
    validateUuid(templateId, 'template ID');
    const db = this.getSql(tx);

    try {
      const result = await db`
        UPDATE gift_templates
        SET status = ${status}
        WHERE id = ${templateId}
        RETURNING
          id, name, description, visual_prompt, emotional_meaning,
          image_url, s3_bucket, s3_key,
          category, token_cost, tier, status,
          total_sends, sends_last_7_days, sends_last_30_days, last_sent_at,
          source_gift_id, source_companion_id, is_public, content_hash,
          created_at, updated_at
      `;

      return result[0] ? this.mapTemplate(result[0]) : null;
    } catch (error) {
      throw wrapDatabaseError(error, 'updateStatus');
    }
  }

  /**
   * Get template count by category (for UI)
   */
  async getCountsByCategory(tx?: TransactionContext): Promise<Record<GiftTemplateCategory, number>> {
    const db = this.getSql(tx);

    try {
      const result = await db<{ category: GiftTemplateCategory; count: string }[]>`
        SELECT category, COUNT(*) as count
        FROM gift_templates
        WHERE status = 'active'
        GROUP BY category
      `;

      const counts: Record<string, number> = {};
      for (const row of result) {
        counts[row.category] = parseInt(row.count, 10);
      }

      return counts as Record<GiftTemplateCategory, number>;
    } catch (error) {
      throw wrapDatabaseError(error, 'getCountsByCategory');
    }
  }

  /**
   * Map database row to GiftTemplate
   */
  private mapTemplate(row: postgres.Row): GiftTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      visual_prompt: row.visual_prompt,
      emotional_meaning: row.emotional_meaning,
      image_url: row.image_url,
      s3_bucket: row.s3_bucket,
      s3_key: row.s3_key,
      category: row.category,
      token_cost: row.token_cost,
      tier: row.tier,
      status: row.status,
      total_sends: row.total_sends,
      sends_last_7_days: row.sends_last_7_days,
      sends_last_30_days: row.sends_last_30_days,
      last_sent_at: row.last_sent_at,
      source_gift_id: row.source_gift_id,
      source_companion_id: row.source_companion_id,
      is_public: row.is_public,
      content_hash: row.content_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let repository: GiftTemplatesRepository | null = null;

export function getGiftTemplatesRepository(): GiftTemplatesRepository {
  if (!repository) {
    repository = new GiftTemplatesRepository();
  }
  return repository;
}
