/**
 * Admin Tenants Routes
 * CRUD endpoints for white-label tenants and their domains.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAdmin } from '../middleware/auth.js';
import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';

const TenantIdParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

const DomainIdParamsSchema = z.object({
  tenantId: z.string().uuid(),
  domainId: z.string().uuid(),
});

const TenantStatusSchema = z.enum(['active', 'suspended']);

const ListTenantsQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 50),
  offset: z.string().optional().transform(v => v ? parseInt(v, 10) : 0),
});

const CreateTenantBodySchema = z.object({
  ownerUserId: z.string().uuid(),
  slug: z.string().min(2).max(80),
  name: z.string().min(1).max(120),
  status: TenantStatusSchema.optional(),
  brandConfig: z.record(z.unknown()).optional(),
});

const UpdateTenantBodySchema = z.object({
  slug: z.string().min(2).max(80).optional(),
  name: z.string().min(1).max(120).optional(),
  status: TenantStatusSchema.optional(),
  brandConfig: z.record(z.unknown()).optional(),
});

export function normalizeDomainInput(domain: string): string {
  const trimmed = domain.trim().toLowerCase();
  const noScheme = trimmed.replace(/^https?:\/\//, '');
  const noPath = noScheme.split('/')[0] ?? '';
  const hostOnly = noPath.split(':')[0] ?? '';
  if (!hostOnly) return '';
  return hostOnly;
}

const CreateDomainBodySchema = z.object({
  domain: z.string().min(1).max(255),
  isPrimary: z.boolean().optional().default(false),
});

const UpdateDomainBodySchema = z.object({
  isPrimary: z.boolean().optional(),
});

export async function adminTenantsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/tenants - List tenants
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = ListTenantsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { search, limit, offset } = queryResult.data;

    try {
      const db = sql();
      const rows = await db`
        SELECT
          t.id,
          t.owner_user_id,
          t.slug,
          t.name,
          t.status,
          t.brand_config,
          t.created_at,
          t.updated_at,
          (
            SELECT d.domain
            FROM tenant_domains d
            WHERE d.tenant_id = t.id AND d.is_primary = TRUE
            LIMIT 1
          ) AS primary_domain,
          (
            SELECT COUNT(*)::int
            FROM tenant_domains d
            WHERE d.tenant_id = t.id
          ) AS domain_count
        FROM tenants t
        WHERE (
          ${search ?? null}::text IS NULL
          OR t.slug ILIKE '%' || ${search ?? ''} || '%'
          OR t.name ILIKE '%' || ${search ?? ''} || '%'
        )
        ORDER BY t.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      return reply.send({
        success: true,
        data: {
          tenants: rows.map((row) => ({
            id: row['id'] as string,
            ownerUserId: row['owner_user_id'] as string,
            slug: row['slug'] as string,
            name: row['name'] as string,
            status: row['status'] as string,
            brandConfig: (row['brand_config'] as Record<string, unknown>) ?? {},
            primaryDomain: (row['primary_domain'] as string | null) ?? null,
            domainCount: Number(row['domain_count'] ?? 0),
            createdAt: (row['created_at'] as Date).toISOString(),
            updatedAt: (row['updated_at'] as Date).toISOString(),
          })),
          limit,
          offset,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list tenants');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to list tenants',
      });
    }
  });

  /**
   * POST /admin/tenants - Create tenant
   */
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = CreateTenantBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { ownerUserId, slug, name, status, brandConfig } = bodyResult.data;

    try {
      const db = sql();
      const rows = await db`
        INSERT INTO tenants (owner_user_id, slug, name, status, brand_config)
        VALUES (${ownerUserId}, ${slug}, ${name}, ${status ?? 'active'}, ${JSON.stringify(brandConfig ?? {})}::jsonb)
        RETURNING id, owner_user_id, slug, name, status, brand_config, created_at, updated_at
      `;

      const row = rows[0];
      if (!row) {
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to create tenant',
        });
      }

      return reply.status(201).send({
        success: true,
        data: {
          id: row['id'] as string,
          ownerUserId: row['owner_user_id'] as string,
          slug: row['slug'] as string,
          name: row['name'] as string,
          status: row['status'] as string,
          brandConfig: (row['brand_config'] as Record<string, unknown>) ?? {},
          createdAt: (row['created_at'] as Date).toISOString(),
          updatedAt: (row['updated_at'] as Date).toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create tenant');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create tenant',
      });
    }
  });

  /**
   * GET /admin/tenants/:tenantId - Tenant details
   */
  app.get('/:tenantId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = TenantIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid tenant ID',
        details: paramsResult.error.issues,
      });
    }

    const { tenantId } = paramsResult.data;

    try {
      const db = sql();
      const tenantRows = await db`
        SELECT id, owner_user_id, slug, name, status, brand_config, created_at, updated_at
        FROM tenants
        WHERE id = ${tenantId}
      `;

      const tenant = tenantRows[0];
      if (!tenant) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Tenant not found',
        });
      }

      const domainRows = await db`
        SELECT id, tenant_id, domain, is_primary, verification_token, verified_at, created_at, updated_at
        FROM tenant_domains
        WHERE tenant_id = ${tenantId}
        ORDER BY is_primary DESC, domain ASC
      `;

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
          domains: domainRows.map((row) => ({
            id: row['id'] as string,
            tenantId: row['tenant_id'] as string,
            domain: row['domain'] as string,
            isPrimary: Boolean(row['is_primary']),
            verificationToken: (row['verification_token'] as string | null) ?? null,
            verifiedAt: row['verified_at'] ? (row['verified_at'] as Date).toISOString() : null,
            createdAt: (row['created_at'] as Date).toISOString(),
            updatedAt: (row['updated_at'] as Date).toISOString(),
          })),
        },
      });
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to load tenant');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to load tenant',
      });
    }
  });

  /**
   * PATCH /admin/tenants/:tenantId - Update tenant
   */
  app.patch('/:tenantId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = TenantIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid tenant ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateTenantBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { tenantId } = paramsResult.data;
    const { slug, name, status, brandConfig } = bodyResult.data;

    try {
      const db = sql();
      const rows = await db`
        UPDATE tenants
        SET
          slug = COALESCE(${slug ?? null}, slug),
          name = COALESCE(${name ?? null}, name),
          status = COALESCE(${status ?? null}::tenant_status, status),
          brand_config = COALESCE(${brandConfig ? JSON.stringify(brandConfig) : null}::jsonb, brand_config)
        WHERE id = ${tenantId}
        RETURNING id, owner_user_id, slug, name, status, brand_config, created_at, updated_at
      `;

      const row = rows[0];
      if (!row) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Tenant not found',
        });
      }

      return reply.send({
        success: true,
        data: {
          id: row['id'] as string,
          ownerUserId: row['owner_user_id'] as string,
          slug: row['slug'] as string,
          name: row['name'] as string,
          status: row['status'] as string,
          brandConfig: (row['brand_config'] as Record<string, unknown>) ?? {},
          createdAt: (row['created_at'] as Date).toISOString(),
          updatedAt: (row['updated_at'] as Date).toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to update tenant');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update tenant',
      });
    }
  });

  /**
   * POST /admin/tenants/:tenantId/domains - Add domain
   */
  app.post('/:tenantId/domains', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = TenantIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid tenant ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = CreateDomainBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { tenantId } = paramsResult.data;
    const domain = normalizeDomainInput(bodyResult.data.domain);
    const isPrimary = bodyResult.data.isPrimary;

    if (!domain) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid domain',
      });
    }

    const verificationToken = nanoid(32);

    try {
      const db = sql();
      const row = await db.begin(async (tx) => {
        const existing = await tx`SELECT id FROM tenants WHERE id = ${tenantId}`;
        if (!existing[0]) {
          return null;
        }

        if (isPrimary) {
          await tx`UPDATE tenant_domains SET is_primary = FALSE WHERE tenant_id = ${tenantId}`;
        }

        const rows = await tx`
          INSERT INTO tenant_domains (tenant_id, domain, is_primary, verification_token)
          VALUES (${tenantId}, ${domain}, ${isPrimary}, ${verificationToken})
          RETURNING id, tenant_id, domain, is_primary, verification_token, verified_at, created_at, updated_at
        `;
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Tenant not found',
        });
      }

      return reply.status(201).send({
        success: true,
        data: {
          id: row['id'] as string,
          tenantId: row['tenant_id'] as string,
          domain: row['domain'] as string,
          isPrimary: Boolean(row['is_primary']),
          verificationToken: (row['verification_token'] as string | null) ?? null,
          verifiedAt: row['verified_at'] ? (row['verified_at'] as Date).toISOString() : null,
          createdAt: (row['created_at'] as Date).toISOString(),
          updatedAt: (row['updated_at'] as Date).toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error, tenantId, domain }, 'Failed to add tenant domain');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to add domain',
      });
    }
  });

  /**
   * PATCH /admin/tenants/:tenantId/domains/:domainId - Update domain flags
   */
  app.patch('/:tenantId/domains/:domainId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = DomainIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid parameters',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateDomainBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { tenantId, domainId } = paramsResult.data;
    const { isPrimary } = bodyResult.data;

    try {
      const db = sql();
      const row = await db.begin(async (tx) => {
        const existing = await tx`
          SELECT id, tenant_id, domain, is_primary, verification_token, verified_at, created_at, updated_at
          FROM tenant_domains
          WHERE id = ${domainId} AND tenant_id = ${tenantId}
        `;
        if (!existing[0]) return null;

        if (isPrimary === true) {
          await tx`UPDATE tenant_domains SET is_primary = FALSE WHERE tenant_id = ${tenantId}`;
        }

        const rows = await tx`
          UPDATE tenant_domains
          SET is_primary = COALESCE(${isPrimary ?? null}, is_primary)
          WHERE id = ${domainId} AND tenant_id = ${tenantId}
          RETURNING id, tenant_id, domain, is_primary, verification_token, verified_at, created_at, updated_at
        `;
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Domain not found',
        });
      }

      return reply.send({
        success: true,
        data: {
          id: row['id'] as string,
          tenantId: row['tenant_id'] as string,
          domain: row['domain'] as string,
          isPrimary: Boolean(row['is_primary']),
          verificationToken: (row['verification_token'] as string | null) ?? null,
          verifiedAt: row['verified_at'] ? (row['verified_at'] as Date).toISOString() : null,
          createdAt: (row['created_at'] as Date).toISOString(),
          updatedAt: (row['updated_at'] as Date).toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error, tenantId, domainId }, 'Failed to update tenant domain');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update domain',
      });
    }
  });

  /**
   * POST /admin/tenants/:tenantId/domains/:domainId/verify - Manually mark as verified
   */
  app.post('/:tenantId/domains/:domainId/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = DomainIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid parameters',
        details: paramsResult.error.issues,
      });
    }

    const { tenantId, domainId } = paramsResult.data;

    try {
      const db = sql();
      const rows = await db`
        UPDATE tenant_domains
        SET verified_at = NOW()
        WHERE id = ${domainId} AND tenant_id = ${tenantId}
        RETURNING id, tenant_id, domain, is_primary, verification_token, verified_at, created_at, updated_at
      `;

      const row = rows[0];
      if (!row) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Domain not found',
        });
      }

      return reply.send({
        success: true,
        data: {
          id: row['id'] as string,
          tenantId: row['tenant_id'] as string,
          domain: row['domain'] as string,
          isPrimary: Boolean(row['is_primary']),
          verificationToken: (row['verification_token'] as string | null) ?? null,
          verifiedAt: row['verified_at'] ? (row['verified_at'] as Date).toISOString() : null,
          createdAt: (row['created_at'] as Date).toISOString(),
          updatedAt: (row['updated_at'] as Date).toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error, tenantId, domainId }, 'Failed to verify tenant domain');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to verify domain',
      });
    }
  });

  /**
   * DELETE /admin/tenants/:tenantId/domains/:domainId - Remove domain
   */
  app.delete('/:tenantId/domains/:domainId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = DomainIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid parameters',
        details: paramsResult.error.issues,
      });
    }

    const { tenantId, domainId } = paramsResult.data;

    try {
      const db = sql();
      const rows = await db`
        DELETE FROM tenant_domains
        WHERE id = ${domainId} AND tenant_id = ${tenantId}
        RETURNING id
      `;

      if (!rows[0]) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Domain not found',
        });
      }

      return reply.status(204).send();
    } catch (error) {
      logger.error({ error, tenantId, domainId }, 'Failed to delete tenant domain');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete domain',
      });
    }
  });
}
