/**
 * Event Store
 * Provides append-only event storage with PostgreSQL.
 * Supports event streaming, subscriptions, and idempotent handling.
 */

import { nanoid } from 'nanoid';
import type { EventEnvelope } from '@campfire/shared';
import { sql, db } from './pool.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';

/**
 * Event subscription callback
 */
export type EventCallback = (event: StoredEvent) => void | Promise<void>;

/**
 * Stored event with database metadata
 */
export interface StoredEvent extends EventEnvelope {
  /** Auto-incrementing sequence number */
  sequenceNumber: bigint;
  /** Database insertion timestamp */
  storedAt: Date;
}

/**
 * Event query options
 */
export interface EventQueryOptions {
  /** Filter by user ID */
  userId?: string;
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by event types */
  types?: string[];
  /** Filter by trace ID */
  traceId?: string;
  /** Start from sequence number (exclusive) */
  afterSequence?: bigint;
  /** Start from timestamp (inclusive) */
  fromTimestamp?: Date;
  /** End at timestamp (exclusive) */
  toTimestamp?: Date;
  /** Maximum number of events to return */
  limit?: number;
  /** Order direction */
  order?: 'asc' | 'desc';
}

/**
 * Event stream options
 */
export interface EventStreamOptions extends EventQueryOptions {
  /** Poll interval in milliseconds */
  pollIntervalMs?: number;
  /** Callback for each event */
  onEvent: EventCallback;
  /** Callback for errors */
  onError?: (error: Error) => void;
}

/**
 * Active subscription handle
 */
export interface EventSubscription {
  /** Stop the subscription */
  unsubscribe: () => void;
  /** Check if subscription is active */
  isActive: boolean;
}

/**
 * Event Store class
 */
export class EventStore {
  private subscriptions: Map<string, { active: boolean; timer?: NodeJS.Timeout }> = new Map();

  /**
   * Append a new event to the store
   * Returns the stored event with sequence number
   */
  async append(event: EventEnvelope): Promise<StoredEvent> {
    return withSpan('eventStore.append', async (span) => {
      span.setAttributes({
        'event.type': event.type,
        'event.id': event.eventId,
        'event.userId': event.userId,
      });

      const result = await sql()`
        INSERT INTO events (
          event_id,
          timestamp,
          user_id,
          session_id,
          turn_id,
          trace_id,
          type,
          payload,
          version,
          causation_id,
          correlation_id,
          cost
        ) VALUES (
          ${event.eventId},
          ${event.timestamp},
          ${event.userId},
          ${event.sessionId},
          ${event.turnId},
          ${event.traceId},
          ${event.type},
          ${JSON.stringify(event.payload)},
          ${parseInt(event.version, 10) || 1},
          ${event.causationId},
          ${event.correlationId},
          ${event.cost ? JSON.stringify(event.cost) : null}
        )
        RETURNING event_id, created_at
      `;

      const row = result[0];
      if (!row) {
        throw new Error('Failed to insert event');
      }

      logger.debug(
        { eventId: event.eventId, type: event.type },
        'Event appended to store'
      );

      return {
        ...event,
        sequenceNumber: BigInt(0), // Sequence numbers not used in this schema
        storedAt: row['created_at'] as Date,
      };
    });
  }

  /**
   * Append multiple events atomically
   */
  async appendBatch(events: EventEnvelope[]): Promise<StoredEvent[]> {
    if (events.length === 0) {
      return [];
    }

    return withSpan('eventStore.appendBatch', async (span) => {
      span.setAttributes({
        'batch.size': events.length,
      });

      return db.transaction(async (tx) => {
        const storedEvents: StoredEvent[] = [];

        for (const event of events) {
          const result = await tx`
            INSERT INTO events (
              event_id,
              timestamp,
              user_id,
              session_id,
              turn_id,
              trace_id,
              type,
              payload,
              version,
              causation_id,
              correlation_id,
              cost
            ) VALUES (
              ${event.eventId},
              ${event.timestamp},
              ${event.userId},
              ${event.sessionId},
              ${event.turnId},
              ${event.traceId},
              ${event.type},
              ${JSON.stringify(event.payload)},
              ${event.version},
              ${event.causationId},
              ${event.correlationId},
              ${event.cost ? JSON.stringify(event.cost) : null}
            )
            RETURNING event_id, created_at
          `;

          const row = result[0];
          if (!row) {
            throw new Error('Failed to insert event');
          }

          storedEvents.push({
            ...event,
            sequenceNumber: BigInt(0),
            storedAt: row['created_at'] as Date,
          });
        }

        logger.debug({ count: storedEvents.length }, 'Event batch appended to store');
        return storedEvents;
      });
    });
  }

  /**
   * Append an event idempotently (skip if event_id already exists)
   */
  async appendIdempotent(event: EventEnvelope): Promise<StoredEvent | null> {
    return withSpan('eventStore.appendIdempotent', async (span) => {
      span.setAttributes({
        'event.type': event.type,
        'event.id': event.eventId,
      });

      const result = await sql()`
        INSERT INTO events (
          event_id,
          timestamp,
          user_id,
          session_id,
          turn_id,
          trace_id,
          type,
          payload,
          version,
          causation_id,
          correlation_id,
          cost
        ) VALUES (
          ${event.eventId},
          ${event.timestamp},
          ${event.userId},
          ${event.sessionId},
          ${event.turnId},
          ${event.traceId},
          ${event.type},
          ${JSON.stringify(event.payload)},
          ${parseInt(event.version, 10) || 1},
          ${event.causationId},
          ${event.correlationId},
          ${event.cost ? JSON.stringify(event.cost) : null}
        )
        ON CONFLICT (event_id, timestamp) DO NOTHING
        RETURNING event_id, created_at
      `;

      const row = result[0];
      if (!row) {
        logger.debug({ eventId: event.eventId }, 'Event already exists, skipped');
        return null;
      }

      return {
        ...event,
        sequenceNumber: BigInt(0),
        storedAt: row['created_at'] as Date,
      };
    });
  }

  /**
   * Query events with filters
   */
  async query(options: EventQueryOptions = {}): Promise<StoredEvent[]> {
    return withSpan('eventStore.query', async (span) => {
      span.setAttributes({
        'query.limit': options.limit ?? 100,
        'query.order': options.order ?? 'asc',
      });

      const pgSql = sql();
      const limit = options.limit ?? 100;
      const order = options.order ?? 'asc';

      // Build dynamic query conditions
      const conditions: ReturnType<typeof pgSql>[] = [];

      if (options.userId) {
        conditions.push(pgSql`user_id = ${options.userId}`);
      }
      if (options.sessionId) {
        conditions.push(pgSql`session_id = ${options.sessionId}`);
      }
      if (options.traceId) {
        conditions.push(pgSql`trace_id = ${options.traceId}`);
      }
      if (options.types && options.types.length > 0) {
        conditions.push(pgSql`type = ANY(${options.types})`);
      }
      // afterSequence not supported in this schema - use timestamp instead
      if (options.fromTimestamp) {
        conditions.push(pgSql`created_at >= ${options.fromTimestamp}`);
      }
      if (options.toTimestamp) {
        conditions.push(pgSql`created_at < ${options.toTimestamp}`);
      }

      // Combine conditions with AND
      const whereClause =
        conditions.length > 0
          ? pgSql`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : pgSql`${acc} AND ${cond}`))}`
          : pgSql``;

      const orderClause = order === 'desc' ? pgSql`ORDER BY created_at DESC` : pgSql`ORDER BY created_at ASC`;

      const result = await pgSql`
        SELECT
          event_id,
          timestamp,
          user_id,
          session_id,
          turn_id,
          trace_id,
          type,
          payload,
          version,
          causation_id,
          correlation_id,
          cost,
          created_at
        FROM events
        ${whereClause}
        ${orderClause}
        LIMIT ${limit}
      `;

      return result.map((row) => this.rowToStoredEvent(row));
    });
  }

  /**
   * Get an event by its ID
   */
  async getById(eventId: string): Promise<StoredEvent | null> {
    const result = await sql()`
      SELECT
        event_id,
        timestamp,
        user_id,
        session_id,
        turn_id,
        trace_id,
        type,
        payload,
        version,
        causation_id,
        correlation_id,
        cost,
        created_at
      FROM events
      WHERE event_id = ${eventId}
    `;

    const row = result[0];
    if (!row) {
      return null;
    }

    return this.rowToStoredEvent(row);
  }

  /**
   * Subscribe to events with polling
   */
  subscribe(options: EventStreamOptions): EventSubscription {
    const subscriptionId = nanoid();
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    let lastSequence = options.afterSequence ?? BigInt(0);

    const subscription = { active: true, timer: undefined as NodeJS.Timeout | undefined };
    this.subscriptions.set(subscriptionId, subscription);

    const poll = async () => {
      if (!subscription.active) {
        return;
      }

      try {
        const events = await this.query({
          ...options,
          afterSequence: lastSequence,
          limit: options.limit ?? 100,
          order: 'asc',
        });

        for (const event of events) {
          if (!subscription.active) {
            break;
          }

          try {
            await options.onEvent(event);
            lastSequence = event.sequenceNumber;
          } catch (error) {
            options.onError?.(error as Error);
          }
        }
      } catch (error) {
        options.onError?.(error as Error);
      }

      if (subscription.active) {
        subscription.timer = setTimeout(poll, pollIntervalMs);
      }
    };

    // Start polling
    void poll();

    return {
      unsubscribe: () => {
        subscription.active = false;
        if (subscription.timer) {
          clearTimeout(subscription.timer);
        }
        this.subscriptions.delete(subscriptionId);
        logger.debug({ subscriptionId }, 'Event subscription cancelled');
      },
      get isActive() {
        return subscription.active;
      },
    };
  }

  /**
   * Get the count of events (sequence numbers not used)
   */
  async getLatestSequence(): Promise<bigint> {
    const result = await sql()`
      SELECT COUNT(*) as count
      FROM events
    `;

    const row = result[0];
    return BigInt((row?.['count'] as string) ?? '0');
  }

  /**
   * Count events matching criteria
   */
  async count(options: Omit<EventQueryOptions, 'limit' | 'order'> = {}): Promise<number> {
    const pgSql = sql();

    const conditions: ReturnType<typeof pgSql>[] = [];

    if (options.userId) {
      conditions.push(pgSql`user_id = ${options.userId}`);
    }
    if (options.sessionId) {
      conditions.push(pgSql`session_id = ${options.sessionId}`);
    }
    if (options.types && options.types.length > 0) {
      conditions.push(pgSql`type = ANY(${options.types})`);
    }

    const whereClause =
      conditions.length > 0
        ? pgSql`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : pgSql`${acc} AND ${cond}`))}`
        : pgSql``;

    const result = await pgSql`
      SELECT COUNT(*) as count
      FROM events
      ${whereClause}
    `;

    const row = result[0];
    return parseInt((row?.['count'] as string) ?? '0', 10);
  }

  /**
   * Convert a database row to StoredEvent
   */
  private rowToStoredEvent(row: Record<string, unknown>): StoredEvent {
    return {
      eventId: row['event_id'] as string,
      timestamp: row['timestamp'] as string,
      userId: row['user_id'] as string,
      sessionId: row['session_id'] as string,
      turnId: row['turn_id'] as string | null,
      traceId: row['trace_id'] as string,
      type: row['type'] as string,
      payload: row['payload'],
      version: String(row['version'] ?? '1'),
      causationId: row['causation_id'] as string | null,
      correlationId: row['correlation_id'] as string,
      cost: row['cost'] as EventEnvelope['cost'],
      sequenceNumber: BigInt(0), // Not used in this schema
      storedAt: row['created_at'] as Date,
    };
  }
}

// Singleton instance
let eventStoreInstance: EventStore | null = null;

/**
 * Get the global event store instance
 */
export function getEventStore(): EventStore {
  if (!eventStoreInstance) {
    eventStoreInstance = new EventStore();
  }
  return eventStoreInstance;
}
