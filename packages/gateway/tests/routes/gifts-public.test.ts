import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { giftsRoutes } from '../../src/routes/gifts.js';

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn(async (request, reply) => {
    if (request.headers.authorization === 'Bearer valid-token') {
      request.user = {
        userId: '11111111-1111-1111-1111-111111111111',
        email: 'user@example.com',
        role: 'user',
      };
      return;
    }
    return reply.status(401).send({ error: 'Unauthorized' });
  }),
  requireInternalService: vi.fn(async (_request, reply) => {
    return reply.status(401).send({ error: 'Unauthorized' });
  }),
}));

vi.mock('../../src/observability/tracing.js', () => ({
  withSpan: vi.fn((_, fn) => fn({ setAttributes: vi.fn() })),
}));

vi.mock('../../src/observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/queue.js', () => ({
  enqueueGiftGenerationJob: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/utils/flowguard.js', () => ({
  isFlowguardConfigured: vi.fn().mockReturnValue(false),
  startPurchaseSession: vi.fn(),
  verifyPostbackSignature: vi.fn(),
  parsePostback: vi.fn(),
}));

const mockEventStore = { append: vi.fn() };
vi.mock('../../src/db/event-store.js', () => ({
  getEventStore: () => mockEventStore,
}));

const mockGiftsRepo = {
  createGift: vi.fn(),
  setGiftImage: vi.fn(),
  deductTokens: vi.fn(),
  markGiftGiven: vi.fn(),
  createGiftMemory: vi.fn(),
};

const mockTemplatesRepo = {
  findById: vi.fn(),
  incrementPopularity: vi.fn(),
};

const mockCompanionsRepo = {
  findById: vi.fn(),
};

const mockBillingRepo = {};

vi.mock('../../src/repositories/gifts.js', () => ({
  getGiftsRepository: () => mockGiftsRepo,
}));
vi.mock('../../src/repositories/gift-templates.js', () => ({
  getGiftTemplatesRepository: () => mockTemplatesRepo,
}));
vi.mock('../../src/repositories/companions.js', () => ({
  getCompanionsRepository: () => mockCompanionsRepo,
}));
vi.mock('../../src/repositories/billing.js', () => ({
  getBillingRepository: () => mockBillingRepo,
}));

const mockCreatorEarningsService = {
  recordTokenSpend: vi.fn(),
};
vi.mock('../../src/services/creator-earnings.js', () => ({
  getCreatorEarningsService: () => mockCreatorEarningsService,
}));

describe('Gifts Routes (public companions)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(giftsRoutes, { prefix: '/gifts' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows spending tokens on a public companion via template gifts and records earnings', async () => {
    const templateId = '22222222-2222-2222-2222-222222222222';
    const companionId = '33333333-3333-3333-3333-333333333333';
    const creatorUserId = '44444444-4444-4444-4444-444444444444';
    const txId = '55555555-5555-5555-5555-555555555555';

    mockTemplatesRepo.findById.mockResolvedValue({
      id: templateId,
      name: 'Roses',
      description: 'A bouquet',
      emotional_meaning: 'Affection',
      image_url: 'https://cdn.example/roses.png',
      s3_bucket: 'b',
      s3_key: 'k',
      visual_prompt: 'roses',
      token_cost: 25,
      status: 'active',
      tier: 'medium',
      category: 'romantic',
      total_sends: 0,
      sends_last_7_days: 0,
      created_at: new Date(),
    });

    mockCompanionsRepo.findById.mockResolvedValue({
      id: companionId,
      user_id: creatorUserId,
      name: 'CreatorCompanion',
      is_public: true,
      status: 'active',
      spec: { identity: { name: 'CreatorCompanion' } },
    });

    mockGiftsRepo.createGift.mockResolvedValue({
      id: '66666666-6666-6666-6666-666666666666',
      token_cost: 25,
    });
    mockGiftsRepo.setGiftImage.mockResolvedValue(undefined);
    mockGiftsRepo.deductTokens.mockResolvedValue({
      success: true,
      transactionId: txId,
      newBalance: 100,
      errorMessage: null,
    });
    mockGiftsRepo.markGiftGiven.mockResolvedValue({
      id: '66666666-6666-6666-6666-666666666666',
      name: 'Roses',
      status: 'given',
      given_at: new Date(),
    });
    mockTemplatesRepo.incrementPopularity.mockResolvedValue(undefined);
    mockGiftsRepo.createGiftMemory.mockResolvedValue({
      id: '77777777-7777-7777-7777-777777777777',
      memory_content: 'memory',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/gifts/from-template',
      headers: { authorization: 'Bearer valid-token' },
      payload: { templateId, companionId },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCreatorEarningsService.recordTokenSpend).toHaveBeenCalledTimes(1);
    expect(mockCreatorEarningsService.recordTokenSpend).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenTransactionId: txId,
        spenderUserId: '11111111-1111-1111-1111-111111111111',
        creatorUserId,
        companionId,
        feature: 'gift',
        tokensSpent: 25,
      })
    );
  });

  it('rejects spending tokens on a non-public companion not owned by the user', async () => {
    const templateId = '22222222-2222-2222-2222-222222222222';
    const companionId = '33333333-3333-3333-3333-333333333333';

    mockTemplatesRepo.findById.mockResolvedValue({
      id: templateId,
      name: 'Roses',
      image_url: 'https://cdn.example/roses.png',
      visual_prompt: 'roses',
      token_cost: 25,
      status: 'active',
      tier: 'medium',
      category: 'romantic',
      total_sends: 0,
      sends_last_7_days: 0,
      created_at: new Date(),
    });

    mockCompanionsRepo.findById.mockResolvedValue({
      id: companionId,
      user_id: '44444444-4444-4444-4444-444444444444',
      name: 'PrivateCompanion',
      is_public: false,
      status: 'active',
      spec: { identity: { name: 'PrivateCompanion' } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/gifts/from-template',
      headers: { authorization: 'Bearer valid-token' },
      payload: { templateId, companionId },
    });

    expect(res.statusCode).toBe(404);
    expect(mockCreatorEarningsService.recordTokenSpend).not.toHaveBeenCalled();
  });
});

