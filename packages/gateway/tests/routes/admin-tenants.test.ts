import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { adminTenantsRoutes } from '../../src/routes/admin-tenants.js';

const { authState, mockDb } = vi.hoisted(() => {
  const authState = { role: 'admin' as 'admin' | 'user' };

  const mockDb = vi.fn().mockResolvedValue([]);
  (mockDb as any).begin = vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockDb));

  return { authState, mockDb };
});

vi.mock('../../src/middleware/auth.js', () => ({
  requireAdmin: async (request: any, reply: any) => {
    const authHeader = request.headers?.authorization;
    if (!authHeader) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
      });
    }
    request.user = { userId: 'admin-user', email: 'admin@example.com', role: authState.role };
    if (authState.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }
  },
}));

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

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(adminTenantsRoutes, { prefix: '/api/v1/admin/tenants' });
  return app;
}

describe('adminTenantsRoutes', () => {
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

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/tenants' });
    expect(res.statusCode).toBe(401);
  });

  it('lists tenants', async () => {
    mockDb.mockResolvedValueOnce([
      {
        id: '550e8400-e29b-41d4-a716-446655440100',
        owner_user_id: '550e8400-e29b-41d4-a716-446655440000',
        slug: 'creator-one',
        name: 'Creator One',
        status: 'active',
        brand_config: { primaryHsl: '0 0% 0%' },
        created_at: new Date('2025-01-01T00:00:00Z'),
        updated_at: new Date('2025-01-02T00:00:00Z'),
        primary_domain: 'creator.example.com',
        domain_count: 1,
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tenants',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.tenants).toHaveLength(1);
    expect(body.data.tenants[0]).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440100',
      slug: 'creator-one',
      name: 'Creator One',
      primaryDomain: 'creator.example.com',
      domainCount: 1,
    });
  });

  it('creates a tenant', async () => {
    mockDb.mockResolvedValueOnce([
      {
        id: '550e8400-e29b-41d4-a716-446655440101',
        owner_user_id: '550e8400-e29b-41d4-a716-446655440000',
        slug: 'new-tenant',
        name: 'New Tenant',
        status: 'active',
        brand_config: {},
        created_at: new Date('2025-01-01T00:00:00Z'),
        updated_at: new Date('2025-01-01T00:00:00Z'),
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants',
      headers: { authorization: 'Bearer token' },
      payload: {
        ownerUserId: '550e8400-e29b-41d4-a716-446655440000',
        slug: 'new-tenant',
        name: 'New Tenant',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.slug).toBe('new-tenant');
  });

  it('adds a domain', async () => {
    (mockDb as any).begin = vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockDb));
    mockDb.mockResolvedValueOnce([{ id: 'tenant-id' }]); // tenant exists
    mockDb.mockResolvedValueOnce([]); // clear existing primary (isPrimary=true)
    mockDb.mockResolvedValueOnce([
      {
        id: 'domain-id',
        tenant_id: 'tenant-id',
        domain: 'creator.example.com',
        is_primary: true,
        verification_token: 'token',
        verified_at: null,
        created_at: new Date('2025-01-01T00:00:00Z'),
        updated_at: new Date('2025-01-01T00:00:00Z'),
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/550e8400-e29b-41d4-a716-446655440100/domains',
      headers: { authorization: 'Bearer token' },
      payload: { domain: 'https://creator.example.com', isPrimary: true },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.domain).toBe('creator.example.com');
    expect(body.data.isPrimary).toBe(true);
    expect(body.data.verificationToken).toBeTruthy();
  });
});
