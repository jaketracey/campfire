/**
 * Affiliate Tracking Routes
 * Public endpoints for click tracking and attribution.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getAffiliatesService } from '../services/affiliates.js';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';

// Params schemas
const TrackCodeParamsSchema = z.object({
  code: z.string().min(1).max(50),
});

// Cookie configuration
const AFFILIATE_COOKIE_NAME = 'campfire_aff';
const COOKIE_MAX_AGE_DAYS = 30;
const COOKIE_MAX_AGE_SECONDS = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;

/**
 * Register affiliate tracking routes
 */
export async function affiliateTrackingRoutes(app: FastifyInstance): Promise<void> {
  const affiliatesService = getAffiliatesService();

  /**
   * GET /track/:code - Record click and redirect to signup
   *
   * This endpoint:
   * 1. Validates the affiliate code
   * 2. Records the click
   * 3. Sets a tracking cookie
   * 4. Redirects to the signup page
   */
  app.get('/track/:code', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = TrackCodeParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      // Invalid code format - just redirect to signup without tracking
      const baseUrl = env.APP_URL;
      return reply.redirect(`${baseUrl}/signup`);
    }

    const { code } = paramsResult.data;
    const userAgent = request.headers['user-agent'];
    const referrer = request.headers.referer ?? request.headers.referrer;
    const referrerUrl = Array.isArray(referrer) ? referrer[0] : referrer;

    try {
      const result = await affiliatesService.recordClick({
        code,
        ipAddress: request.ip,
        userAgent,
        referrerUrl,
        landingPage: request.url,
      });

      if (result) {
        // Set tracking cookie with affiliate code and click ID
        const cookieValue = `${code}:${result.click.id}`;

        reply.header(
          'Set-Cookie',
          `${AFFILIATE_COOKIE_NAME}=${cookieValue}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Path=/; SameSite=Lax${env.NODE_ENV === 'production' ? '; Secure' : ''}`
        );

        logger.debug(
          { affiliateCode: code, clickId: result.click.id },
          'Affiliate click recorded and cookie set'
        );
      } else {
        logger.debug({ code }, 'Invalid or inactive affiliate code');
      }
    } catch (error) {
      logger.error({ err: error, code }, 'Error recording affiliate click');
      // Don't fail the redirect on tracking errors
    }

    // Always redirect to signup
    const baseUrl = env.APP_URL;
    return reply.redirect(`${baseUrl}/signup?ref=${encodeURIComponent(code)}`);
  });

  /**
   * GET /ref/:code - Alternative tracking URL format
   */
  app.get('/ref/:code', async (request: FastifyRequest, reply: FastifyReply) => {
    // Delegate to the main tracking endpoint
    const paramsResult = TrackCodeParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      const baseUrl = env.APP_URL;
      return reply.redirect(`${baseUrl}/signup`);
    }

    const { code } = paramsResult.data;
    const userAgent = request.headers['user-agent'];
    const referrer = request.headers.referer ?? request.headers.referrer;
    const referrerUrl = Array.isArray(referrer) ? referrer[0] : referrer;

    try {
      const result = await affiliatesService.recordClick({
        code,
        ipAddress: request.ip,
        userAgent,
        referrerUrl,
        landingPage: request.url,
      });

      if (result) {
        const cookieValue = `${code}:${result.click.id}`;

        reply.header(
          'Set-Cookie',
          `${AFFILIATE_COOKIE_NAME}=${cookieValue}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Path=/; SameSite=Lax${env.NODE_ENV === 'production' ? '; Secure' : ''}`
        );
      }
    } catch (error) {
      logger.error({ err: error, code }, 'Error recording affiliate click');
    }

    const baseUrl = env.APP_URL;
    return reply.redirect(`${baseUrl}/signup?ref=${encodeURIComponent(code)}`);
  });

  /**
   * POST /api/v1/affiliate/validate - Validate an affiliate code (for frontend use)
   *
   * This allows the frontend to check if a code is valid before setting cookies
   * or showing the affiliate code in the UI.
   */
  app.post('/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = z.object({ code: z.string() }).safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        valid: false,
      });
    }

    const { code } = bodyResult.data;
    const userAgent = request.headers['user-agent'];
    const referrer = request.headers.referer ?? request.headers.referrer;
    const referrerUrl = Array.isArray(referrer) ? referrer[0] : referrer;
    const origin = request.headers.origin;
    const landingPage = Array.isArray(origin) ? origin[0] : (origin || '/');

    try {
      const result = await affiliatesService.recordClick({
        code,
        ipAddress: request.ip,
        userAgent,
        referrerUrl,
        landingPage,
      });

      if (result) {
        // Set cookie on successful validation
        const cookieValue = `${code}:${result.click.id}`;

        reply.header(
          'Set-Cookie',
          `${AFFILIATE_COOKIE_NAME}=${cookieValue}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Path=/; SameSite=Lax${env.NODE_ENV === 'production' ? '; Secure' : ''}`
        );

        return reply.send({
          success: true,
          valid: true,
          affiliateName: result.affiliate.name,
        });
      } else {
        return reply.send({
          success: true,
          valid: false,
        });
      }
    } catch (error) {
      logger.error({ err: error, code }, 'Error validating affiliate code');
      return reply.send({
        success: true,
        valid: false,
      });
    }
  });
}

/**
 * Parse the affiliate cookie value
 * Returns { code, clickId } or null if invalid
 */
export function parseAffiliateCookie(cookieValue: string | undefined): { code: string; clickId: string } | null {
  if (!cookieValue) {
    return null;
  }

  const parts = cookieValue.split(':');
  if (parts.length !== 2) {
    return null;
  }

  const [code, clickId] = parts;
  if (!code || !clickId) {
    return null;
  }

  return { code, clickId };
}

/**
 * Cookie name export for use in other modules
 */
export const AFFILIATE_COOKIE = AFFILIATE_COOKIE_NAME;
