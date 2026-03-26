/**
 * User Routes
 * User profile management and preferences.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getUsersRepository } from '../repositories/users.js';
import { logger } from '../observability/logger.js';

// Request schemas
const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  preferences: z.record(z.unknown()).optional(),
  timezone: z.string().min(1).max(50).optional(),
});

const UpdatePreferencesSchema = z.object({
  preferences: z.record(z.unknown()),
});

/**
 * Register user routes
 */
export async function usersRoutes(app: FastifyInstance): Promise<void> {
  const userRepo = getUsersRepository();

  /**
   * GET /users - List users (admin only)
   */
  app.get('/', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };

    const result = await userRepo.list({
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return reply.send({
      users: result.data.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      })),
      total: result.total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  });

  /**
   * GET /users/:userId - Get user by ID
   */
  app.get('/:userId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };

    // Users can only view their own profile unless admin
    if (request.user?.role !== 'admin' && request.user?.userId !== userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You can only view your own profile',
      });
    }

    const user = await userRepo.findById(userId);
    if (!user) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    const profile = await userRepo.findProfileByUserId(userId);

    return reply.send({
      id: user.id,
      email: user.email,
      displayName: profile?.display_name ?? null,
      role: user.role,
      createdAt: user.created_at,
      preferences: profile?.preferences ?? {},
      timezone: profile?.timezone ?? null,
    });
  });

  /**
   * PATCH /users/:userId - Update user profile
   */
  app.patch('/:userId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };

    // Users can only update their own profile unless admin
    if (request.user?.role !== 'admin' && request.user?.userId !== userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You can only update your own profile',
      });
    }

    const result = UpdateProfileSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: result.error.issues,
      });
    }

    // Check if user exists
    const user = await userRepo.findById(userId);
    if (!user) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Update the user profile
    const profile = await userRepo.updateProfile(userId, {
      display_name: result.data.displayName,
      preferences: result.data.preferences,
      timezone: result.data.timezone,
    });

    logger.info({ userId }, 'User profile updated');

    return reply.send({
      id: user.id,
      email: user.email,
      displayName: profile.display_name,
      role: user.role,
      preferences: profile.preferences,
      timezone: profile.timezone,
    });
  });

  /**
   * PUT /users/:userId/preferences - Update user preferences
   */
  app.put('/:userId/preferences', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };

    if (request.user?.userId !== userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You can only update your own preferences',
      });
    }

    const result = UpdatePreferencesSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: result.error.issues,
      });
    }

    // Check if user exists
    const user = await userRepo.findById(userId);
    if (!user) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    const profile = await userRepo.updateProfile(userId, {
      preferences: result.data.preferences,
    });

    return reply.send({
      preferences: profile.preferences,
    });
  });

  /**
   * DELETE /users/:userId - Delete user (admin or self)
   */
  app.delete('/:userId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };

    // Users can only delete their own account unless admin
    if (request.user?.role !== 'admin' && request.user?.userId !== userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You can only delete your own account',
      });
    }

    // Check if user exists before attempting delete
    const user = await userRepo.findById(userId);
    if (!user) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    await userRepo.delete(userId);

    logger.info({ userId, deletedBy: request.user?.userId }, 'User deleted');

    return reply.status(204).send();
  });
}
