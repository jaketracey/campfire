/**
 * Referral Routes
 * User referral code management and dashboard.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getReferralsService } from '../services/referrals.js';

// Params schema
const CodeParamsSchema = z.object({
  code: z.string().min(1).max(20),
});

/**
 * Register referral routes
 */
export async function referralsRoutes(app: FastifyInstance): Promise<void> {
  const referralsService = getReferralsService();

  /**
   * GET /referrals/dashboard - Get user's referral dashboard data
   */
  app.get('/dashboard', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.userId;

    const data = await referralsService.getDashboardData(userId);

    return reply.send({
      success: true,
      data: {
        inviteCode: data.inviteCode,
        inviteUrl: data.inviteUrl,
        stats: {
          totalReferrals: data.totalReferrals,
        },
        recentReferrals: data.recentReferrals.map(r => ({
          id: r.referral.id,
          email: r.referredUser.email,
          createdAt: r.referral.created_at.toISOString(),
          converted: r.referral.converted_at !== null,
        })),
      },
    });
  });

  /**
   * GET /referrals/code - Get user's invite code
   */
  app.get('/code', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.userId;

    const inviteCode = await referralsService.getOrCreateInviteCode(userId);
    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    const inviteUrl = `${webUrl}/signup?ref=${inviteCode.code}`;

    return reply.send({
      success: true,
      data: {
        code: inviteCode.code,
        inviteUrl,
        usesCount: inviteCode.uses_count,
        isActive: inviteCode.is_active,
        createdAt: inviteCode.created_at.toISOString(),
      },
    });
  });

  /**
   * GET /referrals/validate/:code - Validate a referral code (public endpoint)
   */
  app.get('/validate/:code', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = CodeParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid code format',
        details: paramsResult.error.issues,
      });
    }

    const { code } = paramsResult.data;
    const isValid = await referralsService.validateReferralCode(code);

    return reply.send({
      success: true,
      data: {
        code,
        valid: isValid,
      },
    });
  });

  /**
   * GET /referrals/stats - Get user's referral stats
   */
  app.get('/stats', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.userId;

    const stats = await referralsService.getReferralStats(userId);

    if (!stats) {
      // User doesn't have an invite code yet
      return reply.send({
        success: true,
        data: {
          code: null,
          totalReferrals: 0,
          isActive: false,
        },
      });
    }

    return reply.send({
      success: true,
      data: {
        code: stats.code,
        totalReferrals: stats.totalReferrals,
        isActive: stats.isActive,
      },
    });
  });
}
