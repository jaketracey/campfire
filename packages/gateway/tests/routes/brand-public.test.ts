import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { brandPublicRoutes } from '../../src/routes/brand-public.js';

const mockBrandingService = {
  resolveFromHeaders: vi.fn(),
};

vi.mock('../../src/services/branding.js', () => ({
  getBrandingService: () => mockBrandingService,
}));

vi.mock('../../src/observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Public Brand Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(brandPublicRoutes, { prefix: '/public' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns resolved brand config', async () => {
    mockBrandingService.resolveFromHeaders.mockResolvedValue({
      host: 'creator.example',
      baseUrl: 'https://creator.example',
      tenant: { id: 'tenant-1', slug: 'creator', ownerUserId: 'user-1' },
      brand: { name: 'Creator Brand', shortName: 'Creator' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/public/brand',
      headers: { host: 'creator.example' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.brand.name).toBe('Creator Brand');
    expect(body.data.tenant.slug).toBe('creator');
  });

  it('handles errors', async () => {
    mockBrandingService.resolveFromHeaders.mockRejectedValue(new Error('boom'));

    const res = await app.inject({
      method: 'GET',
      url: '/public/brand',
      headers: { host: 'creator.example' },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

