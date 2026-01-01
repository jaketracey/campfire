/**
 * Authentication Routes
 * Handles user signup, login, logout, and session management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { requireAuth, createToken, createRefreshToken, verifyRefreshToken } from '../middleware/auth.js';
import { getAuthService } from '../services/auth.js';
import { getReferralsService } from '../services/referrals.js';
import { getUsersRepository, getReferralsRepository } from '../repositories/index.js';

/**
 * Request schemas
 */
const SignupBodySchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(100).optional(),
  referralCode: z.string().max(20).optional(),
  inviteToken: z.string().optional(),
});

const LoginBodySchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const GoogleAuthBodySchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
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

      const { email, password, displayName, referralCode, inviteToken } = parseResult.data;
      span.setAttributes({ 'auth.email': email });

      try {
        const authService = getAuthService();
        const referralsService = getReferralsService();
        const referralsRepo = getReferralsRepository();
        const result = await authService.register({ email, password });

        // Update profile with display name if provided
        if (displayName) {
          const usersRepo = getUsersRepository();
          await usersRepo.updateProfile(result.user.id, { display_name: displayName });
        }

        // Record referral if referral code was provided
        if (referralCode) {
          try {
            await referralsService.recordReferral(result.user.id, referralCode);
            logger.info({ userId: result.user.id, referralCode }, 'Referral recorded during signup');
          } catch (refError) {
            // Don't fail signup if referral recording fails
            logger.warn({ userId: result.user.id, referralCode, error: refError }, 'Failed to record referral');
          }
        }

        // Accept invite if invite token was provided
        if (inviteToken) {
          try {
            const invite = await referralsRepo.findPendingInviteByToken(inviteToken);
            if (invite && invite.status === 'pending' && invite.email.toLowerCase() === email.toLowerCase()) {
              await referralsRepo.acceptPendingInvite(inviteToken, result.user.id);
              logger.info({ userId: result.user.id, inviteToken }, 'Invite accepted during signup');
            }
          } catch (invError) {
            // Don't fail signup if invite acceptance fails
            logger.warn({ userId: result.user.id, inviteToken, error: invError }, 'Failed to accept invite');
          }
        }

        // Generate JWT tokens with user's role
        const accessToken = await createToken({
          userId: result.user.id,
          email: result.user.email,
          role: result.user.role,
        });
        const refreshToken = await createRefreshToken(result.user.id);

        logger.info({ userId: result.user.id, email }, 'User signup successful');

        return reply.status(201).send({
          success: true,
          data: {
            user: {
              id: result.user.id,
              email: result.user.email,
              displayName: displayName ?? null,
              emailVerified: result.user.email_verified,
              role: result.user.role,
              createdAt: result.user.created_at.toISOString(),
            },
            tokens: {
              accessToken,
              refreshToken,
              tokenType: 'Bearer',
              expiresIn: 86400,
            },
          },
        });
      } catch (error) {
        const authError = error as { code?: string; message?: string };
        if (authError.code === 'EMAIL_EXISTS') {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'EMAIL_EXISTS',
              message: 'An account with this email already exists',
              timestamp: new Date().toISOString(),
            },
          });
        }
        throw error;
      }
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

      try {
        const authService = getAuthService();
        const result = await authService.login(
          { email, password },
          { ipAddress: request.ip, userAgent: request.headers['user-agent'] }
        );

        // Check if MFA is required
        if (result.requiresMFA) {
          return reply.send({
            success: true,
            data: {
              requiresMFA: true,
              mfaMethods: result.mfaMethods,
            },
          });
        }

        // Generate JWT tokens with user's role
        const accessToken = await createToken({
          userId: result.user.id,
          email: result.user.email,
          role: result.user.role,
        });
        const refreshToken = await createRefreshToken(result.user.id);

        logger.info({ userId: result.user.id, email }, 'User login successful');

        return reply.send({
          success: true,
          data: {
            user: {
              id: result.user.id,
              email: result.user.email,
              role: result.user.role,
            },
            tokens: {
              accessToken,
              refreshToken,
              tokenType: 'Bearer',
              expiresIn: 86400,
            },
          },
        });
      } catch (error) {
        const authError = error as { code?: string; message?: string };
        if (authError.code === 'INVALID_CREDENTIALS') {
          return reply.status(401).send({
            success: false,
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid email or password',
              timestamp: new Date().toISOString(),
            },
          });
        }
        if (authError.code === 'ACCOUNT_LOCKED') {
          return reply.status(401).send({
            success: false,
            error: {
              code: 'ACCOUNT_LOCKED',
              message: authError.message || 'Account is temporarily locked',
              timestamp: new Date().toISOString(),
            },
          });
        }
        if (authError.code === 'ACCOUNT_SUSPENDED') {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'ACCOUNT_SUSPENDED',
              message: authError.message || 'Account has been suspended',
              timestamp: new Date().toISOString(),
            },
          });
        }
        throw error;
      }
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

      logger.info({ userId: user.userId }, 'User logout');

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

      // Fetch user from database
      const usersRepo = getUsersRepository();
      const user = await usersRepo.findById(userId);
      if (!user) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'User not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Generate new tokens with user's role
      const newAccessToken = await createToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });
      const newRefreshToken = await createRefreshToken(user.id);

      logger.debug({ userId: user.id }, 'Token refreshed');

      return reply.send({
        success: true,
        data: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: 86400,
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

  /**
   * POST /auth/google
   * Authenticate with Google OAuth
   * Handles both login (existing users) and signup (new users)
   */
  app.post('/google', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('auth.google', async (span) => {
      // Validate request body
      const parseResult = GoogleAuthBodySchema.safeParse(request.body);
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

      const { idToken } = parseResult.data;

      try {
        const authService = getAuthService();
        const result = await authService.authenticateWithGoogle(
          { idToken },
          { ipAddress: request.ip, userAgent: request.headers['user-agent'] }
        );

        span.setAttributes({ 'auth.userId': result.user.id });

        // Get user profile for display name
        const usersRepo = getUsersRepository();
        const profile = await usersRepo.findProfileByUserId(result.user.id);

        // Generate JWT tokens with user's role
        const accessToken = await createToken({
          userId: result.user.id,
          email: result.user.email,
          role: result.user.role,
        });
        const refreshToken = await createRefreshToken(result.user.id);

        logger.info({ userId: result.user.id, provider: 'google' }, 'Google auth successful');

        return reply.send({
          success: true,
          data: {
            user: {
              id: result.user.id,
              email: result.user.email,
              displayName: profile?.display_name ?? null,
              emailVerified: result.user.email_verified,
              role: result.user.role,
              createdAt: result.user.created_at.toISOString(),
            },
            tokens: {
              accessToken,
              refreshToken,
              tokenType: 'Bearer',
              expiresIn: 86400,
            },
          },
        });
      } catch (error) {
        const authError = error as { code?: string; message?: string };

        if (authError.code === 'OAUTH_INVALID_TOKEN') {
          return reply.status(401).send({
            success: false,
            error: {
              code: 'OAUTH_INVALID_TOKEN',
              message: authError.message || 'Invalid or expired Google token',
              timestamp: new Date().toISOString(),
            },
          });
        }

        if (authError.code === 'ACCOUNT_SUSPENDED') {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'ACCOUNT_SUSPENDED',
              message: authError.message || 'Account has been suspended',
              timestamp: new Date().toISOString(),
            },
          });
        }

        if (authError.code === 'ACCOUNT_LOCKED') {
          return reply.status(401).send({
            success: false,
            error: {
              code: 'ACCOUNT_LOCKED',
              message: authError.message || 'Account is temporarily locked',
              timestamp: new Date().toISOString(),
            },
          });
        }

        throw error;
      }
    });
  });
}
