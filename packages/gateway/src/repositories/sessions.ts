/**
 * Sessions Repository
 * Data access for sessions and turns tables
 */

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
          ${data.metadata ?? {}}
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
      SET metadata = metadata || ${metadata}
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
          ${data.metadata ?? {}}
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
        metadata = COALESCE(${data.metadata ?? null}, metadata)
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
        safety_flags = COALESCE(${data.safetyFlags ?? null}, safety_flags)
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
