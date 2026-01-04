/**
 * Support Routes
 * User support ticket creation and admin management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getSupportService,
  CreateTicketInputSchema,
  UpdateTicketStatusInputSchema,
  ListTicketsQuerySchema,
} from '../services/support.js';
import { logger } from '../observability/logger.js';
import { enqueueEmailJob } from '../utils/queue.js';
import { getUsersRepository } from '../repositories/index.js';

// Params schemas
const TicketIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// Admin create ticket schema
const AdminCreateTicketSchema = z.object({
  userId: z.string().uuid(),
  category: z.enum(['bug', 'feature_request', 'account', 'billing', 'other']),
  subject: z.string().min(1).max(255),
  message: z.string().min(10).max(10000),
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

  /**
   * POST /admin/support/test-email - Send test email to verify SES config
   */
  app.post('/test-email', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUserId = request.user!.userId;
    const adminEmail = request.user!.email;

    const webUrl = process.env.WEB_URL || 'https://ignite.cam';
    const emailJobId = await enqueueEmailJob({
      type: 'transactional',
      templateName: 'notification',
      recipientEmail: adminEmail,
      recipientUserId: adminUserId,
      context: {
        title: 'SES Configuration Test',
        body: 'This is a test email to verify your SES configuration is working correctly. If you received this email, your email sending is properly configured.',
        actionUrl: `${webUrl}/admin/support`,
        actionText: 'Go to Support Dashboard',
      },
      metadata: {
        traceId: nanoid(),
      },
      priority: 'high',
    });

    if (!emailJobId) {
      return reply.status(503).send({
        error: 'Service Unavailable',
        message: 'Email queue is not available. Redis may not be running.',
      });
    }

    logger.info({ adminUserId, emailJobId }, 'Admin triggered test email');

    return reply.send({
      success: true,
      data: {
        message: 'Test email queued',
        jobId: emailJobId,
        recipientEmail: adminEmail,
      },
    });
  });

  /**
   * POST /admin/support/tickets - Create ticket on behalf of user (admin)
   */
  app.post('/tickets', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = AdminCreateTicketSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { userId, category, subject, message } = bodyResult.data;
    const adminUserId = request.user!.userId;

    // Verify target user exists
    const usersRepo = getUsersRepository();
    const targetUser = await usersRepo.findById(userId);
    if (!targetUser) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Create the ticket
    const ticket = await supportService.createTicket(userId, {
      category,
      subject,
      message,
    });

    // Queue notification email to the user
    const webUrl = process.env.WEB_URL || 'https://ignite.cam';
    const emailQueued = await enqueueEmailJob({
      type: 'notification',
      templateName: 'notification',
      recipientEmail: targetUser.email,
      recipientUserId: userId,
      context: {
        title: 'Support Ticket Created',
        body: `A support ticket has been created for your account.\n\nSubject: ${subject}\n\nOur team will review your request and get back to you soon.`,
        actionUrl: `${webUrl}/support`,
        actionText: 'View Support',
      },
      metadata: {
        traceId: nanoid(),
        correlationId: ticket.id,
      },
      priority: 'normal',
    });

    logger.info({ ticketId: ticket.id, userId, adminUserId, emailQueued: !!emailQueued }, 'Admin created support ticket for user');

    return reply.status(201).send({
      success: true,
      data: {
        ticket: {
          id: ticket.id,
          userId: ticket.user_id,
          userEmail: targetUser.email,
          category: ticket.category,
          subject: ticket.subject,
          message: ticket.message,
          status: ticket.status,
          createdAt: ticket.created_at.toISOString(),
        },
        emailQueued: !!emailQueued,
      },
    });
  });
}
