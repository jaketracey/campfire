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
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

vi.mock('../../db/index.js', () => ({
  db: { sql: vi.fn() },
}));

describe('preset routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    const { presetRoutes } = await import('../presets.js');
    await app.register(presetRoutes, { prefix: '/api/v1/companions' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // GET /companions/presets
  // -----------------------------------------------------------------------
  describe('GET /companions/presets', () => {
    it('returns all 12 presets without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/companions/presets',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.presets).toHaveLength(12);
      expect(body.presets[0]).toHaveProperty('archetype');
      expect(body.presets[0]).toHaveProperty('displayName');
      expect(body.presets[0]).toHaveProperty('tagline');
      expect(body.presets[0]).toHaveProperty('personalitySliders');
      expect(body.presets[0]).toHaveProperty('firstMessages');
      expect(body.presets[0]).toHaveProperty('traitKeywords');
    });
  });

  // -----------------------------------------------------------------------
  // GET /companions/presets/:archetype
  // -----------------------------------------------------------------------
  describe('GET /companions/presets/:archetype', () => {
    it('returns a specific preset', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/companions/presets/jester',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.archetype).toBe('jester');
      expect(body.displayName).toBe('The Jester');
    });

    it('returns 404 for unknown archetype', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/companions/presets/unknown',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST /companions/from-preset
  // -----------------------------------------------------------------------
  describe('POST /companions/from-preset', () => {
    it('requires auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/companions/from-preset',
        payload: { name: 'Luna', gender: 'female', archetype: 'lover' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('creates companion from preset with defaults', async () => {
      const mockCompanion = {
        id: 'comp-123',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Luna',
        spec: {
          identity: { name: 'Luna', pronouns: 'she/her', address_style: 'friendly' },
          personality: { archetype: 'lover', traits: {} },
          voice: { provider: 'elevenlabs', voice_id: '21m00Tcm4TlvDq8ikWAM' },
          visual_style: { style_type: 'realistic' },
          boundaries: { relationship_pacing: 'moderate', content_rating: 'PG-13' },
          memory_consent: { allow_long_term: true, allow_kg_extraction: true },
        },
        spec_version: 1,
        status: 'active',
        is_public: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockCompanionRepo.create.mockResolvedValueOnce(mockCompanion);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/companions/from-preset',
        headers: { authorization: 'Bearer test-token' },
        payload: { name: 'Luna', gender: 'female', archetype: 'lover' },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBe('comp-123');
      expect(body.name).toBe('Luna');
      expect(body.firstMessage).toBeTruthy();
      expect(typeof body.firstMessage).toBe('string');
    });

    it('creates companion with customizations', async () => {
      const mockCompanion = {
        id: 'comp-456',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Marcus',
        spec: {} as any,
        spec_version: 1,
        status: 'active',
        is_public: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockCompanionRepo.create.mockResolvedValueOnce(mockCompanion);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/companions/from-preset',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          name: 'Marcus',
          gender: 'male',
          archetype: 'rebel',
          customizations: {
            personalitySliders: { warmth: 70, humor: 80 },
            contentRating: 'R',
          },
        },
      });

      expect(res.statusCode).toBe(201);

      // Verify the spec built from preset includes overrides
      const createCall = mockCompanionRepo.create.mock.calls[0][0];
      expect(createCall.spec.personality.archetype).toBe('rebel');
      // Custom slider values should be merged
      expect(createCall.spec.personality.traits.warmth).toBe(70);
      expect(createCall.spec.personality.traits.humor).toBe(80);
      // Non-overridden values come from the rebel preset
      expect(createCall.spec.personality.traits.directness).toBe(95);
      expect(createCall.spec.boundaries.content_rating).toBe('R');
    });

    it('rejects unknown archetype', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/companions/from-preset',
        headers: { authorization: 'Bearer test-token' },
        payload: { name: 'Test', gender: 'female', archetype: 'unknown_archetype' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('Unknown archetype');
    });

    it('rejects missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/companions/from-preset',
        headers: { authorization: 'Bearer test-token' },
        payload: { name: 'Test' }, // missing gender and archetype
      });

      expect(res.statusCode).toBe(400);
    });

    it('sets correct pronouns and voice for male gender', async () => {
      const mockCompanion = {
        id: 'comp-789',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Kai',
        spec: {} as any,
        spec_version: 1,
        status: 'active',
        is_public: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockCompanionRepo.create.mockResolvedValueOnce(mockCompanion);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/companions/from-preset',
        headers: { authorization: 'Bearer test-token' },
        payload: { name: 'Kai', gender: 'male', archetype: 'sage' },
      });

      expect(res.statusCode).toBe(201);

      const createCall = mockCompanionRepo.create.mock.calls[0][0];
      expect(createCall.spec.identity.pronouns).toBe('he/him');
      expect(createCall.spec.visual_style.appearance.gender).toBe('male');
      // Sage masculine voice
      expect(createCall.spec.voice.voice_id).toBeTruthy();
    });

    it('includes core tenets from preset', async () => {
      const mockCompanion = {
        id: 'comp-ten',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Rose',
        spec: {} as any,
        spec_version: 1,
        status: 'active',
        is_public: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockCompanionRepo.create.mockResolvedValueOnce(mockCompanion);

      await app.inject({
        method: 'POST',
        url: '/api/v1/companions/from-preset',
        headers: { authorization: 'Bearer test-token' },
        payload: { name: 'Rose', gender: 'female', archetype: 'caregiver' },
      });

      const createCall = mockCompanionRepo.create.mock.calls[0][0];
      expect(createCall.spec.tenets).toBeDefined();
      expect(createCall.spec.tenets.length).toBeGreaterThanOrEqual(3);
      expect(createCall.spec.tenets[0].priority).toBe('core');
    });
  });
});
