/**
 * Creative Repository
 * Data access for ad_creatives and creative_assets tables
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  AdCreative,
  AdCreativeInsert,
  AdCreativeUpdate,
  AdCreativeStatus,
  CreativeAsset,
  CreativeAssetInsert,
  CreativeAssetUpdate,
  CreativeAssetType,
  CreativeAssetStatus,
  UUID,
} from '../db/types.js';
import type {
  TransactionContext,
  PaginationOptions,
  PaginatedResult,
} from './types.js';
import { NotFoundError, wrapDatabaseError } from './errors.js';

// ============================================================================
// Filter Types
// ============================================================================

export interface CreativeListFilters extends PaginationOptions {
  userId?: string;
  companionId?: string;
  status?: AdCreativeStatus | AdCreativeStatus[];
  isAdminCreated?: boolean;
}

export interface CreativeAssetListFilters {
  creativeId: string;
  assetType?: CreativeAssetType;
  status?: CreativeAssetStatus;
}

// ============================================================================
// Repository
// ============================================================================

export class CreativeRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Ad Creatives
  // ===========================================================================

  async createCreative(
    data: AdCreativeInsert,
    tx?: TransactionContext
  ): Promise<AdCreative> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO ad_creatives (
          user_id, companion_id, name, description, status,
          video_model_id, source_image_url, source_image_s3_key,
          video_prompt, video_duration_seconds, width, height,
          script_text, voice_id, voice_settings,
          token_cost, is_admin_created
        ) VALUES (
          ${data.user_id ?? null},
          ${data.companion_id ?? null},
          ${data.name},
          ${data.description ?? null},
          ${data.status ?? 'draft'},
          ${data.video_model_id ?? null},
          ${data.source_image_url ?? null},
          ${data.source_image_s3_key ?? null},
          ${data.video_prompt ?? null},
          ${data.video_duration_seconds ?? 5},
          ${data.width ?? 1080},
          ${data.height ?? 1920},
          ${data.script_text ?? null},
          ${data.voice_id ?? null},
          ${data.voice_settings ? JSON.stringify(data.voice_settings) : null},
          ${data.token_cost ?? 0},
          ${data.is_admin_created ?? false}
        )
        RETURNING *
      `;

      const creative = this.mapCreative(result[0]!);
      logger.info({ creativeId: creative.id, name: creative.name }, 'Creative created');
      return creative;
    } catch (error) {
      throw wrapDatabaseError(error, 'creative.createCreative');
    }
  }

  async updateCreative(
    id: string,
    data: AdCreativeUpdate,
    tx?: TransactionContext
  ): Promise<AdCreative> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE ad_creatives
      SET
        name = COALESCE(${data.name ?? null}, name),
        description = COALESCE(${data.description ?? null}, description),
        status = COALESCE(${data.status ?? null}, status),
        video_model_id = COALESCE(${data.video_model_id ?? null}, video_model_id),
        source_image_url = COALESCE(${data.source_image_url ?? null}, source_image_url),
        source_image_s3_key = COALESCE(${data.source_image_s3_key ?? null}, source_image_s3_key),
        video_prompt = COALESCE(${data.video_prompt ?? null}, video_prompt),
        video_duration_seconds = COALESCE(${data.video_duration_seconds ?? null}, video_duration_seconds),
        width = COALESCE(${data.width ?? null}, width),
        height = COALESCE(${data.height ?? null}, height),
        script_text = COALESCE(${data.script_text ?? null}, script_text),
        voice_id = COALESCE(${data.voice_id ?? null}, voice_id),
        voice_settings = COALESCE(${data.voice_settings ? JSON.stringify(data.voice_settings) : null}, voice_settings),
        video_url = COALESCE(${data.video_url ?? null}, video_url),
        video_s3_key = COALESCE(${data.video_s3_key ?? null}, video_s3_key),
        voiceover_url = COALESCE(${data.voiceover_url ?? null}, voiceover_url),
        voiceover_s3_key = COALESCE(${data.voiceover_s3_key ?? null}, voiceover_s3_key),
        final_video_url = COALESCE(${data.final_video_url ?? null}, final_video_url),
        final_video_s3_key = COALESCE(${data.final_video_s3_key ?? null}, final_video_s3_key),
        thumbnail_url = COALESCE(${data.thumbnail_url ?? null}, thumbnail_url),
        thumbnail_s3_key = COALESCE(${data.thumbnail_s3_key ?? null}, thumbnail_s3_key),
        file_size_bytes = COALESCE(${data.file_size_bytes ?? null}, file_size_bytes),
        published_platforms = COALESCE(${data.published_platforms ? JSON.stringify(data.published_platforms) : null}, published_platforms),
        generation_started_at = COALESCE(${data.generation_started_at ?? null}, generation_started_at),
        generation_completed_at = COALESCE(${data.generation_completed_at ?? null}, generation_completed_at),
        generation_error = ${data.generation_error === undefined ? null : data.generation_error}
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('AdCreative', id);
    }

    logger.debug({ creativeId: id }, 'Creative updated');
    return this.mapCreative(result[0]);
  }

  async getCreativeById(
    id: string,
    tx?: TransactionContext
  ): Promise<AdCreative | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM ad_creatives WHERE id = ${id}
    `;

    return result[0] ? this.mapCreative(result[0]) : null;
  }

  async listCreatives(
    filters: CreativeListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<AdCreative>> {
    const db = this.getSql(tx);
    const { limit = 20, offset = 0, userId, companionId, status, isAdminCreated } = filters;

    // Build dynamic conditions
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (userId) {
      conditions.push('user_id = $' + (values.length + 1));
      values.push(userId);
    }

    if (companionId) {
      conditions.push('companion_id = $' + (values.length + 1));
      values.push(companionId);
    }

    if (status) {
      if (Array.isArray(status)) {
        conditions.push('status = ANY($' + (values.length + 1) + ')');
        values.push(status);
      } else {
        conditions.push('status = $' + (values.length + 1));
        values.push(status);
      }
    }

    if (isAdminCreated !== undefined) {
      conditions.push('is_admin_created = $' + (values.length + 1));
      values.push(isAdminCreated);
    }

    // Use simpler query approach
    let result;
    if (userId && status) {
      const statusArray = Array.isArray(status) ? status : [status];
      result = await db`
        SELECT * FROM ad_creatives
        WHERE user_id = ${userId}
          AND status = ANY(${statusArray})
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else if (userId) {
      result = await db`
        SELECT * FROM ad_creatives
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else if (isAdminCreated !== undefined) {
      result = await db`
        SELECT * FROM ad_creatives
        WHERE is_admin_created = ${isAdminCreated}
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else {
      result = await db`
        SELECT * FROM ad_creatives
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    }

    const hasMore = result.length > limit;
    const items = (hasMore ? result.slice(0, limit) : result).map((row) =>
      this.mapCreative(row)
    );

    return { data: items, hasMore };
  }

  async deleteCreative(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM ad_creatives WHERE id = ${id} RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('AdCreative', id);
    }

    logger.info({ creativeId: id }, 'Creative deleted');
  }

  // ===========================================================================
  // Creative Assets
  // ===========================================================================

  async createAsset(
    data: CreativeAssetInsert,
    tx?: TransactionContext
  ): Promise<CreativeAsset> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO creative_assets (
          creative_id, asset_type, status,
          s3_key, s3_bucket, url,
          duration_ms, file_size_bytes, format,
          width, height,
          generation_params, metadata
        ) VALUES (
          ${data.creative_id},
          ${data.asset_type},
          ${data.status ?? 'pending'},
          ${data.s3_key ?? null},
          ${data.s3_bucket ?? null},
          ${data.url ?? null},
          ${data.duration_ms ?? null},
          ${data.file_size_bytes ?? null},
          ${data.format ?? null},
          ${data.width ?? null},
          ${data.height ?? null},
          ${data.generation_params ? JSON.stringify(data.generation_params) : null},
          ${data.metadata ? JSON.stringify(data.metadata) : null}
        )
        RETURNING *
      `;

      const asset = this.mapAsset(result[0]!);
      logger.debug({ assetId: asset.id, type: asset.asset_type }, 'Creative asset created');
      return asset;
    } catch (error) {
      throw wrapDatabaseError(error, 'creative.createAsset');
    }
  }

  async updateAsset(
    id: string,
    data: CreativeAssetUpdate,
    tx?: TransactionContext
  ): Promise<CreativeAsset> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE creative_assets
      SET
        status = COALESCE(${data.status ?? null}, status),
        s3_key = COALESCE(${data.s3_key ?? null}, s3_key),
        s3_bucket = COALESCE(${data.s3_bucket ?? null}, s3_bucket),
        url = COALESCE(${data.url ?? null}, url),
        duration_ms = COALESCE(${data.duration_ms ?? null}, duration_ms),
        file_size_bytes = COALESCE(${data.file_size_bytes ?? null}, file_size_bytes),
        format = COALESCE(${data.format ?? null}, format),
        width = COALESCE(${data.width ?? null}, width),
        height = COALESCE(${data.height ?? null}, height),
        generation_error = ${data.generation_error === undefined ? null : data.generation_error},
        processing_time_ms = COALESCE(${data.processing_time_ms ?? null}, processing_time_ms),
        metadata = COALESCE(${data.metadata ? JSON.stringify(data.metadata) : null}, metadata)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('CreativeAsset', id);
    }

    return this.mapAsset(result[0]);
  }

  async getAssetById(
    id: string,
    tx?: TransactionContext
  ): Promise<CreativeAsset | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM creative_assets WHERE id = ${id}
    `;

    return result[0] ? this.mapAsset(result[0]) : null;
  }

  async listAssetsByCreativeId(
    creativeId: string,
    filters: Omit<CreativeAssetListFilters, 'creativeId'> = {},
    tx?: TransactionContext
  ): Promise<CreativeAsset[]> {
    const db = this.getSql(tx);
    const { assetType, status } = filters;

    let result;
    if (assetType && status) {
      result = await db`
        SELECT * FROM creative_assets
        WHERE creative_id = ${creativeId}
          AND asset_type = ${assetType}
          AND status = ${status}
        ORDER BY created_at DESC
      `;
    } else if (assetType) {
      result = await db`
        SELECT * FROM creative_assets
        WHERE creative_id = ${creativeId}
          AND asset_type = ${assetType}
        ORDER BY created_at DESC
      `;
    } else if (status) {
      result = await db`
        SELECT * FROM creative_assets
        WHERE creative_id = ${creativeId}
          AND status = ${status}
        ORDER BY created_at DESC
      `;
    } else {
      result = await db`
        SELECT * FROM creative_assets
        WHERE creative_id = ${creativeId}
        ORDER BY created_at DESC
      `;
    }

    return result.map((row) => this.mapAsset(row));
  }

  async deleteAsset(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM creative_assets WHERE id = ${id} RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('CreativeAsset', id);
    }

    logger.debug({ assetId: id }, 'Creative asset deleted');
  }

  // ===========================================================================
  // Mappers
  // ===========================================================================

  private mapCreative(row: Record<string, unknown>): AdCreative {
    return {
      id: row.id as UUID,
      user_id: row.user_id as UUID | null,
      companion_id: row.companion_id as UUID | null,
      name: row.name as string,
      description: row.description as string | null,
      status: row.status as AdCreativeStatus,
      video_model_id: row.video_model_id as string | null,
      source_image_url: row.source_image_url as string | null,
      source_image_s3_key: row.source_image_s3_key as string | null,
      video_prompt: row.video_prompt as string | null,
      video_duration_seconds: row.video_duration_seconds as number,
      width: row.width as number,
      height: row.height as number,
      script_text: row.script_text as string | null,
      voice_id: row.voice_id as string | null,
      voice_settings: row.voice_settings as AdCreative['voice_settings'],
      video_url: row.video_url as string | null,
      video_s3_key: row.video_s3_key as string | null,
      voiceover_url: row.voiceover_url as string | null,
      voiceover_s3_key: row.voiceover_s3_key as string | null,
      final_video_url: row.final_video_url as string | null,
      final_video_s3_key: row.final_video_s3_key as string | null,
      thumbnail_url: row.thumbnail_url as string | null,
      thumbnail_s3_key: row.thumbnail_s3_key as string | null,
      file_size_bytes: row.file_size_bytes as number | null,
      published_platforms: row.published_platforms as AdCreative['published_platforms'],
      token_cost: row.token_cost as number,
      is_admin_created: row.is_admin_created as boolean,
      generation_started_at: row.generation_started_at as Date | null,
      generation_completed_at: row.generation_completed_at as Date | null,
      generation_error: row.generation_error as string | null,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }

  private mapAsset(row: Record<string, unknown>): CreativeAsset {
    return {
      id: row.id as UUID,
      creative_id: row.creative_id as UUID,
      asset_type: row.asset_type as CreativeAssetType,
      status: row.status as CreativeAssetStatus,
      s3_key: row.s3_key as string | null,
      s3_bucket: row.s3_bucket as string | null,
      url: row.url as string | null,
      duration_ms: row.duration_ms as number | null,
      file_size_bytes: row.file_size_bytes as number | null,
      format: row.format as string | null,
      width: row.width as number | null,
      height: row.height as number | null,
      generation_params: row.generation_params as CreativeAsset['generation_params'],
      generation_error: row.generation_error as string | null,
      processing_time_ms: row.processing_time_ms as number | null,
      metadata: row.metadata as CreativeAsset['metadata'],
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }
}

// Singleton instance
let creativeRepository: CreativeRepository | null = null;

export function getCreativeRepository(): CreativeRepository {
  if (!creativeRepository) {
    creativeRepository = new CreativeRepository();
  }
  return creativeRepository;
}
