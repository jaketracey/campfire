/**
 * Admin Tenant Applications Routes
 * Review + approval workflow for onboarding new tenants.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import { normalizeDomainInput } from './admin-tenants.js';
import { nanoid } from 'nanoid';

const ApplicationIdParamsSchema = z.object({
  applicationId: z.string().uuid(),
});

const ListApplicationsQuerySchema = z.object({
  status: z.enum(['submitted', 'approved', 'rejected']).optional(),
  search: z.string().optional(),
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 50),
  offset: z.string().optional().transform(v => v ? parseInt(v, 10) : 0),
});

const ApproveBodySchema = z.object({
  ownerUserId: z.string().uuid(),
  slug: z.string().min(2).max(80).optional(),
  name: z.string().min(1).max(120).optional(),
  primaryDomain: z.string().optional(),
  markDomainVerified: z.boolean().optional().default(false),
  brandConfig: z.record(z.unknown()).optional(),
  decisionReason: z.string().max(5000).optional(),
});

const RejectBodySchema = z.object({
  decisionReason: z.string().max(5000).optional(),
});

export async function adminTenantApplicationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/tenants/applications - List applications
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = ListApplicationsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { status, search, limit, offset } = queryResult.data;

    try {
      const db = sql();
      const rows = await db`
        SELECT
          id,
          status,
          applicant_name,
          applicant_email,
          applicant_user_id,
          desired_tenant_name,
          desired_slug,
          desired_primary_domain,
          brand_config,
          message,
          reviewed_by_user_id,
          reviewed_at,
          decision_reason,
          approved_tenant_id,
          created_at,
          updated_at
        FROM tenant_applications
        WHERE
          (${status ?? null}::tenant_application_status IS NULL OR status = ${status ?? null}::tenant_application_status)
          AND (
            ${search ?? null}::text IS NULL
            OR applicant_email ILIKE '%' || ${search ?? ''} || '%'
            OR applicant_name ILIKE '%' || ${search ?? ''} || '%'
            OR desired_slug ILIKE '%' || ${search ?? ''} || '%'
            OR desired_tenant_name ILIKE '%' || ${search ?? ''} || '%'
            OR desired_primary_domain ILIKE '%' || ${search ?? ''} || '%'
          )
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      return reply.send({
        success: true,
        data: {
          applications: rows.map((row) => ({
            id: row['id'] as string,
            status: row['status'] as string,
            applicantName: row['applicant_name'] as string,
            applicantEmail: row['applicant_email'] as string,
            applicantUserId: (row['applicant_user_id'] as string | null) ?? null,
            desiredTenantName: row['desired_tenant_name'] as string,
            desiredSlug: row['desired_slug'] as string,
            desiredPrimaryDomain: (row['desired_primary_domain'] as string | null) ?? null,
            brandConfig: (row['brand_config'] as Record<string, unknown>) ?? {},
            message: (row['message'] as string | null) ?? null,
            reviewedByUserId: (row['reviewed_by_user_id'] as string | null) ?? null,
            reviewedAt: row['reviewed_at'] ? (row['reviewed_at'] as Date).toISOString() : null,
            decisionReason: (row['decision_reason'] as string | null) ?? null,
            approvedTenantId: (row['approved_tenant_id'] as string | null) ?? null,
            createdAt: (row['created_at'] as Date).toISOString(),
            updatedAt: (row['updated_at'] as Date).toISOString(),
          })),
          limit,
          offset,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list tenant applications');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to list applications',
      });
    }
  });

  /**
   * GET /admin/tenants/applications/:applicationId - Details
   */
  app.get('/:applicationId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ApplicationIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid application ID',
        details: paramsResult.error.issues,
      });
    }
    const { applicationId } = paramsResult.data;

    try {
      const db = sql();
      const rows = await db`
        SELECT
          id,
          status,
          applicant_name,
          applicant_email,
          applicant_user_id,
          desired_tenant_name,
          desired_slug,
          desired_primary_domain,
          brand_config,
          message,
          reviewed_by_user_id,
          reviewed_at,
          decision_reason,
          approved_tenant_id,
          approved_domain_id,
          created_at,
          updated_at
        FROM tenant_applications
        WHERE id = ${applicationId}
      `;

      const row = rows[0];
      if (!row) {
        return reply.status(404).send({ error: 'Not Found', message: 'Application not found' });
      }

      return reply.send({
        success: true,
        data: {
          application: {
            id: row['id'] as string,
            status: row['status'] as string,
            applicantName: row['applicant_name'] as string,
            applicantEmail: row['applicant_email'] as string,
            applicantUserId: (row['applicant_user_id'] as string | null) ?? null,
            desiredTenantName: row['desired_tenant_name'] as string,
            desiredSlug: row['desired_slug'] as string,
            desiredPrimaryDomain: (row['desired_primary_domain'] as string | null) ?? null,
            brandConfig: (row['brand_config'] as Record<string, unknown>) ?? {},
            message: (row['message'] as string | null) ?? null,
            reviewedByUserId: (row['reviewed_by_user_id'] as string | null) ?? null,
            reviewedAt: row['reviewed_at'] ? (row['reviewed_at'] as Date).toISOString() : null,
            decisionReason: (row['decision_reason'] as string | null) ?? null,
            approvedTenantId: (row['approved_tenant_id'] as string | null) ?? null,
            approvedDomainId: (row['approved_domain_id'] as string | null) ?? null,
            createdAt: (row['created_at'] as Date).toISOString(),
            updatedAt: (row['updated_at'] as Date).toISOString(),
          },
        },
      });
    } catch (error) {
      logger.error({ error, applicationId }, 'Failed to load tenant application');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to load application',
      });
    }
  });

  /**
   * POST /admin/tenants/applications/:applicationId/approve
   */
  app.post('/:applicationId/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ApplicationIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid application ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = ApproveBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { applicationId } = paramsResult.data;
    const adminUserId = request.user?.userId ?? null;
    const {
      ownerUserId,
      slug: overrideSlug,
      name: overrideName,
      primaryDomain,
      markDomainVerified,
      brandConfig,
      decisionReason,
    } = bodyResult.data;

    const normalizedDomain = primaryDomain ? normalizeDomainInput(primaryDomain) : null;

    try {
      const db = sql();
      const result = await db.begin(async (tx) => {
        const appRows = await tx`
          SELECT *
          FROM tenant_applications
          WHERE id = ${applicationId}
          FOR UPDATE
        `;
        const application = appRows[0] as Record<string, unknown> | undefined;
        if (!application) return { type: 'not_found' as const };

        const currentStatus = application['status'] as string;
        if (currentStatus === 'approved') return { type: 'already_approved' as const, application };
        if (currentStatus === 'rejected') return { type: 'already_rejected' as const, application };

        const slug = (overrideSlug ?? (application['desired_slug'] as string)).trim();
        const name = (overrideName ?? (application['desired_tenant_name'] as string)).trim();
        const cfg = brandConfig ?? ((application['brand_config'] as Record<string, unknown>) ?? {});

        const tenantRows = await tx`
          INSERT INTO tenants (owner_user_id, slug, name, status, brand_config)
          VALUES (${ownerUserId}, ${slug}, ${name}, 'active', ${JSON.stringify(cfg)}::jsonb)
          RETURNING id, owner_user_id, slug, name, status, brand_config, created_at, updated_at
        `;
        const tenant = tenantRows[0] as Record<string, unknown> | undefined;
        if (!tenant) {
          throw new Error('Failed to create tenant');
        }

        let domainRow: Record<string, unknown> | null = null;
        if (normalizedDomain) {
          await tx`UPDATE tenant_domains SET is_primary = FALSE WHERE tenant_id = ${tenant['id'] as string}`;
          const verificationToken = nanoid(32);
          const rows = await tx`
            INSERT INTO tenant_domains (tenant_id, domain, is_primary, verification_token, verified_at)
            VALUES (
              ${tenant['id'] as string},
              ${normalizedDomain},
              TRUE,
              ${verificationToken},
              ${markDomainVerified ? tx`NOW()` : null}
            )
            RETURNING id, tenant_id, domain, is_primary, verification_token, verified_at, created_at, updated_at
          `;
          domainRow = (rows[0] as Record<string, unknown> | undefined) ?? null;
        }

        await tx`
          UPDATE tenant_applications
          SET
            status = 'approved',
            reviewed_by_user_id = ${adminUserId},
            reviewed_at = NOW(),
            decision_reason = ${decisionReason ?? null},
            approved_tenant_id = ${tenant['id'] as string},
            approved_domain_id = ${domainRow ? (domainRow['id'] as string) : null}
          WHERE id = ${applicationId}
        `;

        return { type: 'ok' as const, tenant, domainRow };
      });

      if (result.type === 'not_found') {
        return reply.status(404).send({ error: 'Not Found', message: 'Application not found' });
      }
      if (result.type === 'already_approved') {
        return reply.status(409).send({ error: 'Conflict', message: 'Application already approved' });
      }
      if (result.type === 'already_rejected') {
        return reply.status(409).send({ error: 'Conflict', message: 'Application already rejected' });
      }

      const tenant = result.tenant;
      const domainRow = result.domainRow;

      return reply.send({
        success: true,
        data: {
          tenant: {
            id: tenant['id'] as string,
            ownerUserId: tenant['owner_user_id'] as string,
            slug: tenant['slug'] as string,
            name: tenant['name'] as string,
            status: tenant['status'] as string,
            brandConfig: (tenant['brand_config'] as Record<string, unknown>) ?? {},
            createdAt: (tenant['created_at'] as Date).toISOString(),
            updatedAt: (tenant['updated_at'] as Date).toISOString(),
          },
          domain: domainRow
            ? {
              id: domainRow['id'] as string,
              tenantId: domainRow['tenant_id'] as string,
              domain: domainRow['domain'] as string,
              isPrimary: Boolean(domainRow['is_primary']),
              verificationToken: (domainRow['verification_token'] as string | null) ?? null,
              verifiedAt: domainRow['verified_at'] ? (domainRow['verified_at'] as Date).toISOString() : null,
              createdAt: (domainRow['created_at'] as Date).toISOString(),
              updatedAt: (domainRow['updated_at'] as Date).toISOString(),
            }
            : null,
        },
      });
    } catch (error) {
      logger.error({ error, applicationId }, 'Failed to approve tenant application');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to approve application',
      });
    }
  });

  /**
   * POST /admin/tenants/applications/:applicationId/reject
   */
  app.post('/:applicationId/reject', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = ApplicationIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid application ID',
        details: paramsResult.error.issues,
      });
    }
    const bodyResult = RejectBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { applicationId } = paramsResult.data;
    const adminUserId = request.user?.userId ?? null;

    try {
      const db = sql();
      const rows = await db`
        UPDATE tenant_applications
        SET
          status = 'rejected',
          reviewed_by_user_id = ${adminUserId},
          reviewed_at = NOW(),
          decision_reason = ${bodyResult.data.decisionReason ?? null}
        WHERE id = ${applicationId}
          AND status = 'submitted'
        RETURNING id
      `;

      if (!rows[0]) {
        // Could be not found, or not submitted anymore
        const exists = await db`SELECT id FROM tenant_applications WHERE id = ${applicationId}`;
        if (!exists[0]) {
          return reply.status(404).send({ error: 'Not Found', message: 'Application not found' });
        }
        return reply.status(409).send({ error: 'Conflict', message: 'Application is not in submitted state' });
      }

      return reply.send({ success: true });
    } catch (error) {
      logger.error({ error, applicationId }, 'Failed to reject tenant application');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to reject application',
      });
    }
  });
}

