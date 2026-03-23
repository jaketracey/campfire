import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const {
  mockEnv,
  mockCompanionRepo,
} = vi.hoisted(() => ({
  mockEnv: {
    API_BASE_URL: 'https://api.example.com',
    WEB_BASE_URL: 'https://app.example.com',
    WEB_URL: 'https://app.example.com',
    ORCHESTRATOR_URL: 'https://orchestrator.example.com',
  },
  mockCompanionRepo: {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdWithAvatar: vi.fn(),
    findPublicById: vi.fn(),
    findByUserIdAndName: vi.fn(),
    list: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn(),
    updateSpec: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../env.js', () => ({ env: mockEnv }));

vi.mock('../../repositories/companions.js', () => ({
  getCompanionsRepository: () => mockCompanionRepo,
}));

vi.mock('../../repositories/sessions.js', () => ({
  getSessionsRepository: () => ({
    create: vi.fn(),
    update: vi.fn(),
    listForCompanion: vi.fn(),
    findById: vi.fn(),
    updateLastActivity: vi.fn(),
  }),
}));

vi.mock('../../repositories/knowledge-graph.js', () => ({
  getKnowledgeGraphRepository: () => ({
    createEdge: vi.fn(),
    createEntity: vi.fn(),
    upsertEntity: vi.fn(),
    upsertEdge: vi.fn(),
    findEntityByCanonicalName: vi.fn(),
    listEntities: vi.fn(),
  }),
}));

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: async (request: any, reply: any) => {
    const authHeader = request.headers?.authorization;
    if (!authHeader) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
      });
    }

    request.user = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      role: 'user',
    };
  },
  createToken: vi.fn(),
  createRefreshToken: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock('../../db/pool.js', () => ({
  sql: vi.fn(),
}));

vi.mock('../../observability/logger.js', () => ({
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

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { companionsRoutes } = await import('../companions.js');
  await app.register(companionsRoutes, { prefix: '/api/v1/companions' });
  return app;
}

describe('Companions Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanionRepo.create.mockReset();
    mockCompanionRepo.findById.mockReset();
    mockCompanionRepo.findByIdWithAvatar.mockReset();
    mockCompanionRepo.update.mockReset();
  });

  const baseCompanion = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    user_id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Mira',
    spec: {
      identity: {
        name: 'Mira',
        pronouns: 'she/her',
      },
      personality: {
        archetype: 'caregiver',
      },
      visual_style: {
        style_type: 'default',
      },
      boundaries: {
        content_rating: 'PG-13',
      },
    },
    spec_version: 1,
    is_public: false,
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-01-01T00:00:00.000Z'),
  } as const;

  describe('POST /api/v1/companions', () => {
    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/companions',
        payload: {
          name: 'Mira',
          personality: 'Warm and kind',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('creates companions with draft status', async () => {
      const draftCompanion = {
        ...baseCompanion,
        status: 'draft',
      } as const;
      mockCompanionRepo.create.mockResolvedValueOnce(draftCompanion);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/companions',
        headers: { authorization: 'Bearer token' },
        payload: {
          name: 'Mira',
          personality: 'Warm and kind',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('draft');
      expect(body.isActive).toBe(false);
      expect(mockCompanionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Mira',
          status: 'draft',
        })
      );
    });
  });

  describe('POST /api/v1/companions/:companionId/activate', () => {
    it('activates a draft companion', async () => {
      const draftCompanion = {
        ...baseCompanion,
        status: 'draft',
      } as const;
      const activatedCompanion = {
        ...baseCompanion,
        status: 'active',
      } as const;

      mockCompanionRepo.findById.mockResolvedValueOnce(draftCompanion);
      mockCompanionRepo.update.mockResolvedValueOnce(activatedCompanion);
      mockCompanionRepo.findByIdWithAvatar.mockResolvedValueOnce({
        ...activatedCompanion,
        activeAvatar: null,
      } as const);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/companions/${draftCompanion.id}/activate`,
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('active');
      expect(body.isActive).toBe(true);
      expect(mockCompanionRepo.update).toHaveBeenCalledWith(
        draftCompanion.id,
        { status: 'active' }
      );
    });

    it('denies activating another user companion', async () => {
      const foreignCompanion = {
        ...baseCompanion,
        user_id: '00000000-0000-4000-8000-000000000000',
        status: 'draft',
      } as const;
      mockCompanionRepo.findById.mockResolvedValueOnce(foreignCompanion);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/companions/${foreignCompanion.id}/activate`,
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(403);
      expect(mockCompanionRepo.update).not.toHaveBeenCalled();
    });
  });
});
