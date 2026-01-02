/**
 * Support Service
 * Business logic for support ticket management.
 */

import { z } from 'zod';
import {
  getSupportTicketsRepository,
  type SupportTicketListOptions,
  type SupportTicketWithUser,
} from '../repositories/support-tickets.js';
import { logger } from '../observability/logger.js';
import type { SupportTicket, SupportTicketCategory, SupportTicketStatus } from '../db/types.js';
import type { TransactionContext, PaginatedResult } from '../repositories/types.js';

// ============================================================================
// Input Schemas
// ============================================================================

export const CreateTicketInputSchema = z.object({
  category: z.enum(['bug', 'feature_request', 'account', 'billing', 'other']),
  subject: z.string().min(1).max(255),
  message: z.string().min(10).max(10000),
});

export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>;

export const UpdateTicketStatusInputSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
});

export type UpdateTicketStatusInput = z.infer<typeof UpdateTicketStatusInputSchema>;

export const ListTicketsQuerySchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  category: z.enum(['bug', 'feature_request', 'account', 'billing', 'other']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export type ListTicketsQuery = z.infer<typeof ListTicketsQuerySchema>;

// ============================================================================
// Service
// ============================================================================

export class SupportService {
  private tickets = getSupportTicketsRepository();

  /**
   * Create a new support ticket
   */
  async createTicket(
    userId: string,
    input: CreateTicketInput,
    tx?: TransactionContext
  ): Promise<SupportTicket> {
    const ticket = await this.tickets.createSupportTicket({
      user_id: userId,
      category: input.category,
      subject: input.subject,
      message: input.message,
    }, tx);

    logger.info(
      { ticketId: ticket.id, userId, category: input.category },
      'Support ticket created'
    );

    return ticket;
  }

  /**
   * Get a single ticket by ID
   */
  async getTicket(id: string, tx?: TransactionContext): Promise<SupportTicket | null> {
    return this.tickets.getSupportTicket(id, tx);
  }

  /**
   * Get a ticket with user details (for admin view)
   */
  async getTicketWithUser(id: string, tx?: TransactionContext): Promise<SupportTicketWithUser | null> {
    return this.tickets.getSupportTicketWithUser(id, tx);
  }

  /**
   * List tickets for a specific user
   */
  async listUserTickets(
    userId: string,
    options: { limit?: number; offset?: number; status?: SupportTicketStatus } = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<SupportTicketWithUser>> {
    return this.tickets.listSupportTickets({
      userId,
      status: options.status,
      limit: options.limit,
      offset: options.offset,
    }, tx);
  }

  /**
   * List all tickets (for admin)
   */
  async listTickets(
    options: SupportTicketListOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<SupportTicketWithUser>> {
    return this.tickets.listSupportTickets(options, tx);
  }

  /**
   * Update ticket status (admin operation)
   */
  async updateTicketStatus(
    ticketId: string,
    status: SupportTicketStatus,
    adminUserId?: string,
    tx?: TransactionContext
  ): Promise<SupportTicket> {
    const ticket = await this.tickets.updateTicketStatus(ticketId, status, adminUserId, tx);

    logger.info(
      { ticketId, status, adminUserId },
      'Support ticket status updated'
    );

    return ticket;
  }

  /**
   * Get ticket counts by status (for admin dashboard)
   */
  async getTicketCounts(tx?: TransactionContext): Promise<Record<SupportTicketStatus, number>> {
    return this.tickets.getTicketCounts(tx);
  }

  /**
   * Check if a user owns a ticket
   */
  async userOwnsTicket(userId: string, ticketId: string, tx?: TransactionContext): Promise<boolean> {
    const ticket = await this.tickets.getSupportTicket(ticketId, tx);
    return ticket?.user_id === userId;
  }
}

// Singleton
let supportService: SupportService | null = null;

export function getSupportService(): SupportService {
  if (!supportService) {
    supportService = new SupportService();
  }
  return supportService;
}
