/**
 * Affiliate Portal Routes
 * Dashboard, stats, conversions, and settings for affiliates.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getAffiliatesService,
  UpdatePayoutInfoSchema,
} from '../services/affiliates.js';
import { requireAffiliateAuth } from '../middleware/affiliate-auth.js';
import { logger } from '../observability/logger.js';

// Query schemas
const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const ConversionsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['pending', 'approved', 'paid', 'rejected']).optional(),
});

/**
 * Register affiliate portal routes
 */
export async function affiliatePortalRoutes(app: FastifyInstance): Promise<void> {
  const affiliatesService = getAffiliatesService();

  // All routes require affiliate authentication
  app.addHook('preHandler', requireAffiliateAuth);

  /**
   * GET /affiliate/stats - Get affiliate dashboard stats
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const affiliateId = request.affiliate!.affiliateId;
    const stats = await affiliatesService.getStats(affiliateId);

    return reply.send({
      success: true,
      data: {
        totalClicks: stats.totalClicks,
        totalConversions: stats.totalConversions,
        pendingConversions: stats.pendingConversions,
        approvedConversions: stats.approvedConversions,
        paidConversions: stats.paidConversions,
        totalEarned: stats.totalEarned,
        pendingEarnings: stats.pendingEarnings,
        totalPaid: stats.totalPaid,
        clicksThisMonth: stats.clicksThisMonth,
        conversionsThisMonth: stats.conversionsThisMonth,
      },
    });
  });

  /**
   * GET /affiliate/conversions - List affiliate's conversions
   */
  app.get('/conversions', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = ConversionsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const affiliateId = request.affiliate!.affiliateId;
    const query = queryResult.data;

    const result = await affiliatesService.getConversions(affiliateId, {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send({
      success: true,
      data: {
        conversions: result.data.map((c) => ({
          id: c.id,
          planTier: c.plan_tier,
          commissionAmount: c.commission_amount,
          status: c.status,
          rejectionReason: c.rejection_reason,
          paidAt: c.paid_at?.toISOString() ?? null,
          createdAt: c.created_at.toISOString(),
        })),
        hasMore: result.hasMore,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  /**
   * GET /affiliate/clicks - List affiliate's recent clicks
   */
  app.get('/clicks', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = PaginationQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const affiliateId = request.affiliate!.affiliateId;
    const query = queryResult.data;

    const result = await affiliatesService.getClicks(affiliateId, {
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send({
      success: true,
      data: {
        clicks: result.data.map((c) => ({
          id: c.id,
          referrerUrl: c.referrer_url,
          landingPage: c.landing_page,
          createdAt: c.created_at.toISOString(),
        })),
        hasMore: result.hasMore,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  /**
   * GET /affiliate/profile - Get affiliate's own profile
   */
  app.get('/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const affiliateId = request.affiliate!.affiliateId;
    const affiliate = await affiliatesService.getProfile(affiliateId);

    return reply.send({
      success: true,
      data: {
        id: affiliate.id,
        name: affiliate.name,
        email: affiliate.email,
        code: affiliate.code,
        commissionStandard: affiliate.commission_standard,
        commissionPremium: affiliate.commission_premium,
        payoutInfo: affiliate.payout_info,
        totalClicks: affiliate.total_clicks,
        totalConversions: affiliate.total_conversions,
        totalEarned: affiliate.total_earned,
        totalPaid: affiliate.total_paid,
        createdAt: affiliate.created_at.toISOString(),
      },
    });
  });

  /**
   * PATCH /affiliate/profile - Update payout info
   */
  app.patch('/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = UpdatePayoutInfoSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const affiliateId = request.affiliate!.affiliateId;
    const affiliate = await affiliatesService.updatePayoutInfo(affiliateId, bodyResult.data);

    logger.info({ affiliateId }, 'Affiliate updated payout info');

    return reply.send({
      success: true,
      data: {
        id: affiliate.id,
        payoutInfo: affiliate.payout_info,
      },
    });
  });

  /**
   * GET /affiliate/link - Get affiliate's referral link
   */
  app.get('/link', async (request: FastifyRequest, reply: FastifyReply) => {
    const code = request.affiliate!.code;
    const baseUrl = process.env['APP_URL'] ?? 'https://app.campfire.ai';

    return reply.send({
      success: true,
      data: {
        code,
        trackingUrl: `${baseUrl}/track/${code}`,
        signupUrl: `${baseUrl}/signup?ref=${code}`,
      },
    });
  });
}
