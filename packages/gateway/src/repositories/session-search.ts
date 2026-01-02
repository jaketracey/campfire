/**
 * Session Search Repository
 * Database queries for searching sessions and turns
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type { TransactionContext, PaginationOptions } from './types.js';

/**
 * Search result for a session match
 */
export interface SessionSearchResult {
  sessionId: string;
  companionId: string;
  companionName: string;
  companionAvatarUrl: string | null;
  matchType: 'companion' | 'message';
  snippet: string;
  snippetHighlight: {
    start: number;
    end: number;
  } | null;
  lastActivityAt: Date | null;
  turnCount: number;
  sessionStatus: string;
}

/**
 * Search filters
 */
export interface SessionSearchFilters extends PaginationOptions {
  userId: string;
  query: string;
  companionId?: string;
  status?: 'active' | 'ended';
}

/**
 * Search results with pagination
 */
export interface SessionSearchResponse {
  results: SessionSearchResult[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export class SessionSearchRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  /**
   * Search sessions by companion name or message content
   * Uses PostgreSQL full-text search for better performance and relevance
   */
  async search(
    filters: SessionSearchFilters,
    tx?: TransactionContext
  ): Promise<SessionSearchResponse> {
    const db = this.getSql(tx);
    const limit = Math.min(filters.limit ?? 20, 50);
    const offset = filters.offset ?? 0;
    const searchQuery = filters.query.trim();

    if (!searchQuery) {
      return { results: [], total: 0, limit, offset, hasMore: false };
    }

    // Escape special characters for LIKE pattern
    const likePattern = `%${searchQuery.replace(/[%_\\]/g, '\\$&')}%`;

    // Combined query: search companion names and turn messages
    // Use UNION to combine results from both search types
    const results = await db`
      WITH companion_matches AS (
        -- Search by companion name
        SELECT DISTINCT ON (s.id)
          s.id as session_id,
          s.companion_id,
          c.name as companion_name,
          a.asset_url as companion_avatar_url,
          'companion' as match_type,
          c.name as snippet,
          0 as snippet_start,
          length(c.name) as snippet_end,
          s.last_activity_at,
          s.turn_count,
          s.status as session_status,
          1 as relevance
        FROM sessions s
        JOIN companions c ON s.companion_id = c.id
        LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
        WHERE s.user_id = ${filters.userId}
          AND c.name ILIKE ${likePattern}
          ${filters.companionId ? db`AND s.companion_id = ${filters.companionId}` : db``}
          ${filters.status ? db`AND s.status = ${filters.status}` : db``}
      ),
      message_matches AS (
        -- Search by message content
        SELECT DISTINCT ON (s.id)
          s.id as session_id,
          s.companion_id,
          c.name as companion_name,
          a.asset_url as companion_avatar_url,
          'message' as match_type,
          CASE
            WHEN t.user_message ILIKE ${likePattern} THEN
              SUBSTRING(t.user_message FROM GREATEST(1, POSITION(LOWER(${searchQuery}) IN LOWER(t.user_message)) - 30) FOR 100)
            WHEN t.agent_message ILIKE ${likePattern} THEN
              SUBSTRING(t.agent_message FROM GREATEST(1, POSITION(LOWER(${searchQuery}) IN LOWER(t.agent_message)) - 30) FOR 100)
            ELSE ''
          END as snippet,
          CASE
            WHEN t.user_message ILIKE ${likePattern} THEN
              GREATEST(0, 30 - POSITION(LOWER(${searchQuery}) IN LOWER(t.user_message)) + 1)
            WHEN t.agent_message ILIKE ${likePattern} THEN
              GREATEST(0, 30 - POSITION(LOWER(${searchQuery}) IN LOWER(t.agent_message)) + 1)
            ELSE 0
          END as snippet_start,
          CASE
            WHEN t.user_message ILIKE ${likePattern} THEN
              GREATEST(0, 30 - POSITION(LOWER(${searchQuery}) IN LOWER(t.user_message)) + 1) + ${searchQuery.length}
            WHEN t.agent_message ILIKE ${likePattern} THEN
              GREATEST(0, 30 - POSITION(LOWER(${searchQuery}) IN LOWER(t.agent_message)) + 1) + ${searchQuery.length}
            ELSE 0
          END as snippet_end,
          s.last_activity_at,
          s.turn_count,
          s.status as session_status,
          2 as relevance
        FROM sessions s
        JOIN companions c ON s.companion_id = c.id
        LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
        JOIN turns t ON t.session_id = s.id
        WHERE s.user_id = ${filters.userId}
          AND (t.user_message ILIKE ${likePattern} OR t.agent_message ILIKE ${likePattern})
          ${filters.companionId ? db`AND s.companion_id = ${filters.companionId}` : db``}
          ${filters.status ? db`AND s.status = ${filters.status}` : db``}
        ORDER BY s.id, t.created_at DESC
      ),
      combined AS (
        SELECT * FROM companion_matches
        UNION ALL
        SELECT * FROM message_matches
      ),
      deduplicated AS (
        SELECT DISTINCT ON (session_id)
          session_id,
          companion_id,
          companion_name,
          companion_avatar_url,
          match_type,
          snippet,
          snippet_start,
          snippet_end,
          last_activity_at,
          turn_count,
          session_status,
          relevance
        FROM combined
        ORDER BY session_id, relevance ASC
      )
      SELECT
        session_id,
        companion_id,
        companion_name,
        companion_avatar_url,
        match_type,
        snippet,
        snippet_start,
        snippet_end,
        last_activity_at,
        turn_count,
        session_status,
        COUNT(*) OVER() as total_count
      FROM deduplicated
      ORDER BY last_activity_at DESC NULLS LAST
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = results.length > limit;
    const data = results.slice(0, limit);
    const total = data.length > 0 ? Number(data[0]['total_count']) : 0;

    const mappedResults: SessionSearchResult[] = data.map((row) => ({
      sessionId: row['session_id'] as string,
      companionId: row['companion_id'] as string,
      companionName: row['companion_name'] as string,
      companionAvatarUrl: row['companion_avatar_url'] as string | null,
      matchType: row['match_type'] as 'companion' | 'message',
      snippet: row['snippet'] as string,
      snippetHighlight: row['snippet_start'] !== null ? {
        start: row['snippet_start'] as number,
        end: row['snippet_end'] as number,
      } : null,
      lastActivityAt: row['last_activity_at'] as Date | null,
      turnCount: row['turn_count'] as number,
      sessionStatus: row['session_status'] as string,
    }));

    logger.debug(
      { userId: filters.userId, query: searchQuery, resultCount: mappedResults.length },
      'Session search completed'
    );

    return {
      results: mappedResults,
      total,
      limit,
      offset,
      hasMore,
    };
  }
}

// Singleton instance
let sessionSearchRepositoryInstance: SessionSearchRepository | null = null;

export function getSessionSearchRepository(): SessionSearchRepository {
  if (!sessionSearchRepositoryInstance) {
    sessionSearchRepositoryInstance = new SessionSearchRepository();
  }
  return sessionSearchRepositoryInstance;
}
