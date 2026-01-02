/**
 * Admin Affiliates Routes
 * Affiliate management for administrators.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import {
  getAffiliatesService,
  CreateAffiliateSchema,
  UpdateAffiliateSchema,
  UpdateConversionStatusSchema,
} from '../services/affiliates.js';
import { logger } from '../observability/logger.js';

// Params schemas
const AffiliateIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const ConversionIdParamsSchema = z.object({
  conversionId: z.string().uuid(),
});

// Query schemas
const AffiliateListQuerySchema = z.object({
  status: z.enum(['active', 'suspended', 'inactive']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const ConversionsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'paid', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Register admin affiliate routes
 */
export async function adminAffiliatesRoutes(app: FastifyInstance): Promise<void> {
  const affiliatesService = getAffiliatesService();

  // All routes require admin authentication
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // Affiliate CRUD
  // ===========================================================================

  /**
   * GET /admin/affiliates - List all affiliates
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = AffiliateListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const query = queryResult.data;

    const result = await affiliatesService.listAffiliates({
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send({
      success: true,
      data: {
        affiliates: result.data.map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          code: a.code,
          status: a.status,
          commissionStandard: a.commission_standard,
          commissionPremium: a.commission_premium,
          totalClicks: a.total_clicks,
          totalConversions: a.total_conversions,
          totalEarned: a.total_earned,
          totalPaid: a.total_paid,
          pendingEarnings: a.pending_earnings,
          pendingConversions: a.pending_conversions,
          lastLoginAt: a.last_login_at?.toISOString() ?? null,
          createdAt: a.created_at.toISOString(),
        })),
        hasMore: result.hasMore,
        total: result.total,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  /**
   * POST /admin/affiliates - Create a new affiliate
   */
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = CreateAffiliateSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const affiliate = await affiliatesService.createAffiliate(bodyResult.data);

      logger.info(
        { affiliateId: affiliate.id, code: affiliate.code, adminId: request.user!.userId },
        'Admin created affiliate'
      );

      return reply.status(201).send({
        success: true,
        data: {
          id: affiliate.id,
          name: affiliate.name,
          email: affiliate.email,
          code: affiliate.code,
          status: affiliate.status,
          commissionStandard: affiliate.commission_standard,
          commissionPremium: affiliate.commission_premium,
          createdAt: affiliate.created_at.toISOString(),
        },
      });
    } catch (error) {
      const authError = error as { code?: string };
      if (authError.code === 'EMAIL_EXISTS') {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'An affiliate with this email already exists',
        });
      }
      throw error;
    }
  });

  /**
   * GET /admin/affiliates/:id - Get affiliate details
   */
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = AffiliateIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid affiliate ID',
        details: paramsResult.error.issues,
      });
    }

    const { id } = paramsResult.data;
    const affiliate = await affiliatesService.getAffiliate(id);

    if (!affiliate) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Affiliate not found',
      });
    }

    // Also get stats
    const stats = await affiliatesService.getStats(id);

    return reply.send({
      success: true,
      data: {
        id: affiliate.id,
        name: affiliate.name,
        email: affiliate.email,
        code: affiliate.code,
        status: affiliate.status,
        commissionStandard: affiliate.commission_standard,
        commissionPremium: affiliate.commission_premium,
        payoutInfo: affiliate.payout_info,
        notes: affiliate.notes,
        totalClicks: affiliate.total_clicks,
        totalConversions: affiliate.total_conversions,
        totalEarned: affiliate.total_earned,
        totalPaid: affiliate.total_paid,
        pendingEarnings: stats.pendingEarnings,
        pendingConversions: stats.pendingConversions,
        lastLoginAt: affiliate.last_login_at?.toISOString() ?? null,
        createdAt: affiliate.created_at.toISOString(),
        updatedAt: affiliate.updated_at.toISOString(),
      },
    });
  });

  /**
   * PATCH /admin/affiliates/:id - Update affiliate
   */
  app.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = AffiliateIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid affiliate ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateAffiliateSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { id } = paramsResult.data;

    try {
      const affiliate = await affiliatesService.updateAffiliate(id, bodyResult.data);

      logger.info(
        { affiliateId: id, adminId: request.user!.userId },
        'Admin updated affiliate'
      );

      return reply.send({
        success: true,
        data: {
          id: affiliate.id,
          name: affiliate.name,
          email: affiliate.email,
          code: affiliate.code,
          status: affiliate.status,
          commissionStandard: affiliate.commission_standard,
          commissionPremium: affiliate.commission_premium,
          updatedAt: affiliate.updated_at.toISOString(),
        },
      });
    } catch (error) {
      if ((error as Error).message?.includes('not found')) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Affiliate not found',
        });
      }
      throw error;
    }
  });

  /**
   * DELETE /admin/affiliates/:id - Deactivate affiliate
   */
  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = AffiliateIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid affiliate ID',
        details: paramsResult.error.issues,
      });
    }

    const { id } = paramsResult.data;

    try {
      await affiliatesService.deactivateAffiliate(id);

      logger.info(
        { affiliateId: id, adminId: request.user!.userId },
        'Admin deactivated affiliate'
      );

      return reply.send({
        success: true,
        message: 'Affiliate deactivated successfully',
      });
    } catch (error) {
      if ((error as Error).message?.includes('not found')) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Affiliate not found',
        });
      }
      throw error;
    }
  });

  // ===========================================================================
  // Affiliate Conversions
  // ===========================================================================

  /**
   * GET /admin/affiliates/:id/conversions - Get affiliate's conversions
   */
  app.get('/:id/conversions', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = AffiliateIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid affiliate ID',
        details: paramsResult.error.issues,
      });
    }

    const queryResult = ConversionsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { id } = paramsResult.data;
    const query = queryResult.data;

    const result = await affiliatesService.getAffiliateConversions(id, {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send({
      success: true,
      data: {
        conversions: result.data.map((c) => ({
          id: c.id,
          affiliateId: c.affiliate_id,
          userId: c.user_id,
          userEmail: c.user_email,
          planTier: c.plan_tier,
          commissionAmount: c.commission_amount,
          status: c.status,
          rejectionReason: c.rejection_reason,
          paidAt: c.paid_at?.toISOString() ?? null,
          stripeInvoiceId: c.stripe_invoice_id,
          createdAt: c.created_at.toISOString(),
        })),
        hasMore: result.hasMore,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  // ===========================================================================
  // Payouts Management
  // ===========================================================================

  /**
   * GET /admin/affiliates/payouts - Get pending payouts summary
   */
  app.get('/payouts', async (request: FastifyRequest, reply: FastifyReply) => {
    const payouts = await affiliatesService.getPendingPayouts();

    return reply.send({
      success: true,
      data: {
        payouts: payouts.map((p) => ({
          affiliateId: p.affiliate_id,
          affiliateName: p.affiliate_name,
          affiliateCode: p.affiliate_code,
          affiliateEmail: p.affiliate_email,
          payoutInfo: p.payout_info,
          pendingAmount: p.pending_amount,
          pendingCount: p.pending_count,
          conversions: p.conversions.map((c) => ({
            id: c.id,
            planTier: c.plan_tier,
            commissionAmount: c.commission_amount,
            createdAt: c.created_at.toISOString(),
          })),
        })),
        totalPending: payouts.reduce((sum, p) => sum + p.pending_amount, 0),
        totalAffiliates: payouts.length,
      },
    });
  });

  /**
   * PATCH /admin/affiliates/conversions/:conversionId - Update conversion status
   */
  app.patch('/conversions/:conversionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ConversionIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid conversion ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateConversionStatusSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { conversionId } = paramsResult.data;

    try {
      const conversion = await affiliatesService.updateConversionStatus(conversionId, bodyResult.data);

      logger.info(
        { conversionId, status: bodyResult.data.status, adminId: request.user!.userId },
        'Admin updated conversion status'
      );

      return reply.send({
        success: true,
        data: {
          id: conversion.id,
          status: conversion.status,
          rejectionReason: conversion.rejection_reason,
          paidAt: conversion.paid_at?.toISOString() ?? null,
          updatedAt: conversion.updated_at.toISOString(),
        },
      });
    } catch (error) {
      if ((error as Error).message?.includes('not found')) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Conversion not found',
        });
      }
      throw error;
    }
  });

  /**
   * POST /admin/affiliates/conversions/:conversionId/pay - Mark conversion as paid
   */
  app.post('/conversions/:conversionId/pay', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ConversionIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid conversion ID',
        details: paramsResult.error.issues,
      });
    }

    const { conversionId } = paramsResult.data;

    try {
      const conversion = await affiliatesService.markConversionPaid(conversionId);

      logger.info(
        { conversionId, adminId: request.user!.userId },
        'Admin marked conversion as paid'
      );

      return reply.send({
        success: true,
        data: {
          id: conversion.id,
          status: conversion.status,
          paidAt: conversion.paid_at?.toISOString() ?? null,
        },
      });
    } catch (error) {
      if ((error as Error).message?.includes('not found')) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Conversion not found',
        });
      }
      throw error;
    }
  });

  // ===========================================================================
  // All Conversions (cross-affiliate)
  // ===========================================================================

  /**
   * GET /admin/affiliates/conversions - List all conversions across affiliates
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

    const query = queryResult.data;

    const result = await affiliatesService.listConversions({
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send({
      success: true,
      data: {
        conversions: result.data.map((c) => ({
          id: c.id,
          affiliateId: c.affiliate_id,
          affiliateName: c.affiliate_name,
          affiliateCode: c.affiliate_code,
          userId: c.user_id,
          userEmail: c.user_email,
          planTier: c.plan_tier,
          commissionAmount: c.commission_amount,
          status: c.status,
          rejectionReason: c.rejection_reason,
          paidAt: c.paid_at?.toISOString() ?? null,
          stripeInvoiceId: c.stripe_invoice_id,
          createdAt: c.created_at.toISOString(),
        })),
        hasMore: result.hasMore,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });
}
