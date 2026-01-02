/**
 * Affiliate Authentication Routes
 * Login/logout for affiliate portal.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getAffiliatesService,
  AffiliateLoginSchema,
} from '../services/affiliates.js';
import {
  createAffiliateToken,
  requireAffiliateAuth,
  hashAffiliateToken,
} from '../middleware/affiliate-auth.js';
import { logger } from '../observability/logger.js';

/**
 * Register affiliate authentication routes
 */
export async function affiliateAuthRoutes(app: FastifyInstance): Promise<void> {
  const affiliatesService = getAffiliatesService();

  /**
   * POST /affiliate/auth/login - Affiliate login
   */
  app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = AffiliateLoginSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const result = await affiliatesService.login(bodyResult.data, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      // Create JWT for the affiliate
      const token = await createAffiliateToken({
        affiliateId: result.affiliate.id,
        email: result.affiliate.email,
        code: result.affiliate.code,
      });

      logger.info({ affiliateId: result.affiliate.id }, 'Affiliate logged in');

      return reply.send({
        success: true,
        data: {
          affiliate: {
            id: result.affiliate.id,
            name: result.affiliate.name,
            email: result.affiliate.email,
            code: result.affiliate.code,
            commissionStandard: result.affiliate.commission_standard,
            commissionPremium: result.affiliate.commission_premium,
          },
          token,
          expiresAt: result.expiresAt.toISOString(),
        },
      });
    } catch (error) {
      const authError = error as { code?: string; message?: string };

      if (authError.code === 'INVALID_CREDENTIALS') {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid email or password',
        });
      }

      if (authError.code === 'ACCOUNT_SUSPENDED') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Your account has been suspended',
        });
      }

      if (authError.code === 'ACCOUNT_INACTIVE') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Your account is inactive',
        });
      }

      throw error;
    }
  });

  /**
   * POST /affiliate/auth/logout - Affiliate logout
   */
  app.post('/logout', { preHandler: requireAffiliateAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (token) {
      const tokenHash = hashAffiliateToken(token);
      await affiliatesService.logout(tokenHash);
    }

    logger.debug({ affiliateId: request.affiliate?.affiliateId }, 'Affiliate logged out');

    return reply.send({
      success: true,
      message: 'Logged out successfully',
    });
  });

  /**
   * GET /affiliate/auth/session - Get current session info
   */
  app.get('/session', { preHandler: requireAffiliateAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const affiliate = await affiliatesService.getProfile(request.affiliate!.affiliateId);

    return reply.send({
      success: true,
      data: {
        affiliate: {
          id: affiliate.id,
          name: affiliate.name,
          email: affiliate.email,
          code: affiliate.code,
          commissionStandard: affiliate.commission_standard,
          commissionPremium: affiliate.commission_premium,
          status: affiliate.status,
        },
      },
    });
  });
}
