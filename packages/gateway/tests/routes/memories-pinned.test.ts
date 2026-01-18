/**
 * Pinned Memories Routes Integration Tests
 * Tests for pinned memory API endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { memoriesRoutes } from '../../src/routes/memories.js';

// Mock the auth middleware
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn(async (request, reply) => {
    if (request.headers.authorization === 'Bearer valid-token') {
      request.user = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };
      return;
    }
    return reply.status(401).send({ error: 'Unauthorized' });
  }),
  requireInternalService: vi.fn(async (request, reply) => {
    if (request.headers['x-internal-service-key'] === 'test-key') {
      return;
    }
    return reply.status(401).send({ error: 'Unauthorized' });
  }),
}));

// Mock the memories repository
const mockMemoriesRepo = {
  findById: vi.fn(),
  getPinnedMemories: vi.fn(),
  pinMemory: vi.fn(),
  unpinMemory: vi.fn(),
  reorderPinnedMemories: vi.fn(),
  getPinnedCount: vi.fn(),
  create: vi.fn(),
  searchByVector: vi.fn(),
  searchByText: vi.fn(),
  recordAccessBatch: vi.fn(),
};

vi.mock('../../src/repositories/memories.js', () => ({
  getMemoriesRepository: () => mockMemoriesRepo,
}));

// Mock the event store
const mockEventStore = {
  append: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/db/event-store.js', () => ({
  getEventStore: () => mockEventStore,
}));

// Mock the embedding service
vi.mock('../../src/services/embeddings.js', () => ({
  getEmbeddingService: () => ({
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
  }),
}));

// Mock observability
vi.mock('../../src/observability/tracing.js', () => ({
  withSpan: vi.fn((name, fn) => fn({ setAttributes: vi.fn() })),
}));

vi.mock('../../src/observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Test fixtures
const mockUserId = 'user-123';
const mockCompanionId = '550e8400-e29b-41d4-a716-446655440001';
const mockMemoryId = '550e8400-e29b-41d4-a716-446655440002';

const createMockMemory = (overrides = {}) => ({
  id: mockMemoryId,
  user_id: mockUserId,
  companion_id: mockCompanionId,
  content: 'User loves hiking',
  content_type: 'fact',
  importance: 0.8,
  status: 'active',
  is_pinned: false,
  pin_order: null,
  pinned_at: null,
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  metadata: {},
  ...overrides,
});

const createMockPinnedMemory = (overrides = {}) => ({
  ...createMockMemory(),
  is_pinned: true,
  pin_order: 1,
  pinned_at: new Date('2025-01-05'),
  ...overrides,
});

describe('Pinned Memories Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify();
    await app.register(memoriesRoutes, { prefix: '/memories' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ===========================================================================
  // GET /memories/pinned/:companionId
  // ===========================================================================

  describe('GET /memories/pinned/:companionId', () => {
    it('should return pinned memories for a companion', async () => {
      const pinnedMemories = [
        createMockPinnedMemory({ id: 'mem-1', content: 'Fact 1', pin_order: 1 }),
        createMockPinnedMemory({ id: 'mem-2', content: 'Fact 2', pin_order: 2 }),
      ];
      mockMemoriesRepo.getPinnedMemories.mockResolvedValue(pinnedMemories);

      const response = await app.inject({
        method: 'GET',
        url: `/memories/pinned/${mockCompanionId}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(2);
      expect(body.data.maxAllowed).toBe(10);
    });

    it('should return empty array when no pinned memories', async () => {
      mockMemoriesRepo.getPinnedMemories.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: `/memories/pinned/${mockCompanionId}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(0);
      expect(body.data.count).toBe(0);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/memories/pinned/${mockCompanionId}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ===========================================================================
  // POST /memories/:memoryId/pin
  // ===========================================================================

  describe('POST /memories/:memoryId/pin', () => {
    it('should pin a memory successfully', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepo.getPinnedCount.mockResolvedValue(5);
      mockMemoriesRepo.pinMemory.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: `/memories/${mockMemoryId}/pin`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.isPinned).toBe(true);
      expect(body.data.pinnedCount).toBe(6);
      expect(body.data.maxAllowed).toBe(10);
    });

    it('should return 404 when memory not found', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: `/memories/${mockMemoryId}/pin`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 when memory belongs to another user', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(
        createMockMemory({ user_id: 'different-user' })
      );

      const response = await app.inject({
        method: 'POST',
        url: `/memories/${mockMemoryId}/pin`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 when limit is reached', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepo.getPinnedCount.mockResolvedValue(10);

      const response = await app.inject({
        method: 'POST',
        url: `/memories/${mockMemoryId}/pin`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('LIMIT_EXCEEDED');
    });

    it('should emit memory.pinned event on success', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepo.getPinnedCount.mockResolvedValue(5);
      mockMemoriesRepo.pinMemory.mockResolvedValue(true);

      await app.inject({
        method: 'POST',
        url: `/memories/${mockMemoryId}/pin`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory.pinned',
          payload: expect.objectContaining({
            memoryId: mockMemoryId,
          }),
        })
      );
    });
  });

  // ===========================================================================
  // DELETE /memories/:memoryId/pin
  // ===========================================================================

  describe('DELETE /memories/:memoryId/pin', () => {
    it('should unpin a memory successfully', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockPinnedMemory());
      mockMemoriesRepo.unpinMemory.mockResolvedValue(undefined);
      mockMemoriesRepo.getPinnedCount.mockResolvedValue(4);

      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}/pin`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.isPinned).toBe(false);
      expect(body.data.pinnedCount).toBe(4);
    });

    it('should return 404 when memory not found', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}/pin`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should emit memory.unpinned event on success', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockPinnedMemory());
      mockMemoriesRepo.unpinMemory.mockResolvedValue(undefined);
      mockMemoriesRepo.getPinnedCount.mockResolvedValue(4);

      await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}/pin`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory.unpinned',
          payload: expect.objectContaining({
            memoryId: mockMemoryId,
          }),
        })
      );
    });
  });

  // ===========================================================================
  // PUT /memories/pinned/:companionId/reorder
  // ===========================================================================

  describe('PUT /memories/pinned/:companionId/reorder', () => {
    it('should reorder pinned memories successfully', async () => {
      mockMemoriesRepo.reorderPinnedMemories.mockResolvedValue(undefined);

      const memoryIds = [
        '550e8400-e29b-41d4-a716-446655440010',
        '550e8400-e29b-41d4-a716-446655440011',
        '550e8400-e29b-41d4-a716-446655440012',
      ];
      const response = await app.inject({
        method: 'PUT',
        url: `/memories/pinned/${mockCompanionId}/reorder`,
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ memoryIds }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.memoryIds).toEqual(memoryIds);
    });

    it('should return 400 for invalid request body', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/memories/pinned/${mockCompanionId}/reorder`,
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ memoryIds: [] }), // Empty array
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for non-UUID memory IDs', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/memories/pinned/${mockCompanionId}/reorder`,
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ memoryIds: ['invalid-id'] }),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // GET /memories/pinned/:companionId/count
  // ===========================================================================

  describe('GET /memories/pinned/:companionId/count', () => {
    it('should return pinned memory count', async () => {
      mockMemoriesRepo.getPinnedCount.mockResolvedValue(7);

      const response = await app.inject({
        method: 'GET',
        url: `/memories/pinned/${mockCompanionId}/count`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.count).toBe(7);
      expect(body.data.maxAllowed).toBe(10);
      expect(body.data.remaining).toBe(3);
    });

    it('should return 0 when no pinned memories', async () => {
      mockMemoriesRepo.getPinnedCount.mockResolvedValue(0);

      const response = await app.inject({
        method: 'GET',
        url: `/memories/pinned/${mockCompanionId}/count`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.count).toBe(0);
      expect(body.data.remaining).toBe(10);
    });

    it('should return 0 remaining when at limit', async () => {
      mockMemoriesRepo.getPinnedCount.mockResolvedValue(10);

      const response = await app.inject({
        method: 'GET',
        url: `/memories/pinned/${mockCompanionId}/count`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.count).toBe(10);
      expect(body.data.remaining).toBe(0);
    });
  });

  // ===========================================================================
  // Authentication Tests
  // ===========================================================================

  describe('Authentication', () => {
    it('should require authentication for all pinned memory endpoints', async () => {
      const endpoints = [
        { method: 'GET' as const, url: `/memories/pinned/${mockCompanionId}` },
        { method: 'POST' as const, url: `/memories/${mockMemoryId}/pin` },
        { method: 'DELETE' as const, url: `/memories/${mockMemoryId}/pin` },
        { method: 'PUT' as const, url: `/memories/pinned/${mockCompanionId}/reorder` },
        { method: 'GET' as const, url: `/memories/pinned/${mockCompanionId}/count` },
      ];

      for (const endpoint of endpoints) {
        const response = await app.inject({
          method: endpoint.method,
          url: endpoint.url,
        });

        expect(response.statusCode).toBe(401);
      }
    });
  });
});
