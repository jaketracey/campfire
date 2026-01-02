/**
 * Support Tickets Repository
 * Data access for support_tickets table
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  SupportTicket,
  SupportTicketInsert,
  SupportTicketStatus,
  SupportTicketCategory,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, isUniqueViolation, wrapDatabaseError } from './errors.js';

/**
 * Options for listing support tickets
 */
export interface SupportTicketListOptions extends PaginationOptions {
  /** Filter by status */
  status?: SupportTicketStatus;
  /** Filter by category */
  category?: SupportTicketCategory;
  /** Filter by user ID */
  userId?: string;
}

/**
 * Support ticket with user email for admin views
 */
export interface SupportTicketWithUser extends SupportTicket {
  user_email: string;
  resolved_by_email: string | null;
}

export class SupportTicketsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Core CRUD Operations
  // ===========================================================================

  /**
   * Create a new support ticket
   */
  async createSupportTicket(
    data: SupportTicketInsert,
    tx?: TransactionContext
  ): Promise<SupportTicket> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO support_tickets (user_id, category, subject, message, status)
        VALUES (
          ${data.user_id},
          ${data.category},
          ${data.subject},
          ${data.message},
          ${data.status ?? 'open'}
        )
        RETURNING id, user_id, category, subject, message, status,
                  resolved_at, resolved_by_user_id, created_at, updated_at
      `;

      const ticket = this.mapSupportTicket(result[0]!);
      logger.info({ ticketId: ticket.id, userId: data.user_id, category: data.category }, 'Support ticket created');
      return ticket;
    } catch (error) {
      throw wrapDatabaseError(error, 'supportTickets.create');
    }
  }

  /**
   * Get a support ticket by ID
   */
  async getSupportTicket(id: string, tx?: TransactionContext): Promise<SupportTicket | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, user_id, category, subject, message, status,
             resolved_at, resolved_by_user_id, created_at, updated_at
      FROM support_tickets
      WHERE id = ${id}
    `;

    return result[0] ? this.mapSupportTicket(result[0]) : null;
  }

  /**
   * Get a support ticket with user details (for admin)
   */
  async getSupportTicketWithUser(id: string, tx?: TransactionContext): Promise<SupportTicketWithUser | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT st.id, st.user_id, st.category, st.subject, st.message, st.status,
             st.resolved_at, st.resolved_by_user_id, st.created_at, st.updated_at,
             u.email as user_email,
             ru.email as resolved_by_email
      FROM support_tickets st
      JOIN users u ON u.id = st.user_id
      LEFT JOIN users ru ON ru.id = st.resolved_by_user_id
      WHERE st.id = ${id}
    `;

    return result[0] ? this.mapSupportTicketWithUser(result[0]) : null;
  }

  /**
   * List support tickets with optional filters
   */
  async listSupportTickets(
    options: SupportTicketListOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<SupportTicketWithUser>> {
    const db = this.getSql(tx);
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    // Build dynamic query conditions using template composition
    const conditions: ReturnType<typeof db>[] = [db`1=1`];

    if (options.status) {
      conditions.push(db`st.status = ${options.status}`);
    }

    if (options.category) {
      conditions.push(db`st.category = ${options.category}`);
    }

    if (options.userId) {
      conditions.push(db`st.user_id = ${options.userId}`);
    }

    const whereClause = db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`;

    const result = await db`
      SELECT st.id, st.user_id, st.category, st.subject, st.message, st.status,
             st.resolved_at, st.resolved_by_user_id, st.created_at, st.updated_at,
             u.email as user_email,
             ru.email as resolved_by_email
      FROM support_tickets st
      JOIN users u ON u.id = st.user_id
      LEFT JOIN users ru ON ru.id = st.resolved_by_user_id
      ${whereClause}
      ORDER BY st.created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapSupportTicketWithUser(row));

    return { data, hasMore, limit, offset };
  }

  /**
   * Update ticket status
   */
  async updateTicketStatus(
    id: string,
    status: SupportTicketStatus,
    resolvedByUserId?: string,
    tx?: TransactionContext
  ): Promise<SupportTicket> {
    const db = this.getSql(tx);

    // Determine if we should set resolved_at
    const isResolving = status === 'resolved' || status === 'closed';

    const result = await db`
      UPDATE support_tickets
      SET
        status = ${status},
        resolved_at = ${isResolving ? db`NOW()` : db`resolved_at`},
        resolved_by_user_id = ${isResolving && resolvedByUserId ? resolvedByUserId : db`resolved_by_user_id`}
      WHERE id = ${id}
      RETURNING id, user_id, category, subject, message, status,
                resolved_at, resolved_by_user_id, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('SupportTicket', id);
    }

    const ticket = this.mapSupportTicket(result[0]);
    logger.info({ ticketId: id, status, resolvedByUserId }, 'Support ticket status updated');
    return ticket;
  }

  /**
   * Get ticket counts by status (for admin dashboard)
   */
  async getTicketCounts(tx?: TransactionContext): Promise<Record<SupportTicketStatus, number>> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT status, COUNT(*)::int as count
      FROM support_tickets
      GROUP BY status
    `;

    const counts: Record<SupportTicketStatus, number> = {
      open: 0,
      in_progress: 0,
      resolved: 0,
      closed: 0,
    };

    for (const row of result) {
      counts[row['status'] as SupportTicketStatus] = row['count'] as number;
    }

    return counts;
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapSupportTicket(row: Record<string, unknown>): SupportTicket {
    return {
      id: row['id'] as string,
      user_id: row['user_id'] as string,
      category: row['category'] as SupportTicketCategory,
      subject: row['subject'] as string,
      message: row['message'] as string,
      status: row['status'] as SupportTicketStatus,
      resolved_at: row['resolved_at'] as Date | null,
      resolved_by_user_id: row['resolved_by_user_id'] as string | null,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapSupportTicketWithUser(row: Record<string, unknown>): SupportTicketWithUser {
    return {
      ...this.mapSupportTicket(row),
      user_email: row['user_email'] as string,
      resolved_by_email: row['resolved_by_email'] as string | null,
    };
  }
}

// Singleton instance
let supportTicketsRepositoryInstance: SupportTicketsRepository | null = null;

export function getSupportTicketsRepository(): SupportTicketsRepository {
  if (!supportTicketsRepositoryInstance) {
    supportTicketsRepositoryInstance = new SupportTicketsRepository();
  }
  return supportTicketsRepositoryInstance;
}
