/**
 * Authentication Routes
 * Handles user signup, login, logout, and session management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getEventStore } from '../db/event-store.js';
import { requireAuth, createToken, createRefreshToken, verifyRefreshToken } from '../middleware/auth.js';

/**
 * Request schemas
 */
const SignupBodySchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(100).optional(),
});

const LoginBodySchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * Authentication routes
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /auth/signup
   * Create a new user account
   */
  app.post('/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('auth.signup', async (span) => {
      // Validate request body
      const parseResult = SignupBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { email, password, displayName } = parseResult.data;
      span.setAttributes({ 'auth.email': email });

      // TODO: Implement user service call
      // - Check if email already exists
      // - Hash password
      // - Create user record
      // - Create user profile

      // Stub: Simulate user creation
      const userId = nanoid();
      logger.info({ userId, email }, 'User signup initiated');

      // Emit user.created event
      const eventStore = getEventStore();
      await eventStore.append({
        eventId: nanoid(),
        timestamp: new Date().toISOString(),
        userId,
        sessionId: 'signup',
        turnId: null,
        traceId: request.id,
        type: 'user.created',
        payload: {
          email,
          displayName: displayName ?? null,
        },
        version: '1.0',
        causationId: null,
        correlationId: request.id,
      });

      // Generate tokens
      const accessToken = await createToken({
        userId,
        email,
        role: 'user',
      });
      const refreshToken = await createRefreshToken(userId);

      return reply.status(201).send({
        success: true,
        data: {
          user: {
            id: userId,
            email,
            displayName: displayName ?? null,
            createdAt: new Date().toISOString(),
          },
          tokens: {
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: 86400, // 24 hours
          },
        },
      });
    });
  });

  /**
   * POST /auth/login
   * Authenticate user and return tokens
   */
  app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('auth.login', async (span) => {
      // Validate request body
      const parseResult = LoginBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { email, password } = parseResult.data;
      span.setAttributes({ 'auth.email': email });

      // TODO: Implement user service call
      // - Find user by email
      // - Verify password hash
      // - Update last login timestamp

      // Stub: Simulate authentication (for development only)
      // In production, this should verify against the database
      if (password.length < 8) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const userId = nanoid(); // Should come from database
      logger.info({ userId, email }, 'User login successful');

      // Emit user.logged_in event
      const eventStore = getEventStore();
      await eventStore.append({
        eventId: nanoid(),
        timestamp: new Date().toISOString(),
        userId,
        sessionId: 'login',
        turnId: null,
        traceId: request.id,
        type: 'user.logged_in',
        payload: {
          email,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
        version: '1.0',
        causationId: null,
        correlationId: request.id,
      });

      // Generate tokens
      const accessToken = await createToken({
        userId,
        email,
        role: 'user',
      });
      const refreshToken = await createRefreshToken(userId);

      return reply.send({
        success: true,
        data: {
          user: {
            id: userId,
            email,
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
  });

  /**
   * POST /auth/logout
   * Invalidate the current session
   */
  app.post('/logout', { preHandler: [requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('auth.logout', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'auth.userId': user.userId });

      // TODO: Implement token blacklist or session invalidation
      // - Add refresh token to blacklist
      // - Clear any server-side session data

      logger.info({ userId: user.userId }, 'User logout');

      // Emit user.logged_out event
      const eventStore = getEventStore();
      await eventStore.append({
        eventId: nanoid(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: 'logout',
        turnId: null,
        traceId: request.id,
        type: 'user.logged_out',
        payload: {},
        version: '1.0',
        causationId: null,
        correlationId: request.id,
      });

      return reply.send({
        success: true,
        data: {
          message: 'Logged out successfully',
        },
      });
    });
  });

  /**
   * POST /auth/refresh
   * Refresh access token using refresh token
   */
  app.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('auth.refresh', async (span) => {
      // Validate request body
      const parseResult = RefreshBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { refreshToken } = parseResult.data;

      // Verify refresh token
      const userId = await verifyRefreshToken(refreshToken);
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Invalid or expired refresh token',
            timestamp: new Date().toISOString(),
          },
        });
      }

      span.setAttributes({ 'auth.userId': userId });

      // TODO: Fetch user from database to get email and role
      const email = 'user@example.com'; // Should come from database

      // Generate new tokens
      const newAccessToken = await createToken({
        userId,
        email,
        role: 'user',
      });
      const newRefreshToken = await createRefreshToken(userId);

      logger.debug({ userId }, 'Token refreshed');

      return reply.send({
        success: true,
        data: {
          tokens: {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            tokenType: 'Bearer',
            expiresIn: 86400,
          },
        },
      });
    });
  });

  /**
   * GET /auth/session
   * Get current session/user info
   */
  app.get('/session', { preHandler: [requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;

    // TODO: Fetch full user profile from database

    return reply.send({
      success: true,
      data: {
        user: {
          id: user.userId,
          email: user.email,
          role: user.role,
        },
        session: {
          issuedAt: new Date().toISOString(),
        },
      },
    });
  });
}
