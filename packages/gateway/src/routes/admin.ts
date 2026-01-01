/**
 * Admin Routes
 * User management, invitations, and admin operations.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import {
  getAdminService,
  AdminUserListQuerySchema,
  AdminInviteUserSchema,
  AdminUpdateRoleSchema,
  AdminUpdateStatusSchema,
} from '../services/admin.js';
import { logger } from '../observability/logger.js';

// Request schemas
const UserIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

const InviteIdParamsSchema = z.object({
  inviteId: z.string().uuid(),
});

/**
 * Register admin routes
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const adminService = getAdminService();

  // All admin routes require admin role
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/users - List all users with stats
   */
  app.get('/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = AdminUserListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const query = queryResult.data;
    const result = await adminService.listUsers(query);

    return reply.send({
      success: true,
      data: {
        users: result.data.map(user => ({
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
          emailVerified: user.emailVerified,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          loginCount: user.loginCount,
          companionCount: user.companionCount,
          createdAt: user.createdAt.toISOString(),
        })),
        hasMore: result.hasMore,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  /**
   * GET /admin/users/:userId - Get single user details
   */
  app.get('/users/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UserIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: paramsResult.error.issues,
      });
    }

    const { userId } = paramsResult.data;
    const user = await adminService.getUser(userId);

    if (!user) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    return reply.send({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: user.email_verified,
        lastLoginAt: user.last_login_at?.toISOString() ?? null,
        loginCount: user.login_count,
        createdAt: user.created_at.toISOString(),
        updatedAt: user.updated_at.toISOString(),
      },
    });
  });

  /**
   * POST /admin/users/:userId/reset-password - Trigger password reset
   */
  app.post('/users/:userId/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UserIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: paramsResult.error.issues,
      });
    }

    const { userId } = paramsResult.data;
    const adminUserId = request.user!.userId;

    try {
      const result = await adminService.triggerPasswordReset(userId, adminUserId);

      logger.info({ userId, adminUserId }, 'Admin triggered password reset');

      return reply.send({
        success: true,
        data: {
          message: 'Password reset email sent',
          // Only return token in development for testing
          ...(process.env.NODE_ENV === 'development' && { resetToken: result.resetToken }),
        },
      });
    } catch (error) {
      const err = error as Error;
      if (err.message === 'User not found') {
        return reply.status(404).send({
          error: 'Not Found',
          message: err.message,
        });
      }
      throw error;
    }
  });

  /**
   * PATCH /admin/users/:userId/role - Update user role
   */
  app.patch('/users/:userId/role', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UserIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = AdminUpdateRoleSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { userId } = paramsResult.data;
    const { role } = bodyResult.data;
    const adminUserId = request.user!.userId;

    try {
      const user = await adminService.updateUserRole(userId, role, adminUserId);

      return reply.send({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      const err = error as Error;
      if (err.message === 'Cannot remove your own admin role') {
        return reply.status(400).send({
          error: 'Invalid Operation',
          message: err.message,
        });
      }
      throw error;
    }
  });

  /**
   * PATCH /admin/users/:userId/status - Update user status (suspend/unsuspend)
   */
  app.patch('/users/:userId/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UserIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = AdminUpdateStatusSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { userId } = paramsResult.data;
    const { status } = bodyResult.data;
    const adminUserId = request.user!.userId;

    try {
      const user = await adminService.updateUserStatus(userId, status, adminUserId);

      return reply.send({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          status: user.status,
        },
      });
    } catch (error) {
      const err = error as Error;
      if (err.message === 'Cannot suspend your own account') {
        return reply.status(400).send({
          error: 'Invalid Operation',
          message: err.message,
        });
      }
      throw error;
    }
  });

  /**
   * POST /admin/invites - Send invitation email
   */
  app.post('/invites', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = AdminInviteUserSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const input = bodyResult.data;
    const adminUserId = request.user!.userId;

    try {
      const result = await adminService.inviteUser(input, adminUserId);

      return reply.status(201).send({
        success: true,
        data: {
          invite: {
            id: result.invite.id,
            email: result.invite.email,
            status: result.invite.status,
            expiresAt: result.invite.expires_at.toISOString(),
            createdAt: result.invite.created_at.toISOString(),
          },
          inviteUrl: result.inviteUrl,
        },
      });
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('already exists')) {
        return reply.status(409).send({
          error: 'Conflict',
          message: err.message,
        });
      }
      throw error;
    }
  });

  /**
   * GET /admin/invites - List pending invitations
   */
  app.get('/invites', async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };

    const result = await adminService.listPendingInvites({
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return reply.send({
      success: true,
      data: {
        invites: result.data.map(invite => ({
          id: invite.id,
          email: invite.email,
          status: invite.status,
          invitedBy: invite.invited_by_user_id,
          message: invite.message,
          expiresAt: invite.expires_at.toISOString(),
          createdAt: invite.created_at.toISOString(),
          acceptedAt: invite.accepted_at?.toISOString() ?? null,
        })),
        hasMore: result.hasMore,
      },
    });
  });

  /**
   * DELETE /admin/invites/:inviteId - Revoke pending invitation
   */
  app.delete('/invites/:inviteId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = InviteIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid invite ID',
        details: paramsResult.error.issues,
      });
    }

    const { inviteId } = paramsResult.data;
    const adminUserId = request.user!.userId;

    try {
      await adminService.revokePendingInvite(inviteId, adminUserId);
      return reply.status(204).send();
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('not found') || err.name === 'NotFoundError') {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Invite not found or already accepted',
        });
      }
      throw error;
    }
  });
}
