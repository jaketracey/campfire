/**
 * Sessions Service
 * Business logic for conversation sessions and turns.
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import { normalizeToolContextMetadata } from '../utils/tooling.js';
import {
  getSessionsRepository,
  getCompanionsRepository,
  getBillingRepository,
  getMemoriesRepository,
  type SessionWithStats,
  type SessionListFilters,
  type PaginatedResult,
} from '../repositories/index.js';
import { getEventsService, type EventContext } from './events.js';
import { logger } from '../observability/logger.js';
import type {
  Session,
  SessionStatus,
  Turn,
  TurnInsert,
  MessageType,
  JSONObject,
  SessionParticipant,
  SessionParticipantWithCompanion,
} from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const StartSessionInputSchema = z.object({
  companionId: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
});

export const AddTurnInputSchema = z.object({
  userMessage: z.string().optional(),
  userMessageType: z.enum(['text', 'audio', 'image', 'multimodal']).optional(),
  agentMessage: z.string().optional(),
  agentMessageType: z.enum(['text', 'audio', 'image', 'multimodal']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const EndSessionInputSchema = z.object({
  reason: z.enum(['user_ended', 'timeout', 'error', 'completed']),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// Types
// ============================================================================

export type StartSessionInput = z.infer<typeof StartSessionInputSchema>;
export type AddTurnInput = z.infer<typeof AddTurnInputSchema>;
export type EndSessionInput = z.infer<typeof EndSessionInputSchema>;

export interface SessionSummary {
  id: string;
  companionId: string;
  companionName: string;
  status: SessionStatus;
  turnCount: number;
  durationMs: number;
  startedAt: Date;
  endedAt: Date | null;
}

export interface TurnMetrics {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ActiveSessionInfo {
  session: Session;
  companionName: string;
  turnCount: number;
  lastActivityAt: Date;
}

// ============================================================================
// Service
// ============================================================================

export class SessionsService {
  private sessions = getSessionsRepository();
  private companions = getCompanionsRepository();
  private billing = getBillingRepository();
  private memories = getMemoriesRepository();
  private events = getEventsService();

  // Session timeout: 30 minutes of inactivity
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000;

  // Memory decay tracking: rate limit to once per 24 hours per user-companion pair
  private readonly DECAY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  private readonly decayLastRun = new Map<string, number>();

  /**
   * Start a new session
   */
  async start(
    userId: string,
    input: StartSessionInput,
    tx?: TransactionContext
  ): Promise<Session> {
    const validated = StartSessionInputSchema.parse(input);

    // Verify companion exists and belongs to user
    const companion = await this.companions.findById(validated.companionId, tx);
    if (!companion || companion.user_id !== userId) {
      throw new Error('Companion not found');
    }

    if (companion.status !== 'active') {
      throw new Error('Companion is not active');
    }

    // Check for existing active session with this companion
    const existing = await this.sessions.findActiveSession(userId, validated.companionId, tx);
    if (existing) {
      // Return existing session instead of creating a new one
      logger.debug({ sessionId: existing.id }, 'Returning existing active session');
      return existing;
    }

    // Check usage limit
    const usageCheck = await this.billing.checkUsageLimit(userId, 'messages', tx);
    if (!usageCheck.allowed) {
      throw new Error('Message limit reached for this billing period');
    }

    // Create the session
    const session = await this.sessions.create({
      user_id: userId,
      companion_id: validated.companionId,
      status: 'active',
      metadata: (validated.metadata ?? {}) as JSONObject,
    }, tx);

    // Emit session started event
    const context: EventContext = {
      userId,
      sessionId: session.id,
      traceId: crypto.randomUUID(),
    };

    await this.events.emitSessionStarted(context, {
      companionId: validated.companionId,
      metadata: validated.metadata,
    });

    // Trigger memory decay asynchronously (non-blocking)
    this.triggerMemoryDecayIfNeeded(userId, validated.companionId).catch(err => {
      logger.warn({ err, userId, companionId: validated.companionId }, 'Memory decay failed');
    });

    logger.info({ userId, sessionId: session.id, companionId: validated.companionId }, 'Session started');
    return session;
  }

  /**
   * Trigger memory decay if cooldown period has passed
   * Rate limited to once per 24 hours per user-companion pair
   */
  private async triggerMemoryDecayIfNeeded(userId: string, companionId: string): Promise<void> {
    const pairKey = `${userId}:${companionId}`;
    const lastRun = this.decayLastRun.get(pairKey);
    const now = Date.now();

    // Check if cooldown has passed
    if (lastRun && now - lastRun < this.DECAY_COOLDOWN_MS) {
      return; // Still in cooldown period
    }

    // Apply decay (default 1% decay rate)
    const decayedCount = await this.memories.applyDecay(userId, companionId, 0.01);

    // Update tracking
    this.decayLastRun.set(pairKey, now);

    // Clean up old entries to prevent memory leaks (keep last 1000)
    if (this.decayLastRun.size > 1000) {
      const entries = Array.from(this.decayLastRun.entries())
        .sort((a, b) => a[1] - b[1]);
      const toRemove = entries.slice(0, entries.length - 1000);
      for (const [key] of toRemove) {
        this.decayLastRun.delete(key);
      }
    }

    if (decayedCount > 0) {
      logger.info({ userId, companionId, decayedCount }, 'Applied memory decay on session start');
    }
  }

  /**
   * Get a session by ID
   * @param userId - The user ID to check ownership against
   * @param sessionId - The session ID to retrieve
   * @param txOrOptions - Transaction context or options object
   * @param options - Options including isAdmin bypass
   */
  async getById(
    userId: string,
    sessionId: string,
    txOrOptions?: TransactionContext | { isAdmin?: boolean; tx?: TransactionContext },
    options?: { isAdmin?: boolean }
  ): Promise<Session | null> {
    // Handle both old signature (tx) and new signature (options object)
    let tx: TransactionContext | undefined;
    let isAdmin = false;

    if (txOrOptions && typeof txOrOptions === 'object' && 'isAdmin' in txOrOptions) {
      isAdmin = txOrOptions.isAdmin ?? false;
      tx = txOrOptions.tx;
    } else {
      tx = txOrOptions as TransactionContext | undefined;
      isAdmin = options?.isAdmin ?? false;
    }

    const session = await this.sessions.findById(sessionId, tx);

    // Verify ownership (admins can bypass)
    if (session && session.user_id !== userId && !isAdmin) {
      return null;
    }

    return session;
  }

  /**
   * Get a session with statistics
   */
  async getWithStats(
    userId: string,
    sessionId: string,
    tx?: TransactionContext
  ): Promise<SessionWithStats | null> {
    const session = await this.sessions.findByIdWithStats(sessionId, tx);

    if (session && session.user_id !== userId) {
      return null;
    }

    return session;
  }

  /**
   * Get the active session for a user and companion
   */
  async getActiveSession(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<Session | null> {
    return this.sessions.findActiveSession(userId, companionId, tx);
  }

  /**
   * Get all active sessions for a user
   */
  async getActiveSessions(userId: string, tx?: TransactionContext): Promise<ActiveSessionInfo[]> {
    const result = await this.sessions.list({
      userId,
      status: 'active',
      limit: 10,
    }, tx);

    const sessionsWithInfo = await Promise.all(
      result.data.map(async session => {
        const companion = await this.companions.findById(session.companion_id, tx);
        const turnCount = await this.sessions.listTurns({ sessionId: session.id, limit: 1 }, tx);

        return {
          session,
          companionName: companion?.name ?? 'Unknown',
          turnCount: turnCount.data.length,
          lastActivityAt: session.updated_at,
        };
      })
    );

    return sessionsWithInfo;
  }

  /**
   * Add a turn to a session
   */
  async addTurn(
    userId: string,
    sessionId: string,
    input: AddTurnInput,
    tx?: TransactionContext
  ): Promise<Turn> {
    const validated = AddTurnInputSchema.parse(input);

    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'active') {
      throw new Error('Session is not active');
    }

    // Get next turn number
    const turnNumber = await this.sessions.getNextTurnNumber(sessionId, tx);

    // Create the turn
    const turn = await this.sessions.createTurn({
      session_id: sessionId,
      turn_number: turnNumber,
      user_message: validated.userMessage,
      user_message_type: validated.userMessageType as MessageType,
      agent_message: validated.agentMessage,
      agent_message_type: validated.agentMessageType as MessageType,
      metadata: (validated.metadata ?? {}) as JSONObject,
    }, tx);

    // Update session activity
    await this.sessions.touchActivity(sessionId, tx);

    // Record usage
    await this.billing.recordUsageUsingFunction(userId, 'messages', 1, undefined, tx);

    logger.debug({ sessionId, turnId: turn.id, turnNumber }, 'Turn added');
    return turn;
  }

  /**
   * Update a turn with agent response
   */
  async updateTurn(
    userId: string,
    sessionId: string,
    turnId: string,
    update: Partial<TurnInsert>,
    tx?: TransactionContext
  ): Promise<Turn> {
    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    const turn = await this.sessions.updateTurn(turnId, update, tx);
    return turn;
  }

  /**
   * Complete a turn with metrics
   */
  async completeTurn(
    userId: string,
    sessionId: string,
    turnId: string,
    agentMessage: string,
    agentMessageType: MessageType,
    metadata?: JSONObject,
    metrics?: TurnMetrics,
    tx?: TransactionContext
  ): Promise<Turn> {
    const sanitizedMetadata = metadata ? normalizeToolContextMetadata(metadata) : undefined;
    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    const completeMetrics = metrics ?? {
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    const turn = await this.sessions.completeTurn(
      turnId,
      {
        agentMessage,
        latencyMs: completeMetrics.latencyMs,
        tokenCountInput: completeMetrics.inputTokens,
        tokenCountOutput: completeMetrics.outputTokens,
        costUsd: completeMetrics.costUsd,
        metadata: sanitizedMetadata as unknown as Record<string, unknown>,
      },
      tx
    );

    // Emit agent message event
    const context: EventContext = {
      userId,
      sessionId,
      turnId,
      traceId: crypto.randomUUID(),
    };

    await this.events.emitAgentMessage(
      context,
      { content: agentMessage, messageType: agentMessageType as 'text' | 'audio' },
      {
        inputTokens: completeMetrics.inputTokens,
        outputTokens: completeMetrics.outputTokens,
        estimatedCostUsd: completeMetrics.costUsd,
        durationMs: completeMetrics.latencyMs,
      }
    );

    return turn;
  }

  /**
   * Get turns for a session
   */
  async getTurns(
    userId: string,
    sessionId: string,
    options: { limit?: number; offset?: number } = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<Turn>> {
    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    return this.sessions.listTurns({ sessionId, ...options }, tx);
  }

  /**
   * Get recent turns for context
   */
  async getRecentTurns(
    userId: string,
    sessionId: string,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<Turn[]> {
    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    return this.sessions.getRecentTurns(sessionId, limit, tx);
  }

  /**
   * Get session summary for context retention.
   * Returns current session summary if available, otherwise previous session summary.
   */
  async getContextSummary(
    userId: string,
    sessionId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<string | null> {
    // First try current session summary
    const currentSummary = await this.sessions.getSessionSummary(sessionId, tx);
    if (currentSummary) {
      return currentSummary;
    }

    // Fall back to most recent previous session summary
    return this.sessions.getPreviousSessionSummary(userId, companionId, sessionId, tx);
  }

  /**
   * Pause a session
   */
  async pause(
    userId: string,
    sessionId: string,
    tx?: TransactionContext
  ): Promise<Session> {
    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    const updated = await this.sessions.updateStatus(sessionId, 'paused', tx);
    logger.debug({ sessionId }, 'Session paused');
    return updated;
  }

  /**
   * Resume a paused session
   */
  async resume(
    userId: string,
    sessionId: string,
    tx?: TransactionContext
  ): Promise<Session> {
    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'paused') {
      throw new Error('Session is not paused');
    }

    const updated = await this.sessions.updateStatus(sessionId, 'active', tx);
    await this.sessions.touchActivity(sessionId, tx);
    logger.debug({ sessionId }, 'Session resumed');
    return updated;
  }

  /**
   * End a session
   */
  async end(
    userId: string,
    sessionId: string,
    input: EndSessionInput,
    tx?: TransactionContext
  ): Promise<Session> {
    const validated = EndSessionInputSchema.parse(input);

    const session = await this.getWithStats(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    const ended = await this.sessions.end(sessionId, tx);

    // Calculate duration
    const durationMs = ended.ended_at
      ? new Date(ended.ended_at).getTime() - new Date(ended.started_at).getTime()
      : 0;

    // Emit session ended event
    const context: EventContext = {
      userId,
      sessionId,
      traceId: crypto.randomUUID(),
    };

    await this.events.emitSessionEnded(context, {
      reason: validated.reason,
      turnCount: session.turnCount,
      durationMs,
    });

    // Request vault render for this session
    await this.events.emitVaultRenderRequested(context, {
      renderType: 'conversation',
      targetPath: `/Conversations/${new Date().toISOString().split('T')[0]}/${sessionId}.md`,
      priority: 5,
    });

    logger.info(
      { sessionId, reason: validated.reason, turnCount: session.turnCount, durationMs },
      'Session ended'
    );

    return ended;
  }

  /**
   * List sessions for a user
   */
  async list(
    userId: string,
    filters: Omit<SessionListFilters, 'userId'> = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<Session>> {
    return this.sessions.list({ ...filters, userId }, tx);
  }

  /**
   * Get recent sessions for a user
   */
  async getRecentSessions(
    userId: string,
    companionId: string,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<SessionWithStats[]> {
    return this.sessions.getRecentSessions(userId, companionId, limit, tx);
  }

  /**
   * Get session history for a companion
   */
  async getCompanionSessionHistory(
    userId: string,
    companionId: string,
    options: { limit?: number; offset?: number } = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<Session>> {
    return this.sessions.list({
      userId,
      companionId,
      ...options,
    }, tx);
  }

  // ===========================================================================
  // Session Participants (Group Chat)
  // ===========================================================================

  /**
   * Maximum number of companions allowed in a group chat session
   */
  private readonly MAX_PARTICIPANTS = 5;

  /**
   * Invite a companion to join a session (group chat)
   */
  async inviteCompanion(
    userId: string,
    sessionId: string,
    invitedCompanionId: string,
    invitedByCompanionId: string,
    tx?: TransactionContext
  ): Promise<SessionParticipant> {
    // Verify session exists and belongs to user
    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.status !== 'active') {
      throw new Error('Session is not active');
    }

    // Verify the inviting companion is a participant
    const isInviter = await this.sessions.isParticipant(sessionId, invitedByCompanionId, tx);
    if (!isInviter) {
      throw new Error('Inviting companion is not in this session');
    }

    // Verify the invited companion exists
    const invitedCompanion = await this.companions.findById(invitedCompanionId, tx);
    if (!invitedCompanion) {
      throw new Error('Invited companion not found');
    }
    if (invitedCompanion.status !== 'active') {
      throw new Error('Invited companion is not active');
    }

    // Check if companion is owned by user or is public
    if (invitedCompanion.user_id !== userId && !invitedCompanion.is_public) {
      throw new Error('Cannot invite a private companion from another user');
    }

    // Check if already a participant
    const alreadyParticipant = await this.sessions.isParticipant(sessionId, invitedCompanionId, tx);
    if (alreadyParticipant) {
      throw new Error('Companion is already in this session');
    }

    // Check participant limit
    const currentCount = await this.sessions.getParticipantCount(sessionId, tx);
    if (currentCount >= this.MAX_PARTICIPANTS) {
      throw new Error(`Maximum ${this.MAX_PARTICIPANTS} companions per session`);
    }

    // Add the participant
    const participant = await this.sessions.addParticipant({
      session_id: sessionId,
      companion_id: invitedCompanionId,
      role: 'invited',
      invited_by_companion_id: invitedByCompanionId,
    }, tx);

    // Emit event
    const context: EventContext = {
      userId,
      sessionId,
      traceId: crypto.randomUUID(),
    };

    await this.events.emit({
      type: 'session.participant.joined',
      payload: {
        sessionId,
        companionId: invitedCompanionId,
        companionName: invitedCompanion.name,
        invitedByCompanionId,
        role: 'invited',
      },
      context,
    });

    logger.info(
      { sessionId, invitedCompanionId, invitedByCompanionId },
      'Companion invited to session'
    );

    return participant;
  }

  /**
   * Remove a companion from a session (dismiss from group chat)
   */
  async dismissCompanion(
    userId: string,
    sessionId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<SessionParticipant> {
    // Verify session exists and belongs to user
    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    // Cannot dismiss the primary companion
    const primary = await this.sessions.getPrimaryParticipant(sessionId, tx);
    if (primary && primary.companion_id === companionId) {
      throw new Error('Cannot dismiss the primary companion');
    }

    // Remove the participant
    const participant = await this.sessions.removeParticipant(sessionId, companionId, tx);

    // Emit event
    const context: EventContext = {
      userId,
      sessionId,
      traceId: crypto.randomUUID(),
    };

    await this.events.emit({
      type: 'session.participant.left',
      payload: {
        sessionId,
        companionId,
        reason: 'dismissed',
      },
      context,
    });

    logger.info({ sessionId, companionId }, 'Companion dismissed from session');

    return participant;
  }

  /**
   * Get active participants in a session
   */
  async getActiveParticipants(
    userId: string,
    sessionId: string,
    tx?: TransactionContext
  ): Promise<SessionParticipantWithCompanion[]> {
    // Verify session exists and belongs to user
    const session = await this.getById(userId, sessionId, tx);
    if (!session) {
      throw new Error('Session not found');
    }

    return this.sessions.getActiveParticipants(sessionId, tx);
  }

  /**
   * Check if a session is a group chat (has more than one active participant)
   */
  async isGroupChat(
    sessionId: string,
    tx?: TransactionContext
  ): Promise<boolean> {
    const count = await this.sessions.getParticipantCount(sessionId, tx);
    return count > 1;
  }

  /**
   * End stale sessions (background job)
   */
  async endStaleSessions(tx?: TransactionContext): Promise<number> {
    const maxInactiveMinutes = this.SESSION_TIMEOUT_MS / (60 * 1000);
    const count = await this.sessions.endStaleSessions(maxInactiveMinutes, tx);

    if (count > 0) {
      logger.info({ count }, 'Ended stale sessions');
    }

    return count;
  }

  /**
   * Get session summary
   */
  async getSummary(
    userId: string,
    sessionId: string,
    tx?: TransactionContext
  ): Promise<SessionSummary | null> {
    const session = await this.getWithStats(userId, sessionId, tx);
    if (!session) return null;

    const companion = await this.companions.findById(session.companion_id, tx);

    const durationMs = session.ended_at
      ? new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()
      : Date.now() - new Date(session.started_at).getTime();

    return {
      id: session.id,
      companionId: session.companion_id,
      companionName: companion?.name ?? 'Unknown',
      status: session.status,
      turnCount: session.turnCount,
      durationMs,
      startedAt: session.started_at,
      endedAt: session.ended_at,
    };
  }

  /**
   * Get event context for session operations
   */
  getEventContext(userId: string, sessionId: string, turnId?: string): EventContext {
    return this.events.createContextFromRequest(userId, sessionId, turnId);
  }
}

// Singleton instance
let sessionsService: SessionsService | null = null;

export function getSessionsService(): SessionsService {
  if (!sessionsService) {
    sessionsService = new SessionsService();
  }
  return sessionsService;
}
