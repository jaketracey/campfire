import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tenantApplicationsPublicRoutes } from '../../src/routes/tenant-applications-public.js';
import { adminTenantApplicationsRoutes } from '../../src/routes/admin-tenant-applications.js';

const { authState, mockDb } = vi.hoisted(() => {
  const authState = { role: 'admin' as 'admin' | 'user', userId: 'admin-user' };
  const mockDb = vi.fn().mockResolvedValue([]);
  (mockDb as any).begin = vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockDb));
  return { authState, mockDb };
});

vi.mock('../../src/db/pool.js', () => ({
  sql: () => mockDb,
}));

vi.mock('../../src/observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    })),
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  optionalAuth: async (request: any) => {
    // no-op by default (anonymous)
    request.user = undefined;
  },
  requireAdmin: async (request: any, reply: any) => {
    const authHeader = request.headers?.authorization;
    if (!authHeader) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
      });
    }
    request.user = { userId: authState.userId, email: 'admin@example.com', role: authState.role };
    if (authState.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }
  },
}));

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(tenantApplicationsPublicRoutes, { prefix: '/api/v1/public' });
  await app.register(adminTenantApplicationsRoutes, { prefix: '/api/v1/admin/tenants/applications' });
  return app;
}

describe('tenant applications routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.mockReset();
    mockDb.mockResolvedValue([]);
    authState.role = 'admin';
  });

  it('submits a public application', async () => {
    mockDb.mockResolvedValueOnce([{ id: 'app-1', status: 'submitted', created_at: new Date('2026-01-01T00:00:00Z') }]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/tenant-applications',
      payload: {
        applicantName: 'Creator',
        applicantEmail: 'creator@example.com',
        desiredTenantName: 'Creator Brand',
        desiredSlug: 'creator-brand',
        desiredPrimaryDomain: 'https://creator.example.com',
        brandConfig: { primaryHsl: '0 0% 0%' },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('app-1');
  });

  it('lists applications (admin)', async () => {
    mockDb.mockResolvedValueOnce([
      {
        id: 'app-1',
        status: 'submitted',
        applicant_name: 'Creator',
        applicant_email: 'creator@example.com',
        applicant_user_id: null,
        desired_tenant_name: 'Creator Brand',
        desired_slug: 'creator-brand',
        desired_primary_domain: 'creator.example.com',
        brand_config: {},
        message: null,
        reviewed_by_user_id: null,
        reviewed_at: null,
        decision_reason: null,
        approved_tenant_id: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tenants/applications',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.applications).toHaveLength(1);
    expect(body.data.applications[0].id).toBe('app-1');
  });

  it('approves an application (admin) and creates tenant/domain', async () => {
    (mockDb as any).begin = vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockDb));
    const applicationId = '550e8400-e29b-41d4-a716-446655440501';
    const ownerUserId = '550e8400-e29b-41d4-a716-446655440000';

    // SELECT application FOR UPDATE
    mockDb.mockResolvedValueOnce([
      { id: applicationId, status: 'submitted', desired_slug: 'creator-brand', desired_tenant_name: 'Creator Brand', brand_config: {} },
    ]);
    // INSERT tenant
    mockDb.mockResolvedValueOnce([
      {
        id: 'tenant-1',
        owner_user_id: ownerUserId,
        slug: 'creator-brand',
        name: 'Creator Brand',
        status: 'active',
        brand_config: {},
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    // UPDATE tenant_domains set is_primary false
    mockDb.mockResolvedValueOnce([]);
    // INSERT tenant_domain
    mockDb.mockResolvedValueOnce([
      {
        id: 'domain-1',
        tenant_id: 'tenant-1',
        domain: 'creator.example.com',
        is_primary: true,
        verification_token: 'token',
        verified_at: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    // UPDATE application
    mockDb.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/tenants/applications/${applicationId}/approve`,
      headers: { authorization: 'Bearer token' },
      payload: {
        ownerUserId,
        primaryDomain: 'creator.example.com',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.tenant.id).toBe('tenant-1');
    expect(body.data.domain.domain).toBe('creator.example.com');
  });
});
