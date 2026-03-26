/**
 * Video Calls Repository
 * Data access for video call records (LiveKit-based video chat).
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type { TransactionContext, PaginatedResult } from './types.js';
import { NotFoundError, wrapDatabaseError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

/** Video call status (mirrors the video_call_status enum in DB) */
export type VideoCallStatus = 'connecting' | 'active' | 'ending' | 'ended' | 'failed';

/** Database row shape for video_calls table */
export interface VideoCallRow {
  id: string;
  user_id: string;
  companion_id: string;
  session_id: string | null;
  room_name: string;
  status: VideoCallStatus;
  avatar_provider: string;
  avatar_face_id: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  duration_seconds: number | null;
  tokens_deducted: number;
  cost_usd: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

/** Insert shape for creating a new video call */
export interface VideoCallInsert {
  user_id: string;
  companion_id: string;
  session_id?: string | null | undefined;
  room_name: string;
  status?: VideoCallStatus | undefined;
  avatar_provider?: string | undefined;
  avatar_face_id?: string | null | undefined;
  started_at?: Date | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

/** Fields that can be updated on a video call */
export interface VideoCallUpdate {
  status?: VideoCallStatus | undefined;
  started_at?: Date | undefined;
  ended_at?: Date | undefined;
  duration_seconds?: number | undefined;
  tokens_deducted?: number | undefined;
  cost_usd?: string | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

/** List filters */
export interface VideoCallListFilters {
  userId: string;
  status?: VideoCallStatus | undefined;
  companionId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// ============================================================================
// Repository
// ============================================================================

export class VideoCallsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  /**
   * Create a new video call record
   */
  async create(data: VideoCallInsert, tx?: TransactionContext): Promise<VideoCallRow> {
    const db = this.getSql(tx);
    try {
      const result = await db`
        INSERT INTO video_calls (
          user_id,
          companion_id,
          session_id,
          room_name,
          status,
          avatar_provider,
          avatar_face_id,
          started_at,
          metadata
        ) VALUES (
          ${data.user_id},
          ${data.companion_id},
          ${data.session_id ?? null},
          ${data.room_name},
          ${data.status ?? 'connecting'},
          ${data.avatar_provider ?? 'simli'},
          ${data.avatar_face_id ?? null},
          ${data.started_at ?? null},
          ${data.metadata ? db.json(data.metadata as postgres.JSONValue) : null}
        )
        RETURNING *
      `;
      const row = result[0] as VideoCallRow | undefined;
      if (!row) {
        throw new Error('Failed to create video call record');
      }
      return row;
    } catch (error) {
      throw wrapDatabaseError(error, 'video_calls');
    }
  }

  /**
   * Find a video call by ID
   */
  async findById(id: string, tx?: TransactionContext): Promise<VideoCallRow | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM video_calls WHERE id = ${id}
    `;
    return (result[0] as VideoCallRow | undefined) ?? null;
  }

  /**
   * Find a video call by room name
   */
  async findByRoomName(roomName: string, tx?: TransactionContext): Promise<VideoCallRow | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM video_calls WHERE room_name = ${roomName}
    `;
    return (result[0] as VideoCallRow | undefined) ?? null;
  }

  /**
   * Find the active video call for a user (enforce max 1)
   */
  async findActiveByUser(userId: string, tx?: TransactionContext): Promise<VideoCallRow | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM video_calls
      WHERE user_id = ${userId}
        AND status IN ('connecting', 'active')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return (result[0] as VideoCallRow | undefined) ?? null;
  }

  /**
   * Update the status of a video call
   */
  async updateStatus(
    id: string,
    status: VideoCallStatus,
    metadata?: Record<string, unknown> | null,
    tx?: TransactionContext
  ): Promise<VideoCallRow> {
    const db = this.getSql(tx);
    let result;

    if (metadata !== undefined) {
      result = await db`
        UPDATE video_calls
        SET status = ${status},
            metadata = ${metadata ? db.json(metadata as postgres.JSONValue) : null}
        WHERE id = ${id}
        RETURNING *
      `;
    } else {
      result = await db`
        UPDATE video_calls
        SET status = ${status}
        WHERE id = ${id}
        RETURNING *
      `;
    }

    const row = result[0] as VideoCallRow | undefined;
    if (!row) {
      throw new NotFoundError('video_calls', id);
    }
    return row;
  }

  /**
   * End a video call, finalizing duration and token spend
   */
  async endCall(
    id: string,
    endedAt: Date,
    durationSeconds: number,
    tokensDeducted: number,
    costUsd?: string,
    tx?: TransactionContext
  ): Promise<VideoCallRow> {
    const db = this.getSql(tx);
    const result = await db`
      UPDATE video_calls
      SET status = 'ended',
          ended_at = ${endedAt},
          duration_seconds = ${durationSeconds},
          tokens_deducted = ${tokensDeducted},
          cost_usd = ${costUsd ?? null}
      WHERE id = ${id}
      RETURNING *
    `;
    const row = result[0] as VideoCallRow | undefined;
    if (!row) {
      throw new NotFoundError('video_calls', id);
    }
    return row;
  }

  /**
   * Increment the tokens_deducted counter atomically
   */
  async incrementTokens(
    id: string,
    amount: number,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      UPDATE video_calls
      SET tokens_deducted = tokens_deducted + ${amount}
      WHERE id = ${id}
      RETURNING tokens_deducted
    `;
    return (result[0] as { tokens_deducted: number } | undefined)?.tokens_deducted ?? 0;
  }

  /**
   * List video calls for a user (paginated, most recent first)
   */
  async listByUser(filters: VideoCallListFilters): Promise<PaginatedResult<VideoCallRow>> {
    const db = sql();
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    let rows: VideoCallRow[];
    let countResult;

    if (filters.status && filters.companionId) {
      const r = await db`
        SELECT * FROM video_calls
        WHERE user_id = ${filters.userId}
          AND status = ${filters.status}
          AND companion_id = ${filters.companionId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      rows = r as unknown as VideoCallRow[];
      countResult = await db`
        SELECT COUNT(*)::text AS count FROM video_calls
        WHERE user_id = ${filters.userId}
          AND status = ${filters.status}
          AND companion_id = ${filters.companionId}
      `;
    } else if (filters.status) {
      const r = await db`
        SELECT * FROM video_calls
        WHERE user_id = ${filters.userId}
          AND status = ${filters.status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      rows = r as unknown as VideoCallRow[];
      countResult = await db`
        SELECT COUNT(*)::text AS count FROM video_calls
        WHERE user_id = ${filters.userId}
          AND status = ${filters.status}
      `;
    } else if (filters.companionId) {
      const r = await db`
        SELECT * FROM video_calls
        WHERE user_id = ${filters.userId}
          AND companion_id = ${filters.companionId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      rows = r as unknown as VideoCallRow[];
      countResult = await db`
        SELECT COUNT(*)::text AS count FROM video_calls
        WHERE user_id = ${filters.userId}
          AND companion_id = ${filters.companionId}
      `;
    } else {
      const r = await db`
        SELECT * FROM video_calls
        WHERE user_id = ${filters.userId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      rows = r as unknown as VideoCallRow[];
      countResult = await db`
        SELECT COUNT(*)::text AS count FROM video_calls
        WHERE user_id = ${filters.userId}
      `;
    }

    const total = parseInt((countResult[0] as { count: string } | undefined)?.count ?? '0', 10);

    return {
      data: rows,
      total,
      hasMore: offset + limit < total,
      limit,
      offset,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: VideoCallsRepository | null = null;

export function getVideoCallsRepository(): VideoCallsRepository {
  if (!instance) {
    instance = new VideoCallsRepository();
    logger.debug('VideoCallsRepository initialized');
  }
  return instance;
}
