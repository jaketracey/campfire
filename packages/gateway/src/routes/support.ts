/**
 * Support Routes
 * User support ticket creation and admin management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getSupportService,
  CreateTicketInputSchema,
  UpdateTicketStatusInputSchema,
  ListTicketsQuerySchema,
} from '../services/support.js';
import { logger } from '../observability/logger.js';

// Params schemas
const TicketIdParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Register support routes
 */
export async function supportRoutes(app: FastifyInstance): Promise<void> {
  const supportService = getSupportService();

  // ===========================================================================
  // User Routes (authenticated users)
  // ===========================================================================

  /**
   * POST /support/tickets - Create a new support ticket
   */
  app.post('/tickets', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = CreateTicketInputSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const userId = request.user!.userId;
    const input = bodyResult.data;

    const ticket = await supportService.createTicket(userId, input);

    logger.info({ ticketId: ticket.id, userId }, 'User created support ticket');

    return reply.status(201).send({
      success: true,
      data: {
        id: ticket.id,
        category: ticket.category,
        subject: ticket.subject,
        message: ticket.message,
        status: ticket.status,
        createdAt: ticket.created_at.toISOString(),
      },
    });
  });

  /**
   * GET /support/tickets - List user's own tickets
   */
  app.get('/tickets', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = ListTicketsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const userId = request.user!.userId;
    const query = queryResult.data;

    const result = await supportService.listUserTickets(userId, {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send({
      success: true,
      data: {
        tickets: result.data.map(ticket => ({
          id: ticket.id,
          category: ticket.category,
          subject: ticket.subject,
          status: ticket.status,
          createdAt: ticket.created_at.toISOString(),
          updatedAt: ticket.updated_at.toISOString(),
          resolvedAt: ticket.resolved_at?.toISOString() ?? null,
        })),
        hasMore: result.hasMore,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  /**
   * GET /support/tickets/:id - Get a specific ticket (user's own)
   */
  app.get('/tickets/:id', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = TicketIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid ticket ID',
        details: paramsResult.error.issues,
      });
    }

    const { id } = paramsResult.data;
    const userId = request.user!.userId;

    const ticket = await supportService.getTicket(id);

    if (!ticket) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Ticket not found',
      });
    }

    // Users can only view their own tickets
    if (ticket.user_id !== userId && request.user!.role !== 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this ticket',
      });
    }

    return reply.send({
      success: true,
      data: {
        id: ticket.id,
        category: ticket.category,
        subject: ticket.subject,
        message: ticket.message,
        status: ticket.status,
        createdAt: ticket.created_at.toISOString(),
        updatedAt: ticket.updated_at.toISOString(),
        resolvedAt: ticket.resolved_at?.toISOString() ?? null,
      },
    });
  });
}

/**
 * Register admin support routes
 */
export async function adminSupportRoutes(app: FastifyInstance): Promise<void> {
  const supportService = getSupportService();

  // All admin routes require admin role
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // Admin Routes
  // ===========================================================================

  /**
   * GET /admin/support/tickets - List all tickets (admin)
   */
  app.get('/tickets', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = ListTicketsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const query = queryResult.data;

    const result = await supportService.listTickets({
      status: query.status,
      category: query.category,
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send({
      success: true,
      data: {
        tickets: result.data.map(ticket => ({
          id: ticket.id,
          userId: ticket.user_id,
          userEmail: ticket.user_email,
          category: ticket.category,
          subject: ticket.subject,
          status: ticket.status,
          createdAt: ticket.created_at.toISOString(),
          updatedAt: ticket.updated_at.toISOString(),
          resolvedAt: ticket.resolved_at?.toISOString() ?? null,
          resolvedByUserId: ticket.resolved_by_user_id,
          resolvedByEmail: ticket.resolved_by_email,
        })),
        hasMore: result.hasMore,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  /**
   * GET /admin/support/tickets/counts - Get ticket counts by status
   */
  app.get('/tickets/counts', async (request: FastifyRequest, reply: FastifyReply) => {
    const counts = await supportService.getTicketCounts();

    return reply.send({
      success: true,
      data: counts,
    });
  });

  /**
   * GET /admin/support/tickets/:id - Get ticket details (admin)
   */
  app.get('/tickets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = TicketIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid ticket ID',
        details: paramsResult.error.issues,
      });
    }

    const { id } = paramsResult.data;
    const ticket = await supportService.getTicketWithUser(id);

    if (!ticket) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Ticket not found',
      });
    }

    return reply.send({
      success: true,
      data: {
        id: ticket.id,
        userId: ticket.user_id,
        userEmail: ticket.user_email,
        category: ticket.category,
        subject: ticket.subject,
        message: ticket.message,
        status: ticket.status,
        createdAt: ticket.created_at.toISOString(),
        updatedAt: ticket.updated_at.toISOString(),
        resolvedAt: ticket.resolved_at?.toISOString() ?? null,
        resolvedByUserId: ticket.resolved_by_user_id,
        resolvedByEmail: ticket.resolved_by_email,
      },
    });
  });

  /**
   * PATCH /admin/support/tickets/:id - Update ticket status (admin)
   */
  app.patch('/tickets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = TicketIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid ticket ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateTicketStatusInputSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { id } = paramsResult.data;
    const { status } = bodyResult.data;
    const adminUserId = request.user!.userId;

    try {
      const ticket = await supportService.updateTicketStatus(id, status, adminUserId);

      logger.info({ ticketId: id, status, adminUserId }, 'Admin updated ticket status');

      return reply.send({
        success: true,
        data: {
          id: ticket.id,
          status: ticket.status,
          resolvedAt: ticket.resolved_at?.toISOString() ?? null,
          resolvedByUserId: ticket.resolved_by_user_id,
          updatedAt: ticket.updated_at.toISOString(),
        },
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'NotFoundError') {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Ticket not found',
        });
      }
      throw error;
    }
  });
}
