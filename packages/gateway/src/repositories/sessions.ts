/**
 * Sessions Repository
 * Data access for sessions and turns tables
 */

import postgres from 'postgres';
import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  Session,
  SessionInsert,
  SessionStatus,
  Turn,
  TurnInsert,
  MessageType,
  JSONObject,
  SessionParticipant,
  SessionParticipantInsert,
  SessionParticipantRole,
  SessionParticipantStatus,
  SessionParticipantWithCompanion,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult, DateRangeFilter } from './types.js';
import { NotFoundError, wrapDatabaseError } from './errors.js';

/**
 * Session with stats
 */
export interface SessionWithStats extends Session {
  turnCount: number;
  lastActivityAt: Date | null;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCostUsd: number;
  totalDurationMs: number;
}

/**
 * Session list filters
 */
export interface SessionListFilters extends PaginationOptions {
  userId?: string;
  companionId?: string;
  status?: SessionStatus;
  dateRange?: DateRangeFilter;
}

/**
 * Turn list filters
 */
export interface TurnListFilters extends PaginationOptions {
  sessionId: string;
  hasUserMessage?: boolean;
  hasAgentMessage?: boolean;
}

export class SessionsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Sessions
  // ===========================================================================

  async findById(id: string, tx?: TransactionContext): Promise<Session | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, companion_id, status, started_at, ended_at,
        last_activity_at, turn_count, total_tokens_input, total_tokens_output,
        total_cost_usd, total_duration_ms, metadata, created_at, updated_at
      FROM sessions
      WHERE id = ${id}
    `;

    return result[0] ? this.mapSession(result[0]) : null;
  }

  async findByIdWithStats(id: string, tx?: TransactionContext): Promise<SessionWithStats | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, companion_id, status, started_at, ended_at,
        last_activity_at, turn_count, total_tokens_input, total_tokens_output,
        total_cost_usd, total_duration_ms, metadata, created_at, updated_at
      FROM sessions
      WHERE id = ${id}
    `;

    return result[0] ? this.mapSessionWithStats(result[0]) : null;
  }

  async findActiveSession(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<Session | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, companion_id, status, started_at, ended_at,
        last_activity_at, turn_count, total_tokens_input, total_tokens_output,
        total_cost_usd, total_duration_ms, metadata, created_at, updated_at
      FROM sessions
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `;

    return result[0] ? this.mapSession(result[0]) : null;
  }

  async create(data: SessionInsert, tx?: TransactionContext): Promise<Session> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO sessions (
          user_id, companion_id, status, metadata
        ) VALUES (
          ${data.user_id},
          ${data.companion_id},
          ${data.status ?? 'active'},
          ${db.json((data.metadata ?? {}) as postgres.JSONValue)}
        )
        RETURNING
          id, user_id, companion_id, status, started_at, ended_at,
          last_activity_at, turn_count, total_tokens_input, total_tokens_output,
          total_cost_usd, total_duration_ms, metadata, created_at, updated_at
      `;

      const session = this.mapSession(result[0]!);
      logger.debug({ sessionId: session.id, userId: data.user_id }, 'Session created');
      return session;
    } catch (error) {
      throw wrapDatabaseError(error, 'sessions.create');
    }
  }

  async updateStatus(
    id: string,
    status: SessionStatus,
    tx?: TransactionContext
  ): Promise<Session> {
    const db = this.getSql(tx);

    const updates: Record<string, unknown> = { status };
    if (status === 'ended') {
      updates['ended_at'] = new Date();
    }

    const result = await db`
      UPDATE sessions
      SET
        status = ${status},
        ended_at = ${status === 'ended' ? db`NOW()` : db`ended_at`}
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, status, started_at, ended_at,
        last_activity_at, turn_count, total_tokens_input, total_tokens_output,
        total_cost_usd, total_duration_ms, metadata, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Session', id);
    }

    return this.mapSession(result[0]);
  }

  async updateMetadata(
    id: string,
    metadata: JSONObject,
    tx?: TransactionContext
  ): Promise<Session> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE sessions
      SET metadata = metadata || ${db.json(metadata as postgres.JSONValue)}
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, status, started_at, ended_at,
        last_activity_at, turn_count, total_tokens_input, total_tokens_output,
        total_cost_usd, total_duration_ms, metadata, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Session', id);
    }

    return this.mapSession(result[0]);
  }

  async touchActivity(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE sessions
      SET last_activity_at = NOW()
      WHERE id = ${id}
    `;
  }

  async end(id: string, tx?: TransactionContext): Promise<Session> {
    return this.updateStatus(id, 'ended', tx);
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    // First delete all turns for the session
    await db`DELETE FROM turns WHERE session_id = ${id}`;

    // Then delete the session
    const result = await db`DELETE FROM sessions WHERE id = ${id} RETURNING id`;

    if (!result[0]) {
      throw new NotFoundError('Session', id);
    }

    logger.debug({ sessionId: id }, 'Session deleted');
  }

  async list(
    filters: SessionListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<SessionWithStats>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const conditions: ReturnType<typeof db>[] = [];

    if (filters.userId) {
      conditions.push(db`user_id = ${filters.userId}`);
    }
    if (filters.companionId) {
      conditions.push(db`companion_id = ${filters.companionId}`);
    }
    if (filters.status) {
      conditions.push(db`status = ${filters.status}`);
    }
    if (filters.dateRange?.from) {
      conditions.push(db`started_at >= ${filters.dateRange.from}`);
    }
    if (filters.dateRange?.to) {
      conditions.push(db`started_at < ${filters.dateRange.to}`);
    }

    const whereClause = conditions.length > 0
      ? db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`
      : db``;

    const result = await db`
      SELECT
        id, user_id, companion_id, status, started_at, ended_at,
        last_activity_at, turn_count, total_tokens_input, total_tokens_output,
        total_cost_usd, total_duration_ms, metadata, created_at, updated_at
      FROM sessions
      ${whereClause}
      ORDER BY started_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapSessionWithStats(row));

    return { data, hasMore };
  }

  async getRecentSessions(
    userId: string,
    companionId: string,
    limit: number = 5,
    tx?: TransactionContext
  ): Promise<SessionWithStats[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, companion_id, status, started_at, ended_at,
        last_activity_at, turn_count, total_tokens_input, total_tokens_output,
        total_cost_usd, total_duration_ms, metadata, created_at, updated_at
      FROM sessions
      WHERE user_id = ${userId} AND companion_id = ${companionId}
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapSessionWithStats(row));
  }

  async endStaleSessions(
    maxInactiveMinutes: number = 30,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE sessions
      SET
        status = 'ended',
        ended_at = NOW()
      WHERE status = 'active'
        AND last_activity_at < NOW() - INTERVAL '${db.unsafe(String(maxInactiveMinutes))} minutes'
      RETURNING id
    `;

    if (result.length > 0) {
      logger.info({ count: result.length }, 'Ended stale sessions');
    }

    return result.length;
  }

  // ===========================================================================
  // Turns
  // ===========================================================================

  async findTurnById(id: string, tx?: TransactionContext): Promise<Turn | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, session_id, turn_number, user_message, user_message_type,
        user_audio_url, user_image_urls, agent_message, agent_message_type,
        agent_audio_url, agent_image_urls, started_at, completed_at,
        latency_ms, stt_latency_ms, llm_latency_ms, tts_latency_ms,
        token_count_input, token_count_output, cost_usd, model_used,
        prompt_version, safety_flags, metadata, created_at
      FROM turns
      WHERE id = ${id}
    `;

    return result[0] ? this.mapTurn(result[0]) : null;
  }

  async createTurn(data: TurnInsert, tx?: TransactionContext): Promise<Turn> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO turns (
          session_id, turn_number, user_message, user_message_type,
          agent_message, agent_message_type, metadata
        ) VALUES (
          ${data.session_id},
          ${data.turn_number},
          ${data.user_message ?? null},
          ${data.user_message_type ?? 'text'},
          ${data.agent_message ?? null},
          ${data.agent_message_type ?? 'text'},
          ${db.json((data.metadata ?? {}) as postgres.JSONValue)}
        )
        RETURNING
          id, session_id, turn_number, user_message, user_message_type,
          user_audio_url, user_image_urls, agent_message, agent_message_type,
          agent_audio_url, agent_image_urls, started_at, completed_at,
          latency_ms, stt_latency_ms, llm_latency_ms, tts_latency_ms,
          token_count_input, token_count_output, cost_usd, model_used,
          prompt_version, safety_flags, metadata, created_at
      `;

      const turn = this.mapTurn(result[0]!);
      logger.debug({ turnId: turn.id, sessionId: data.session_id }, 'Turn created');
      return turn;
    } catch (error) {
      throw wrapDatabaseError(error, 'turns.create');
    }
  }

  async getNextTurnNumber(sessionId: string, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT get_next_turn_number(${sessionId}) as next_number
    `;

    return result[0]?.['next_number'] ?? 1;
  }

  async updateTurn(
    id: string,
    data: Partial<Omit<TurnInsert, 'session_id' | 'turn_number'>>,
    tx?: TransactionContext
  ): Promise<Turn> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE turns
      SET
        user_message = COALESCE(${data.user_message ?? null}, user_message),
        user_message_type = COALESCE(${data.user_message_type ?? null}, user_message_type),
        agent_message = COALESCE(${data.agent_message ?? null}, agent_message),
        agent_message_type = COALESCE(${data.agent_message_type ?? null}, agent_message_type),
        latency_ms = COALESCE(${data.latency_ms ?? null}, latency_ms),
        token_count_input = COALESCE(${data.token_count_input ?? null}, token_count_input),
        token_count_output = COALESCE(${data.token_count_output ?? null}, token_count_output),
        cost_usd = COALESCE(${data.cost_usd ?? null}, cost_usd),
        metadata = COALESCE(${data.metadata ? db.json(data.metadata as postgres.JSONValue) : null}, metadata)
      WHERE id = ${id}
      RETURNING
        id, session_id, turn_number, user_message, user_message_type,
        user_audio_url, user_image_urls, agent_message, agent_message_type,
        agent_audio_url, agent_image_urls, started_at, completed_at,
        latency_ms, stt_latency_ms, llm_latency_ms, tts_latency_ms,
        token_count_input, token_count_output, cost_usd, model_used,
        prompt_version, safety_flags, metadata, created_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Turn', id);
    }

    return this.mapTurn(result[0]);
  }

  async completeTurn(
    id: string,
    data: {
      agentMessage?: string;
      latencyMs?: number;
      sttLatencyMs?: number;
      llmLatencyMs?: number;
      ttsLatencyMs?: number;
      tokenCountInput?: number;
      tokenCountOutput?: number;
      costUsd?: number;
      modelUsed?: string;
      promptVersion?: string;
      safetyFlags?: JSONObject;
      metadata?: JSONObject;
    },
    tx?: TransactionContext
  ): Promise<Turn> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE turns
      SET
        agent_message = COALESCE(${data.agentMessage ?? null}, agent_message),
        completed_at = NOW(),
        latency_ms = COALESCE(${data.latencyMs ?? null}, latency_ms),
        stt_latency_ms = COALESCE(${data.sttLatencyMs ?? null}, stt_latency_ms),
        llm_latency_ms = COALESCE(${data.llmLatencyMs ?? null}, llm_latency_ms),
        tts_latency_ms = COALESCE(${data.ttsLatencyMs ?? null}, tts_latency_ms),
        token_count_input = COALESCE(${data.tokenCountInput ?? null}, token_count_input),
        token_count_output = COALESCE(${data.tokenCountOutput ?? null}, token_count_output),
        cost_usd = COALESCE(${data.costUsd ?? null}, cost_usd),
        model_used = COALESCE(${data.modelUsed ?? null}, model_used),
        prompt_version = COALESCE(${data.promptVersion ?? null}, prompt_version),
        safety_flags = COALESCE(${data.safetyFlags ? db.json(data.safetyFlags as postgres.JSONValue) : null}, safety_flags),
        metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(${data.metadata ? db.json(data.metadata as postgres.JSONValue) : null}, '{}'::jsonb)
      WHERE id = ${id}
      RETURNING
        id, session_id, turn_number, user_message, user_message_type,
        user_audio_url, user_image_urls, agent_message, agent_message_type,
        agent_audio_url, agent_image_urls, started_at, completed_at,
        latency_ms, stt_latency_ms, llm_latency_ms, tts_latency_ms,
        token_count_input, token_count_output, cost_usd, model_used,
        prompt_version, safety_flags, metadata, created_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Turn', id);
    }

    return this.mapTurn(result[0]);
  }

  async listTurns(
    filters: TurnListFilters,
    tx?: TransactionContext
  ): Promise<PaginatedResult<Turn>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const conditions: ReturnType<typeof db>[] = [db`session_id = ${filters.sessionId}`];

    if (filters.hasUserMessage !== undefined) {
      if (filters.hasUserMessage) {
        conditions.push(db`user_message IS NOT NULL`);
      } else {
        conditions.push(db`user_message IS NULL`);
      }
    }
    if (filters.hasAgentMessage !== undefined) {
      if (filters.hasAgentMessage) {
        conditions.push(db`agent_message IS NOT NULL`);
      } else {
        conditions.push(db`agent_message IS NULL`);
      }
    }

    const whereClause = db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`;

    const result = await db`
      SELECT
        id, session_id, turn_number, user_message, user_message_type,
        user_audio_url, user_image_urls, agent_message, agent_message_type,
        agent_audio_url, agent_image_urls, started_at, completed_at,
        latency_ms, stt_latency_ms, llm_latency_ms, tts_latency_ms,
        token_count_input, token_count_output, cost_usd, model_used,
        prompt_version, safety_flags, metadata, created_at
      FROM turns
      ${whereClause}
      ORDER BY turn_number ASC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapTurn(row));

    return { data, hasMore };
  }

  async getRecentTurns(
    sessionId: string,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<Turn[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, session_id, turn_number, user_message, user_message_type,
        user_audio_url, user_image_urls, agent_message, agent_message_type,
        agent_audio_url, agent_image_urls, started_at, completed_at,
        latency_ms, stt_latency_ms, llm_latency_ms, tts_latency_ms,
        token_count_input, token_count_output, cost_usd, model_used,
        prompt_version, safety_flags, metadata, created_at
      FROM turns
      WHERE session_id = ${sessionId}
      ORDER BY turn_number DESC
      LIMIT ${limit}
    `;

    // Reverse to get chronological order
    return result.map(row => this.mapTurn(row)).reverse();
  }

  /**
   * Increment like count for a turn and update session total
   * Returns the updated turn likes and session total likes
   */
  async incrementTurnLikes(
    turnId: string,
    sessionId: string,
    tx?: TransactionContext
  ): Promise<{ turnLikes: number; sessionLikes: number; contentSnippet: string }> {
    const db = this.getSql(tx);

    // Atomically increment turn likes
    const turnResult = await db`
      UPDATE turns
      SET metadata = jsonb_set(
        jsonb_set(
          COALESCE(metadata, '{}'),
          '{likes,count}',
          (COALESCE((metadata->'likes'->>'count')::int, 0) + 1)::text::jsonb
        ),
        '{likes,lastLikedAt}',
        to_jsonb(NOW()::text)
      )
      WHERE id = ${turnId}
      RETURNING
        (metadata->'likes'->>'count')::int as turn_likes,
        LEFT(agent_message, 100) as content_snippet
    `;

    if (!turnResult[0]) {
      throw new NotFoundError('Turn', turnId);
    }

    const turnLikes = turnResult[0]['turn_likes'] as number;
    const contentSnippet = (turnResult[0]['content_snippet'] as string) || '';

    // Update session total likes
    const sessionResult = await db`
      UPDATE sessions
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{totalLikes}',
        (COALESCE((metadata->>'totalLikes')::int, 0) + 1)::text::jsonb
      )
      WHERE id = ${sessionId}
      RETURNING (metadata->>'totalLikes')::int as session_likes
    `;

    const sessionLikes = sessionResult[0]?.['session_likes'] as number || 1;

    logger.debug(
      { turnId, sessionId, turnLikes, sessionLikes },
      'Incremented turn likes'
    );

    return { turnLikes, sessionLikes, contentSnippet };
  }

  /**
   * Get total likes for a session
   */
  async getSessionLikes(
    sessionId: string,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT COALESCE((metadata->>'totalLikes')::int, 0) as total_likes
      FROM sessions
      WHERE id = ${sessionId}
    `;

    return (result[0]?.['total_likes'] as number) || 0;
  }

  /**
   * Get liked turns for a session (for companion awareness context)
   * Returns turns that have been liked, sorted by like count
   */
  async getLikedTurns(
    sessionId: string,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<Array<{ turnId: string; likeCount: number; contentSnippet: string }>> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id as turn_id,
        COALESCE((metadata->'likes'->>'count')::int, 0) as like_count,
        LEFT(agent_message, 100) as content_snippet
      FROM turns
      WHERE session_id = ${sessionId}
        AND (metadata->'likes'->>'count')::int > 0
      ORDER BY (metadata->'likes'->>'count')::int DESC
      LIMIT ${limit}
    `;

    return result.map(row => ({
      turnId: row['turn_id'] as string,
      likeCount: row['like_count'] as number,
      contentSnippet: row['content_snippet'] as string,
    }));
  }

  /**
   * Get session summary text for context retention
   */
  async getSessionSummary(
    sessionId: string,
    tx?: TransactionContext
  ): Promise<string | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT summary
      FROM sessions
      WHERE id = ${sessionId}
    `;

    if (result.length === 0) return null;
    return result[0].summary as string | null;
  }

  /**
   * Get previous session summary for context (most recent ended session)
   */
  async getPreviousSessionSummary(
    userId: string,
    companionId: string,
    currentSessionId: string,
    tx?: TransactionContext
  ): Promise<string | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT summary
      FROM sessions
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND id != ${currentSessionId}
        AND summary IS NOT NULL
        AND status = 'ended'
      ORDER BY ended_at DESC
      LIMIT 1
    `;

    if (result.length === 0) return null;
    return result[0].summary as string | null;
  }

  // ===========================================================================
  // Session Participants (Group Chat)
  // ===========================================================================

  /**
   * Add a participant to a session
   */
  async addParticipant(
    data: SessionParticipantInsert,
    tx?: TransactionContext
  ): Promise<SessionParticipant> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO session_participants (
          session_id, companion_id, role, status, invited_by_companion_id
        ) VALUES (
          ${data.session_id},
          ${data.companion_id},
          ${data.role ?? 'invited'},
          ${data.status ?? 'active'},
          ${data.invited_by_companion_id ?? null}
        )
        RETURNING
          id, session_id, companion_id, role, status,
          invited_by_companion_id, joined_at, left_at, message_count,
          created_at, updated_at
      `;

      const participant = this.mapParticipant(result[0]!);
      logger.debug(
        { sessionId: data.session_id, companionId: data.companion_id, role: data.role },
        'Participant added to session'
      );
      return participant;
    } catch (error) {
      throw wrapDatabaseError(error, 'session_participants.add');
    }
  }

  /**
   * Remove a participant from a session (mark as left)
   */
  async removeParticipant(
    sessionId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<SessionParticipant> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE session_participants
      SET
        status = 'left',
        left_at = NOW()
      WHERE session_id = ${sessionId}
        AND companion_id = ${companionId}
        AND status = 'active'
      RETURNING
        id, session_id, companion_id, role, status,
        invited_by_companion_id, joined_at, left_at, message_count,
        created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('SessionParticipant', `${sessionId}/${companionId}`);
    }

    logger.debug({ sessionId, companionId }, 'Participant removed from session');
    return this.mapParticipant(result[0]);
  }

  /**
   * Get all active participants in a session with companion details
   */
  async getActiveParticipants(
    sessionId: string,
    tx?: TransactionContext
  ): Promise<SessionParticipantWithCompanion[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        sp.id, sp.session_id, sp.companion_id, sp.role, sp.status,
        sp.invited_by_companion_id, sp.joined_at, sp.left_at, sp.message_count,
        sp.created_at, sp.updated_at,
        c.name as companion_name,
        a.asset_url as companion_avatar_url
      FROM session_participants sp
      JOIN companions c ON sp.companion_id = c.id
      LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
      WHERE sp.session_id = ${sessionId}
        AND sp.status = 'active'
      ORDER BY sp.joined_at ASC
    `;

    return result.map(row => this.mapParticipantWithCompanion(row));
  }

  /**
   * Get all participants in a session (including left ones)
   */
  async getAllParticipants(
    sessionId: string,
    tx?: TransactionContext
  ): Promise<SessionParticipantWithCompanion[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        sp.id, sp.session_id, sp.companion_id, sp.role, sp.status,
        sp.invited_by_companion_id, sp.joined_at, sp.left_at, sp.message_count,
        sp.created_at, sp.updated_at,
        c.name as companion_name,
        a.asset_url as companion_avatar_url
      FROM session_participants sp
      JOIN companions c ON sp.companion_id = c.id
      LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
      WHERE sp.session_id = ${sessionId}
      ORDER BY sp.joined_at ASC
    `;

    return result.map(row => this.mapParticipantWithCompanion(row));
  }

  /**
   * Check if a companion is an active participant in a session
   */
  async isParticipant(
    sessionId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<boolean> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT 1
      FROM session_participants
      WHERE session_id = ${sessionId}
        AND companion_id = ${companionId}
        AND status = 'active'
      LIMIT 1
    `;

    return result.length > 0;
  }

  /**
   * Get the count of active participants in a session
   */
  async getParticipantCount(
    sessionId: string,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT COUNT(*)::int as count
      FROM session_participants
      WHERE session_id = ${sessionId}
        AND status = 'active'
    `;

    return result[0]?.count ?? 0;
  }

  /**
   * Increment message count for a participant
   */
  async incrementParticipantMessageCount(
    sessionId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE session_participants
      SET message_count = message_count + 1
      WHERE session_id = ${sessionId}
        AND companion_id = ${companionId}
    `;
  }

  /**
   * Get the primary companion for a session
   */
  async getPrimaryParticipant(
    sessionId: string,
    tx?: TransactionContext
  ): Promise<SessionParticipantWithCompanion | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        sp.id, sp.session_id, sp.companion_id, sp.role, sp.status,
        sp.invited_by_companion_id, sp.joined_at, sp.left_at, sp.message_count,
        sp.created_at, sp.updated_at,
        c.name as companion_name,
        a.asset_url as companion_avatar_url
      FROM session_participants sp
      JOIN companions c ON sp.companion_id = c.id
      LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
      WHERE sp.session_id = ${sessionId}
        AND sp.role = 'primary'
      LIMIT 1
    `;

    return result[0] ? this.mapParticipantWithCompanion(result[0]) : null;
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapSession(row: Record<string, unknown>): Session {
    return {
      id: row['id'] as string,
      user_id: row['user_id'] as string,
      companion_id: row['companion_id'] as string,
      status: row['status'] as SessionStatus,
      started_at: row['started_at'] as Date,
      ended_at: row['ended_at'] as Date | null,
      metadata: row['metadata'] as JSONObject,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapSessionWithStats(row: Record<string, unknown>): SessionWithStats {
    return {
      ...this.mapSession(row),
      turnCount: row['turn_count'] as number,
      lastActivityAt: row['last_activity_at'] as Date | null,
      totalTokensInput: row['total_tokens_input'] as number,
      totalTokensOutput: row['total_tokens_output'] as number,
      totalCostUsd: parseFloat(row['total_cost_usd'] as string),
      totalDurationMs: row['total_duration_ms'] as number,
    };
  }

  private mapTurn(row: Record<string, unknown>): Turn {
    return {
      id: row['id'] as string,
      session_id: row['session_id'] as string,
      turn_number: row['turn_number'] as number,
      user_message: row['user_message'] as string | null,
      user_message_type: row['user_message_type'] as MessageType,
      agent_message: row['agent_message'] as string | null,
      agent_message_type: row['agent_message_type'] as MessageType,
      started_at: row['started_at'] as Date,
      completed_at: row['completed_at'] as Date | null,
      latency_ms: row['latency_ms'] as number | null,
      token_count_input: row['token_count_input'] as number | null,
      token_count_output: row['token_count_output'] as number | null,
      cost_usd: row['cost_usd'] ? parseFloat(row['cost_usd'] as string) : null,
      metadata: row['metadata'] as JSONObject,
      created_at: row['created_at'] as Date,
      companion_id: row['companion_id'] as string | null,
    };
  }

  private mapParticipant(row: Record<string, unknown>): SessionParticipant {
    return {
      id: row['id'] as string,
      session_id: row['session_id'] as string,
      companion_id: row['companion_id'] as string,
      role: row['role'] as SessionParticipantRole,
      status: row['status'] as SessionParticipantStatus,
      invited_by_companion_id: row['invited_by_companion_id'] as string | null,
      joined_at: row['joined_at'] as Date,
      left_at: row['left_at'] as Date | null,
      message_count: row['message_count'] as number,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapParticipantWithCompanion(row: Record<string, unknown>): SessionParticipantWithCompanion {
    return {
      ...this.mapParticipant(row),
      companion_name: row['companion_name'] as string,
      companion_avatar_url: row['companion_avatar_url'] as string | null,
    };
  }
}

// Singleton instance
let sessionsRepositoryInstance: SessionsRepository | null = null;

export function getSessionsRepository(): SessionsRepository {
  if (!sessionsRepositoryInstance) {
    sessionsRepositoryInstance = new SessionsRepository();
  }
  return sessionsRepositoryInstance;
}
