/**
 * Admin Routes
 * User management, invitations, and admin operations.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin, createToken, createRefreshToken } from '../middleware/auth.js';
import { getUsersRepository } from '../repositories/index.js';
import {
  getAdminService,
  AdminUserListQuerySchema,
  AdminInviteUserSchema,
  AdminUpdateRoleSchema,
  AdminUpdateStatusSchema,
  AdminGrantTokensSchema,
} from '../services/admin.js';
import { logger } from '../observability/logger.js';
import { getAdminSettingsRepository } from '../repositories/admin-settings.js';
import { getDemoCompanionsRepository } from '../repositories/demo-companions.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import type { JSONObject } from '../db/types.js';

// Request schemas
const UserIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

const InviteIdParamsSchema = z.object({
  inviteId: z.string().uuid(),
});

const SettingKeyParamsSchema = z.object({
  key: z.string().min(1).max(100),
});

const UpdateSettingBodySchema = z.object({
  value: z.unknown(),
  description: z.string().optional(),
});

const AddDemoCompanionBodySchema = z.object({
  companionId: z.string().uuid(),
});

const DemoCompanionIdParamsSchema = z.object({
  id: z.string().uuid(),
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
          imageCount: user.imageCount,
          totalTokens: user.totalTokens,
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
   * POST /admin/users/:userId/grant-tokens - Grant tokens to user
   */
  app.post('/users/:userId/grant-tokens', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UserIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = AdminGrantTokensSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { userId } = paramsResult.data;
    const adminUserId = request.user!.userId;

    try {
      const result = await adminService.grantTokens(userId, bodyResult.data, adminUserId);

      logger.info({ userId, amount: result.amount, adminUserId }, 'Admin granted tokens to user');

      return reply.send({
        success: true,
        data: {
          transactionId: result.transactionId,
          newBalance: result.newBalance,
          amount: result.amount,
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

  // ===========================================================================
  // Admin Settings Routes
  // ===========================================================================

  const settingsRepo = getAdminSettingsRepository();

  /**
   * GET /admin/settings/:key - Get a setting by key
   */
  app.get('/settings/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = SettingKeyParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid setting key',
        details: paramsResult.error.issues,
      });
    }

    const { key } = paramsResult.data;
    const setting = await settingsRepo.get(key);

    if (!setting) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Setting '${key}' not found`,
      });
    }

    return reply.send({
      success: true,
      data: {
        key: setting.key,
        value: setting.value,
        description: setting.description,
        updatedAt: setting.updated_at.toISOString(),
      },
    });
  });

  /**
   * PUT /admin/settings/:key - Update a setting
   */
  app.put('/settings/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = SettingKeyParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid setting key',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateSettingBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { key } = paramsResult.data;
    const { value, description } = bodyResult.data;
    const adminUserId = request.user!.userId;

    const setting = await settingsRepo.set(
      key,
      value as JSONObject,
      {
        description,
        updatedBy: adminUserId,
      }
    );

    logger.info({ key, adminUserId }, 'Admin setting updated');

    return reply.send({
      success: true,
      data: {
        key: setting.key,
        value: setting.value,
        description: setting.description,
        updatedAt: setting.updated_at.toISOString(),
      },
    });
  });

  // ===========================================================================
  // Demo Companions Routes
  // ===========================================================================

  const demoCompanionsRepo = getDemoCompanionsRepository();
  const companionsRepo = getCompanionsRepository();

  /**
   * GET /admin/demo-companions - List all demo companions with details
   */
  app.get('/demo-companions', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await demoCompanionsRepo.listWithDetails();

    return reply.send({
      success: true,
      data: {
        companions: result.data.map(dc => ({
          id: dc.id,
          companionId: dc.companion_id,
          companionName: dc.companion_name,
          companionAvatarUrl: dc.companion_avatar_url,
          companionStatus: dc.companion_status,
          isActive: dc.is_active,
          displayOrder: dc.display_order,
          createdAt: dc.created_at.toISOString(),
        })),
        hasMore: result.hasMore,
      },
    });
  });

  /**
   * POST /admin/demo-companions - Add a companion to demo list
   */
  app.post('/demo-companions', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = AddDemoCompanionBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { companionId } = bodyResult.data;

    // Verify companion exists
    const companion = await companionsRepo.findById(companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    // Check if companion is public
    if (!companion.is_public) {
      return reply.status(400).send({
        error: 'Invalid Operation',
        message: 'Only public companions can be added to demo',
      });
    }

    try {
      const demoCompanion = await demoCompanionsRepo.create({ companion_id: companionId });

      logger.info({ companionId, adminUserId: request.user!.userId }, 'Demo companion added');

      return reply.status(201).send({
        success: true,
        data: {
          id: demoCompanion.id,
          companionId: demoCompanion.companion_id,
          isActive: demoCompanion.is_active,
          displayOrder: demoCompanion.display_order,
          createdAt: demoCompanion.created_at.toISOString(),
        },
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'DuplicateError') {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Companion is already in the demo list',
        });
      }
      throw error;
    }
  });

  /**
   * DELETE /admin/demo-companions/:id - Remove a companion from demo list
   */
  app.delete('/demo-companions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = DemoCompanionIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid demo companion ID',
        details: paramsResult.error.issues,
      });
    }

    const { id } = paramsResult.data;

    try {
      await demoCompanionsRepo.delete(id);

      logger.info({ demoCompanionId: id, adminUserId: request.user!.userId }, 'Demo companion removed');

      return reply.status(204).send();
    } catch (error) {
      const err = error as Error;
      if (err.name === 'NotFoundError') {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Demo companion not found',
        });
      }
      throw error;
    }
  });

  // ===========================================================================
  // User Impersonation
  // ===========================================================================

  /**
   * POST /admin/users/:userId/impersonate - Get tokens to impersonate a user
   *
   * Returns access and refresh tokens for the target user, allowing
   * the admin to act as that user in the frontend.
   */
  app.post('/users/:userId/impersonate', async (request: FastifyRequest, reply: FastifyReply) => {
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

    // Prevent self-impersonation
    if (userId === adminUserId) {
      return reply.status(400).send({
        error: 'Invalid Operation',
        message: 'Cannot impersonate yourself',
      });
    }

    const usersRepo = getUsersRepository();
    const targetUser = await usersRepo.findById(userId);

    if (!targetUser) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Don't allow impersonating other admins
    if (targetUser.role === 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Cannot impersonate admin users',
      });
    }

    // Generate tokens for the target user
    const accessToken = await createToken({
      userId: targetUser.id,
      email: targetUser.email,
      role: targetUser.role,
    });
    const refreshToken = await createRefreshToken(targetUser.id);

    logger.info(
      { adminUserId, targetUserId: userId, targetEmail: targetUser.email },
      'Admin started impersonating user'
    );

    return reply.send({
      success: true,
      data: {
        user: {
          id: targetUser.id,
          email: targetUser.email,
          role: targetUser.role,
          emailVerified: targetUser.email_verified,
          createdAt: targetUser.created_at.toISOString(),
        },
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: 86400,
        },
      },
    });
  });
}
