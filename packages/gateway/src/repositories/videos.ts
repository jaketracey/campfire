/**
 * Videos Repository
 * Data access for video generation requests
 */

import type postgres from 'postgres';
import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  VideoRequest,
  VideoRequestInsert,
  VideoRequestUpdate,
  VideoRequestStatus,
  VideoRequestWithCompanion,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, validateUuid, wrapDatabaseError } from './errors.js';

// ============================================================================
// Extended Types
// ============================================================================

/**
 * Video request list filters
 */
export interface VideoRequestListFilters extends PaginationOptions {
  status?: VideoRequestStatus | VideoRequestStatus[];
  companionId?: string;
}

/**
 * User media item (unified type for images and videos)
 */
export interface UserMediaItem {
  id: string;
  type: 'image' | 'video';
  url: string | null;
  thumbnailUrl: string | null;
  status: 'pending' | 'generating' | 'encoding' | 'ready' | 'failed';
  companionId: string;
  companionName: string;
  companionAvatarUrl: string | null;
  createdAt: Date;
}

// ============================================================================
// Repository
// ============================================================================

export class VideosRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Video Requests
  // ===========================================================================

  /**
   * Create a new video request
   */
  async createVideoRequest(data: VideoRequestInsert, tx?: TransactionContext): Promise<VideoRequest> {
    validateUuid(data.user_id, 'user_id');
    validateUuid(data.companion_id, 'companion_id');
    if (data.session_id) validateUuid(data.session_id, 'session_id');

    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO video_requests (
          user_id,
          companion_id,
          session_id,
          prompt,
          generated_prompt,
          duration_seconds,
          width,
          height,
          fps,
          token_cost,
          source_turn_id
        ) VALUES (
          ${data.user_id},
          ${data.companion_id},
          ${data.session_id ?? null},
          ${data.prompt},
          ${data.generated_prompt ?? null},
          ${data.duration_seconds ?? 4},
          ${data.width ?? 512},
          ${data.height ?? 768},
          ${data.fps ?? 8},
          ${data.token_cost ?? 100},
          ${data.source_turn_id ?? null}
        )
        RETURNING *
      `;

      logger.debug({ videoRequestId: result[0]!.id, userId: data.user_id }, 'Video request created');
      return this.mapVideoRequest(result[0]!);
    } catch (error) {
      throw wrapDatabaseError(error, 'video_requests.create');
    }
  }

  /**
   * Find video request by ID
   */
  async findById(id: string, tx?: TransactionContext): Promise<VideoRequest | null> {
    validateUuid(id, 'id');
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM video_requests WHERE id = ${id}
    `;

    return result[0] ? this.mapVideoRequest(result[0]) : null;
  }

  /**
   * Find video request by ID with owner check
   */
  async findByIdWithOwnerCheck(id: string, userId: string, tx?: TransactionContext): Promise<VideoRequest | null> {
    validateUuid(id, 'id');
    validateUuid(userId, 'userId');
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM video_requests
      WHERE id = ${id} AND user_id = ${userId}
    `;

    return result[0] ? this.mapVideoRequest(result[0]) : null;
  }

  /**
   * Find video request with companion details
   */
  async findByIdWithCompanion(id: string, userId: string, tx?: TransactionContext): Promise<VideoRequestWithCompanion | null> {
    validateUuid(id, 'id');
    validateUuid(userId, 'userId');
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        vr.*,
        c.name as companion_name,
        (
          SELECT ca.asset_url
          FROM companion_avatars ca
          WHERE ca.companion_id = vr.companion_id AND ca.is_active = true
          ORDER BY ca.created_at DESC
          LIMIT 1
        ) as companion_avatar_url
      FROM video_requests vr
      JOIN companions c ON c.id = vr.companion_id
      WHERE vr.id = ${id} AND vr.user_id = ${userId}
    `;

    return result[0] ? this.mapVideoRequestWithCompanion(result[0]) : null;
  }

  /**
   * Update video request status
   */
  async updateStatus(
    id: string,
    status: VideoRequestStatus,
    error?: string,
    tx?: TransactionContext
  ): Promise<VideoRequest> {
    validateUuid(id, 'id');
    const db = this.getSql(tx);

    const result = await db`
      UPDATE video_requests
      SET
        status = ${status},
        generation_error = ${error ?? null},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('VideoRequest', id);
    }

    logger.debug({ videoRequestId: id, status, error }, 'Video request status updated');
    return this.mapVideoRequest(result[0]);
  }

  /**
   * Mark video request as ready with URLs and metadata
   */
  async setVideoReady(
    id: string,
    data: {
      videoUrl: string;
      s3Bucket: string;
      s3Key: string;
      thumbnailUrl: string;
      thumbnailS3Key: string;
      fileSizeBytes: number;
      processingTimeMs: number;
      generationParams?: JSONObject;
    },
    tx?: TransactionContext
  ): Promise<VideoRequest> {
    validateUuid(id, 'id');
    const db = this.getSql(tx);

    const result = await db`
      UPDATE video_requests
      SET
        status = 'ready',
        s3_bucket = ${data.s3Bucket},
        s3_key = ${data.s3Key},
        video_url = ${data.videoUrl},
        thumbnail_s3_key = ${data.thumbnailS3Key},
        thumbnail_url = ${data.thumbnailUrl},
        file_size_bytes = ${data.fileSizeBytes},
        processing_time_ms = ${data.processingTimeMs},
        generation_params = ${data.generationParams ? db.json(data.generationParams as postgres.JSONValue) : null},
        generation_error = NULL,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('VideoRequest', id);
    }

    logger.info({ videoRequestId: id, processingTimeMs: data.processingTimeMs }, 'Video request completed');
    return this.mapVideoRequest(result[0]);
  }

  /**
   * List video requests for a user
   */
  async listUserVideos(
    userId: string,
    filters: VideoRequestListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<VideoRequestWithCompanion>> {
    validateUuid(userId, 'userId');
    if (filters.companionId) validateUuid(filters.companionId, 'companionId');

    const db = this.getSql(tx);
    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    // Build status filter
    const statusArray = filters.status
      ? Array.isArray(filters.status) ? filters.status : [filters.status]
      : null;

    const result = await db`
      SELECT
        vr.*,
        c.name as companion_name,
        (
          SELECT ca.asset_url
          FROM companion_avatars ca
          WHERE ca.companion_id = vr.companion_id AND ca.is_active = true
          ORDER BY ca.created_at DESC
          LIMIT 1
        ) as companion_avatar_url
      FROM video_requests vr
      JOIN companions c ON c.id = vr.companion_id
      WHERE vr.user_id = ${userId}
        ${filters.companionId ? db`AND vr.companion_id = ${filters.companionId}` : db``}
        ${statusArray ? db`AND vr.status = ANY(${statusArray}::video_request_status[])` : db``}
      ORDER BY vr.created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapVideoRequestWithCompanion(row));

    return {
      data,
      hasMore,
      limit,
      offset,
    };
  }

  /**
   * List all user media (images + videos combined) for Media Gallery
   */
  async listAllUserMedia(
    userId: string,
    filters: PaginationOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<UserMediaItem>> {
    validateUuid(userId, 'userId');

    const db = this.getSql(tx);
    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    // Union of images and videos, sorted by created_at
    const result = await db`
      WITH media AS (
        -- Videos
        SELECT
          vr.id,
          'video' as type,
          vr.video_url as url,
          vr.thumbnail_url,
          vr.status::text,
          vr.companion_id,
          c.name as companion_name,
          (
            SELECT ca.asset_url
            FROM companion_avatars ca
            WHERE ca.companion_id = vr.companion_id AND ca.is_active = true
            ORDER BY ca.created_at DESC
            LIMIT 1
          ) as companion_avatar_url,
          vr.created_at
        FROM video_requests vr
        JOIN companions c ON c.id = vr.companion_id
        WHERE vr.user_id = ${userId}

        UNION ALL

        -- Images (exclude anchor images)
        SELECT
          ci.id,
          'image' as type,
          ci.s3_url as url,
          COALESCE(
            (ci.renditions->>'thumb')::text,
            ci.s3_url
          ) as thumbnail_url,
          'ready' as status,
          ci.companion_id,
          c.name as companion_name,
          (
            SELECT ca.asset_url
            FROM companion_avatars ca
            WHERE ca.companion_id = ci.companion_id AND ca.is_active = true
            ORDER BY ca.created_at DESC
            LIMIT 1
          ) as companion_avatar_url,
          ci.created_at
        FROM companion_images ci
        JOIN companions c ON c.id = ci.companion_id::uuid
        WHERE ci.user_id = ${userId}
          AND ci.session_id NOT LIKE 'anchors-%'
      )
      SELECT * FROM media
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapUserMediaItem(row));

    return {
      data,
      hasMore,
      limit,
      offset,
    };
  }

  /**
   * Get count of pending/generating videos for a user (for status indicator)
   */
  async getActiveVideoCount(userId: string, tx?: TransactionContext): Promise<number> {
    validateUuid(userId, 'userId');
    const db = this.getSql(tx);

    const result = await db`
      SELECT COUNT(*)::int as count
      FROM video_requests
      WHERE user_id = ${userId}
        AND status IN ('pending', 'generating', 'encoding')
    `;

    return result[0]?.count ?? 0;
  }

  // ===========================================================================
  // Mappers
  // ===========================================================================

  private mapVideoRequest(row: Record<string, unknown>): VideoRequest {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      companion_id: row.companion_id as string,
      session_id: row.session_id as string | null,
      prompt: row.prompt as string,
      generated_prompt: row.generated_prompt as string | null,
      duration_seconds: row.duration_seconds as number,
      width: row.width as number,
      height: row.height as number,
      fps: row.fps as number,
      s3_bucket: row.s3_bucket as string | null,
      s3_key: row.s3_key as string | null,
      video_url: row.video_url as string | null,
      thumbnail_s3_key: row.thumbnail_s3_key as string | null,
      thumbnail_url: row.thumbnail_url as string | null,
      file_size_bytes: row.file_size_bytes as number | null,
      status: row.status as VideoRequestStatus,
      token_cost: row.token_cost as number,
      generation_params: row.generation_params as JSONObject | null,
      generation_error: row.generation_error as string | null,
      processing_time_ms: row.processing_time_ms as number | null,
      source_turn_id: row.source_turn_id as string | null,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
      completed_at: row.completed_at as Date | null,
    };
  }

  private mapVideoRequestWithCompanion(row: Record<string, unknown>): VideoRequestWithCompanion {
    return {
      ...this.mapVideoRequest(row),
      companion_name: row.companion_name as string,
      companion_avatar_url: row.companion_avatar_url as string | null,
    };
  }

  private mapUserMediaItem(row: Record<string, unknown>): UserMediaItem {
    return {
      id: row.id as string,
      type: row.type as 'image' | 'video',
      url: row.url as string | null,
      thumbnailUrl: row.thumbnail_url as string | null,
      status: row.status as 'pending' | 'generating' | 'encoding' | 'ready' | 'failed',
      companionId: row.companion_id as string,
      companionName: row.companion_name as string,
      companionAvatarUrl: row.companion_avatar_url as string | null,
      createdAt: row.created_at as Date,
    };
  }
}

// Singleton instance
let videosRepository: VideosRepository | null = null;

export function getVideosRepository(): VideosRepository {
  if (!videosRepository) {
    videosRepository = new VideosRepository();
  }
  return videosRepository;
}
