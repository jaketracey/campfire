/**
 * Events Service
 * Central service for creating and emitting events.
 * Wraps the EventStore with type-safe event creation.
 */

import { nanoid } from 'nanoid';
import type { EventEnvelope, CostInfo } from '@campfire/shared';
import { EventTypes, type EventType } from '@campfire/shared';
import { getEventStore, type StoredEvent, type EventQueryOptions } from '../db/event-store.js';
import { logger, getRequestContext } from '../observability/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Context for event creation
 */
export interface EventContext {
  userId: string;
  sessionId: string | null;
  turnId?: string | null;
  traceId?: string;
  correlationId?: string;
  causationId?: string | null;
}

/**
 * Options for creating an event
 */
export interface CreateEventOptions<T = unknown> {
  type: EventType | string;
  payload: T;
  context: EventContext;
  cost?: CostInfo;
  version?: string;
}

/**
 * Batch event options
 */
export interface BatchEventOptions {
  events: Array<Omit<CreateEventOptions, 'context'> & { context?: Partial<EventContext> }>;
  baseContext: EventContext;
}

// ============================================================================
// Service
// ============================================================================

export class EventsService {
  private eventStore = getEventStore();

  /**
   * Create and emit a single event
   */
  async emit<T = unknown>(options: CreateEventOptions<T>): Promise<StoredEvent> {
    const event = this.createEnvelope(options);

    logger.debug(
      { eventId: event.eventId, type: event.type, userId: event.userId },
      'Emitting event'
    );

    return this.eventStore.append(event);
  }

  /**
   * Create and emit a single event idempotently
   * Returns null if event already exists
   */
  async emitIdempotent<T = unknown>(
    eventId: string,
    options: CreateEventOptions<T>
  ): Promise<StoredEvent | null> {
    const event = this.createEnvelope({ ...options, eventId });
    return this.eventStore.appendIdempotent(event);
  }

  /**
   * Emit multiple events atomically
   */
  async emitBatch(options: BatchEventOptions): Promise<StoredEvent[]> {
    const events = options.events.map(eventOpts => {
      const mergedContext: EventContext = {
        ...options.baseContext,
        ...eventOpts.context,
      };
      return this.createEnvelope({
        ...eventOpts,
        context: mergedContext,
      });
    });

    logger.debug(
      { count: events.length, types: events.map(e => e.type) },
      'Emitting event batch'
    );

    return this.eventStore.appendBatch(events);
  }

  /**
   * Query events with filters
   */
  async query(options: EventQueryOptions = {}): Promise<StoredEvent[]> {
    return this.eventStore.query(options);
  }

  /**
   * Get a single event by ID
   */
  async getById(eventId: string): Promise<StoredEvent | null> {
    return this.eventStore.getById(eventId);
  }

  /**
   * Get events for a session
   */
  async getSessionEvents(
    sessionId: string,
    options: { types?: EventType[]; limit?: number } = {}
  ): Promise<StoredEvent[]> {
    return this.eventStore.query({
      sessionId,
      types: options.types,
      limit: options.limit ?? 1000,
      order: 'asc',
    });
  }

  /**
   * Get events for a user
   */
  async getUserEvents(
    userId: string,
    options: { types?: EventType[]; limit?: number; fromTimestamp?: Date } = {}
  ): Promise<StoredEvent[]> {
    return this.eventStore.query({
      userId,
      types: options.types,
      limit: options.limit ?? 100,
      fromTimestamp: options.fromTimestamp,
      order: 'desc',
    });
  }

  /**
   * Count events matching criteria
   */
  async count(options: Omit<EventQueryOptions, 'limit' | 'order'> = {}): Promise<number> {
    return this.eventStore.count(options);
  }

  // ===========================================================================
  // Convenience Methods for Common Events
  // ===========================================================================

  /**
   * Emit session started event
   */
  async emitSessionStarted(
    context: EventContext,
    payload: { companionId: string; metadata?: Record<string, unknown> }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.SESSION_STARTED,
      payload,
      context,
    });
  }

  /**
   * Emit session ended event
   */
  async emitSessionEnded(
    context: EventContext,
    payload: { reason: string; turnCount?: number; durationMs?: number }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.SESSION_ENDED,
      payload,
      context,
    });
  }

  /**
   * Emit user message created event
   */
  async emitUserMessage(
    context: EventContext,
    payload: { content: string; messageType: 'text' | 'audio' }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.USER_MESSAGE_CREATED,
      payload,
      context,
    });
  }

  /**
   * Emit agent message created event
   */
  async emitAgentMessage(
    context: EventContext,
    payload: { content: string; messageType: 'text' | 'audio' },
    cost?: CostInfo
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.AGENT_MESSAGE_CREATED,
      payload,
      context,
      cost,
    });
  }

  /**
   * Emit memory written event
   */
  async emitMemoryWritten(
    context: EventContext,
    payload: {
      memoryId: string;
      content: string;
      contentType: string;
      importance: number;
    }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.MEMORY_WRITTEN,
      payload,
      context,
    });
  }

  /**
   * Emit memory deleted event
   */
  async emitMemoryDeleted(
    context: EventContext,
    payload: { memoryId: string; reason?: string }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.MEMORY_DELETED,
      payload,
      context,
    });
  }

  /**
   * Emit companion created event
   */
  async emitCompanionCreated(
    context: EventContext,
    payload: { companionId: string; name: string; spec: Record<string, unknown> }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.COMPANION_CREATED,
      payload,
      context,
    });
  }

  /**
   * Emit companion spec updated event
   */
  async emitCompanionSpecUpdated(
    context: EventContext,
    payload: {
      companionId: string;
      previousVersion: number;
      newVersion: number;
      changes: Record<string, unknown>;
    }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.COMPANION_SPEC_UPDATED,
      payload,
      context,
    });
  }

  /**
   * Emit KG edge added event
   */
  async emitKGEdgeAdded(
    context: EventContext,
    payload: {
      edgeId: string;
      sourceEntityId: string;
      targetEntityId: string;
      relationType: string;
      confidence: number;
    }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.KG_EDGE_ADDED,
      payload,
      context,
    });
  }

  /**
   * Emit billing event
   */
  async emitBillingEvent(
    context: EventContext,
    type: typeof EventTypes.BILLING_CHECKOUT_COMPLETED |
          typeof EventTypes.BILLING_INVOICE_PAID |
          typeof EventTypes.BILLING_PAYMENT_FAILED |
          typeof EventTypes.BILLING_SUBSCRIPTION_UPDATED |
          typeof EventTypes.BILLING_SUBSCRIPTION_CANCELED,
    payload: Record<string, unknown>
  ): Promise<StoredEvent> {
    return this.emit({
      type,
      payload,
      context,
    });
  }

  /**
   * Emit cost recorded event
   */
  async emitCostRecorded(
    context: EventContext,
    payload: {
      service: string;
      operation: string;
      inputTokens?: number;
      outputTokens?: number;
      durationMs?: number;
      estimatedCostUsd: number;
    }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.COST_RECORDED,
      payload,
      context,
      cost: {
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
        totalTokens: (payload.inputTokens ?? 0) + (payload.outputTokens ?? 0),
        durationMs: payload.durationMs,
        estimatedCostUsd: payload.estimatedCostUsd,
        provider: payload.service,
      },
    });
  }

  /**
   * Emit vault render requested event
   */
  async emitVaultRenderRequested(
    context: EventContext,
    payload: {
      renderType: string;
      targetPath?: string;
      priority?: number;
    }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.VAULT_RENDER_REQUESTED,
      payload,
      context,
    });
  }

  /**
   * Emit vault render completed event
   */
  async emitVaultRenderCompleted(
    context: EventContext,
    payload: {
      fileId: string;
      path: string;
      renderDurationMs: number;
    }
  ): Promise<StoredEvent> {
    return this.emit({
      type: EventTypes.VAULT_RENDER_COMPLETED,
      payload,
      context,
    });
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  /**
   * Create an event envelope with all required fields
   */
  private createEnvelope<T>(
    options: CreateEventOptions<T> & { eventId?: string }
  ): EventEnvelope {
    // Try to get additional context from request context
    const reqContext = getRequestContext();

    const eventId = options.eventId ?? crypto.randomUUID();
    const traceId = options.context.traceId ?? reqContext?.traceId ?? crypto.randomUUID();
    const correlationId = options.context.correlationId ?? reqContext?.correlationId ?? traceId;

    return {
      eventId,
      timestamp: new Date().toISOString(),
      userId: options.context.userId,
      sessionId: options.context.sessionId,
      turnId: options.context.turnId ?? null,
      traceId,
      type: options.type,
      payload: options.payload,
      version: options.version ?? '1.0',
      causationId: options.context.causationId ?? null,
      correlationId,
      cost: options.cost,
    };
  }

  /**
   * Create an event context from current request
   */
  createContextFromRequest(
    userId: string,
    sessionId: string,
    turnId?: string
  ): EventContext {
    const reqContext = getRequestContext();

    return {
      userId,
      sessionId,
      turnId,
      traceId: reqContext?.traceId ?? crypto.randomUUID(),
      correlationId: reqContext?.correlationId,
    };
  }

  /**
   * Create a child context from a parent event
   */
  createChildContext(
    parentEvent: StoredEvent,
    options: { newTurnId?: string } = {}
  ): EventContext {
    return {
      userId: parentEvent.userId,
      sessionId: parentEvent.sessionId,
      turnId: options.newTurnId ?? parentEvent.turnId ?? undefined,
      traceId: parentEvent.traceId,
      correlationId: parentEvent.correlationId,
      causationId: parentEvent.eventId,
    };
  }
}

// Singleton instance
let eventsService: EventsService | null = null;

export function getEventsService(): EventsService {
  if (!eventsService) {
    eventsService = new EventsService();
  }
  return eventsService;
}
