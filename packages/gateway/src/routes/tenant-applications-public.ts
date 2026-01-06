/**
 * Public Tenant Applications
 * Allows creators to apply to become a tenant (white-label).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { optionalAuth } from '../middleware/auth.js';
import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import { normalizeDomainInput } from './admin-tenants.js';

const TenantApplicationBodySchema = z.object({
  applicantName: z.string().min(1).max(200),
  applicantEmail: z.string().email().max(320),
  desiredTenantName: z.string().min(1).max(120),
  desiredSlug: z.string().min(2).max(80),
  desiredPrimaryDomain: z.string().optional(),
  brandConfig: z.record(z.unknown()).optional(),
  message: z.string().max(5000).optional(),
});

export async function tenantApplicationsPublicRoutes(app: FastifyInstance): Promise<void> {
  // Optional auth so logged-in creators can be linked to the application
  app.addHook('preHandler', optionalAuth);

  /**
   * POST /public/tenant-applications - Submit a tenant application
   */
  app.post('/tenant-applications', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = TenantApplicationBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const {
      applicantName,
      applicantEmail,
      desiredTenantName,
      desiredSlug,
      desiredPrimaryDomain,
      brandConfig,
      message,
    } = bodyResult.data;

    const normalizedDomain = desiredPrimaryDomain ? normalizeDomainInput(desiredPrimaryDomain) : null;

    try {
      const db = sql();
      const rows = await db`
        INSERT INTO tenant_applications (
          applicant_name,
          applicant_email,
          applicant_user_id,
          desired_tenant_name,
          desired_slug,
          desired_primary_domain,
          brand_config,
          message
        ) VALUES (
          ${applicantName},
          ${applicantEmail},
          ${request.user?.userId ?? null},
          ${desiredTenantName},
          ${desiredSlug},
          ${normalizedDomain},
          ${JSON.stringify(brandConfig ?? {})}::jsonb,
          ${message ?? null}
        )
        RETURNING id, status, created_at
      `;

      const row = rows[0];
      if (!row) {
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to submit application',
        });
      }

      return reply.status(201).send({
        success: true,
        data: {
          id: row['id'] as string,
          status: row['status'] as string,
          createdAt: (row['created_at'] as Date).toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to submit tenant application');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to submit application',
      });
    }
  });
}

