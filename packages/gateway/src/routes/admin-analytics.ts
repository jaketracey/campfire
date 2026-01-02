/**
 * Admin Analytics Routes
 * Engagement and revenue analytics for administrators.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { getAnalyticsService } from '../services/analytics.js';
import { logger } from '../observability/logger.js';

// ===========================================================================
// Request Schemas
// ===========================================================================

const DaysQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
});

const RetentionQuerySchema = z.object({
  period: z.enum(['weekly', 'monthly']).optional().default('weekly'),
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 12),
});

const CompanionQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 10),
});

const AggregateBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

const BackfillBodySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

// ===========================================================================
// Routes
// ===========================================================================

/**
 * Register admin analytics routes
 */
export async function adminAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  const analytics = getAnalyticsService();

  // All routes require admin role
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // Engagement Endpoints
  // ===========================================================================

  /**
   * GET /admin/analytics/engagement - Engagement summary
   */
  app.get('/engagement', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = DaysQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days } = queryResult.data;

    try {
      const summary = await analytics.getEngagementSummary(days);

      return reply.send({
        success: true,
        data: {
          period: { days },
          ...summary,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get engagement summary');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve engagement metrics',
      });
    }
  });

  /**
   * GET /admin/analytics/retention - Retention cohorts
   */
  app.get('/retention', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = RetentionQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { period, limit } = queryResult.data;

    try {
      const cohorts = await analytics.getRetentionData(period, limit);

      return reply.send({
        success: true,
        data: {
          period,
          cohorts,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get retention data');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve retention metrics',
      });
    }
  });

  /**
   * GET /admin/analytics/companions - Companion popularity
   */
  app.get('/companions', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CompanionQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days, limit } = queryResult.data;

    try {
      const companions = await analytics.getCompanionAnalytics(days, limit);

      return reply.send({
        success: true,
        data: {
          period: { days },
          companions,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get companion analytics');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve companion metrics',
      });
    }
  });

  /**
   * GET /admin/analytics/user-distribution - User activity buckets
   */
  app.get('/user-distribution', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = DaysQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days } = queryResult.data;

    try {
      const distribution = await analytics.getUserDistribution(days);

      return reply.send({
        success: true,
        data: {
          period: { days },
          distribution,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get user distribution');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve user distribution',
      });
    }
  });

  // ===========================================================================
  // Revenue Endpoints
  // ===========================================================================

  /**
   * GET /admin/analytics/revenue - Revenue summary
   */
  app.get('/revenue', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = DaysQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days } = queryResult.data;

    try {
      const summary = await analytics.getRevenueSummary(days);

      return reply.send({
        success: true,
        data: {
          period: { days },
          ...summary,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get revenue summary');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve revenue metrics',
      });
    }
  });

  /**
   * GET /admin/analytics/funnel - Conversion funnel
   */
  app.get('/funnel', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const funnel = await analytics.getConversionFunnel();

      return reply.send({
        success: true,
        data: funnel,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get conversion funnel');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve conversion funnel',
      });
    }
  });

  // ===========================================================================
  // Aggregation Endpoints
  // ===========================================================================

  /**
   * POST /admin/analytics/aggregate - Trigger aggregation for a date
   */
  app.post('/aggregate', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = AggregateBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { date } = bodyResult.data;
    const adminUserId = request.user?.userId;

    try {
      await analytics.aggregateDailyMetrics(date);

      logger.info({ date, adminUserId }, 'Manual analytics aggregation triggered');

      return reply.send({
        success: true,
        data: {
          date,
          aggregated: true,
        },
      });
    } catch (error) {
      logger.error({ error, date }, 'Failed to aggregate analytics');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to aggregate analytics',
      });
    }
  });

  /**
   * POST /admin/analytics/backfill - Backfill aggregations for a date range
   */
  app.post('/backfill', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = BackfillBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { startDate, endDate } = bodyResult.data;
    const adminUserId = request.user?.userId;

    try {
      const result = await analytics.backfillAggregations(startDate, endDate);

      logger.info({ startDate, endDate, adminUserId, ...result }, 'Analytics backfill completed');

      return reply.send({
        success: true,
        data: {
          startDate,
          endDate,
          processed: result.processed,
          errors: result.errors,
        },
      });
    } catch (error) {
      logger.error({ error, startDate, endDate }, 'Failed to backfill analytics');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to backfill analytics',
      });
    }
  });
}
