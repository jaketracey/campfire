/**
 * Memory CRUD Routes Tests
 * Tests for GET /memories, GET /memories/:id, PATCH /memories/:id,
 * DELETE /memories/:id, and POST /memories/search
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
    if (request.headers.authorization === 'Bearer other-user-token') {
      request.user = {
        userId: 'user-other',
        email: 'other@example.com',
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
  create: vi.fn(),
  update: vi.fn(),
  updateEmbedding: vi.fn(),
  delete: vi.fn(),
  softDelete: vi.fn(),
  list: vi.fn(),
  listByUser: vi.fn(),
  searchByVector: vi.fn(),
  searchByText: vi.fn(),
  recordAccessBatch: vi.fn(),
  getPinnedMemories: vi.fn(),
  pinMemory: vi.fn(),
  unpinMemory: vi.fn(),
  reorderPinnedMemories: vi.fn(),
  getPinnedCount: vi.fn(),
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
const mockEmbeddingService = {
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
};

vi.mock('../../src/services/embeddings.js', () => ({
  getEmbeddingService: () => mockEmbeddingService,
}));

// Mock observability
vi.mock('../../src/observability/tracing.js', () => ({
  withSpan: vi.fn((_name: string, fn: (span: { setAttributes: () => void }) => unknown) =>
    fn({ setAttributes: vi.fn() })
  ),
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

const createMockMemory = (overrides: Record<string, unknown> = {}) => ({
  id: mockMemoryId,
  user_id: mockUserId,
  companion_id: mockCompanionId,
  content: 'User loves hiking',
  content_type: 'fact' as const,
  importance: 0.8,
  status: 'active',
  embedding: null,
  source_event_id: null,
  source_turn_id: null,
  metadata: {},
  expires_at: null,
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  ...overrides,
});

const authHeaders = { authorization: 'Bearer valid-token' };
const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' };

describe('Memory CRUD Routes', () => {
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
  // GET /memories - List Memories
  // ===========================================================================

  describe('GET /memories', () => {
    it('should list memories for authenticated user', async () => {
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [createMockMemory(), createMockMemory({ id: 'mem-2', content: 'User likes coffee' })],
        total: 2,
        hasMore: false,
        limit: 50,
        offset: 0,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/memories',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(2);
      expect(body.data.pagination.total).toBe(2);
      expect(body.data.pagination.hasMore).toBe(false);
      expect(body.data.pagination.limit).toBe(50);
      expect(body.data.pagination.offset).toBe(0);
    });

    it('should pass companionId filter to repository', async () => {
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [],
        total: 0,
        hasMore: false,
      });

      await app.inject({
        method: 'GET',
        url: `/memories?companionId=${mockCompanionId}`,
        headers: authHeaders,
      });

      expect(mockMemoriesRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({ companionId: mockCompanionId })
      );
    });

    it('should pass contentType filter to repository', async () => {
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [],
        total: 0,
        hasMore: false,
      });

      await app.inject({
        method: 'GET',
        url: '/memories?contentType=preference',
        headers: authHeaders,
      });

      expect(mockMemoriesRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'preference' })
      );
    });

    it('should pass status filter to repository', async () => {
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [],
        total: 0,
        hasMore: false,
      });

      await app.inject({
        method: 'GET',
        url: '/memories?status=archived',
        headers: authHeaders,
      });

      expect(mockMemoriesRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'archived' })
      );
    });

    it('should pass minImportance filter to repository', async () => {
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [],
        total: 0,
        hasMore: false,
      });

      await app.inject({
        method: 'GET',
        url: '/memories?minImportance=0.7',
        headers: authHeaders,
      });

      expect(mockMemoriesRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({ minImportance: 0.7 })
      );
    });

    it('should pass tags filter to repository (comma-separated)', async () => {
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [],
        total: 0,
        hasMore: false,
      });

      await app.inject({
        method: 'GET',
        url: '/memories?tags=hobby,food',
        headers: authHeaders,
      });

      expect(mockMemoriesRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['hobby', 'food'] })
      );
    });

    it('should handle pagination parameters', async () => {
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [createMockMemory()],
        total: 100,
        hasMore: true,
        limit: 10,
        offset: 20,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/memories?limit=10&offset=20',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.pagination.limit).toBe(10);
      expect(body.data.pagination.offset).toBe(20);
      expect(body.data.pagination.total).toBe(100);
      expect(body.data.pagination.hasMore).toBe(true);

      expect(mockMemoriesRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 })
      );
    });

    it('should clamp limit to 100 maximum', async () => {
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [],
        total: 0,
        hasMore: false,
      });

      await app.inject({
        method: 'GET',
        url: '/memories?limit=500',
        headers: authHeaders,
      });

      expect(mockMemoriesRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
    });

    it('should clamp limit to 1 minimum', async () => {
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [],
        total: 0,
        hasMore: false,
      });

      await app.inject({
        method: 'GET',
        url: '/memories?limit=0',
        headers: authHeaders,
      });

      expect(mockMemoriesRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 })
      );
    });

    it('should return 400 for invalid contentType', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories?contentType=invalid',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories?status=deleted',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid minImportance', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories?minImportance=abc',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for minImportance > 1', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories?minImportance=1.5',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return correct response shape for memory items', async () => {
      const memory = createMockMemory({ expires_at: new Date('2026-01-01') });
      mockMemoriesRepo.listByUser.mockResolvedValue({
        data: [memory],
        total: 1,
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/memories',
        headers: authHeaders,
      });

      const body = JSON.parse(response.body);
      const item = body.data.items[0];
      expect(item).toEqual({
        id: mockMemoryId,
        companionId: mockCompanionId,
        content: 'User loves hiking',
        contentType: 'fact',
        importance: 0.8,
        metadata: {},
        expiresAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
    });
  });

  // ===========================================================================
  // GET /memories/:memoryId - Get Memory
  // ===========================================================================

  describe('GET /memories/:memoryId', () => {
    it('should return a memory by ID', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());

      const response = await app.inject({
        method: 'GET',
        url: `/memories/${mockMemoryId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(mockMemoryId);
      expect(body.data.content).toBe('User loves hiking');
      expect(body.data.contentType).toBe('fact');
      expect(body.data.importance).toBe(0.8);
      expect(body.data.companionId).toBe(mockCompanionId);
    });

    it('should return 404 when memory not found', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/memories/${mockMemoryId}`,
        headers: authHeaders,
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
        method: 'GET',
        url: `/memories/${mockMemoryId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/memories/${mockMemoryId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should include all fields in response', async () => {
      const memory = createMockMemory({
        source_event_id: 'event-1',
        source_turn_id: 'turn-1',
        expires_at: new Date('2026-12-31'),
        metadata: { source: 'conversation' },
      });
      mockMemoriesRepo.findById.mockResolvedValue(memory);

      const response = await app.inject({
        method: 'GET',
        url: `/memories/${mockMemoryId}`,
        headers: authHeaders,
      });

      const body = JSON.parse(response.body);
      expect(body.data.sourceEventId).toBe('event-1');
      expect(body.data.sourceTurnId).toBe('turn-1');
      expect(body.data.expiresAt).toBe('2026-12-31T00:00:00.000Z');
      expect(body.data.metadata).toEqual({ source: 'conversation' });
    });
  });

  // ===========================================================================
  // PATCH /memories/:memoryId - Update Memory
  // ===========================================================================

  describe('PATCH /memories/:memoryId', () => {
    it('should update memory content', async () => {
      const existing = createMockMemory();
      const updated = createMockMemory({
        content: 'User loves mountain hiking',
        updated_at: new Date('2025-02-01'),
      });
      mockMemoriesRepo.findById.mockResolvedValue(existing);
      mockMemoriesRepo.update.mockResolvedValue(updated);
      mockMemoriesRepo.updateEmbedding.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ content: 'User loves mountain hiking' }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.content).toBe('User loves mountain hiking');
    });

    it('should re-generate embedding when content changes', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepo.update.mockResolvedValue(
        createMockMemory({ content: 'Updated content' })
      );
      mockMemoriesRepo.updateEmbedding.mockResolvedValue(undefined);

      await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ content: 'Updated content' }),
      });

      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('Updated content');
      expect(mockMemoriesRepo.updateEmbedding).toHaveBeenCalledWith(
        mockMemoryId,
        expect.any(Array)
      );
    });

    it('should not re-generate embedding when only importance changes', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepo.update.mockResolvedValue(
        createMockMemory({ importance: 0.9 })
      );

      await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ importance: 0.9 }),
      });

      expect(mockEmbeddingService.generateEmbedding).not.toHaveBeenCalled();
      expect(mockMemoriesRepo.updateEmbedding).not.toHaveBeenCalled();
    });

    it('should update importance', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepo.update.mockResolvedValue(
        createMockMemory({ importance: 0.95 })
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ importance: 0.95 }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.importance).toBe(0.95);
    });

    it('should update contentType', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepo.update.mockResolvedValue(
        createMockMemory({ content_type: 'preference' })
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ contentType: 'preference' }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.contentType).toBe('preference');
    });

    it('should update metadata', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepo.update.mockResolvedValue(
        createMockMemory({ metadata: { source: 'manual' } })
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ metadata: { source: 'manual' } }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.metadata).toEqual({ source: 'manual' });
    });

    it('should emit memory.updated event', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepo.update.mockResolvedValue(createMockMemory({ importance: 0.9 }));

      await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ importance: 0.9 }),
      });

      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory.updated',
          payload: expect.objectContaining({
            memoryId: mockMemoryId,
            fields: ['importance'],
          }),
        })
      );
    });

    it('should return 404 when memory not found', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ content: 'Updated' }),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 when memory belongs to another user', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(
        createMockMemory({ user_id: 'different-user' })
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ content: 'Updated' }),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for empty update body', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid importance value', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ importance: 2.0 }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for invalid contentType', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ contentType: 'invalid' }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for content exceeding max length', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: jsonHeaders,
        payload: JSON.stringify({ content: 'x'.repeat(10001) }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/${mockMemoryId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ content: 'Updated' }),
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ===========================================================================
  // DELETE /memories/:memoryId - Soft Delete Memory
  // ===========================================================================

  describe('DELETE /memories/:memoryId', () => {
    it('should soft-delete a memory', async () => {
      const deleted = createMockMemory({
        status: 'deleted',
        updated_at: new Date('2025-02-01'),
      });
      mockMemoriesRepo.softDelete.mockResolvedValue(deleted);

      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(mockMemoryId);
      expect(body.data.status).toBe('deleted');
    });

    it('should call softDelete with userId for ownership verification', async () => {
      mockMemoriesRepo.softDelete.mockResolvedValue(createMockMemory({ status: 'deleted' }));

      await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}`,
        headers: authHeaders,
      });

      expect(mockMemoriesRepo.softDelete).toHaveBeenCalledWith(mockMemoryId, mockUserId);
    });

    it('should emit memory.deleted event', async () => {
      mockMemoriesRepo.softDelete.mockResolvedValue(
        createMockMemory({ status: 'deleted' })
      );

      await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}`,
        headers: authHeaders,
      });

      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory.deleted',
          payload: expect.objectContaining({
            memoryId: mockMemoryId,
          }),
        })
      );
    });

    it('should return 404 when memory not found', async () => {
      mockMemoriesRepo.softDelete.mockResolvedValue(null);

      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 when memory belongs to another user (softDelete returns null)', async () => {
      mockMemoriesRepo.softDelete.mockResolvedValue(null);

      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}`,
        headers: { authorization: 'Bearer other-user-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should not emit event when memory not found', async () => {
      mockMemoriesRepo.softDelete.mockResolvedValue(null);

      await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}`,
        headers: authHeaders,
      });

      expect(mockEventStore.append).not.toHaveBeenCalled();
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/${mockMemoryId}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ===========================================================================
  // POST /memories/search - Search Memories
  // ===========================================================================

  describe('POST /memories/search', () => {
    it('should search memories using vector search', async () => {
      const memories = [
        { ...createMockMemory({ id: 'mem-1', content: 'Loves hiking' }), similarity: 0.9 },
        { ...createMockMemory({ id: 'mem-2', content: 'Enjoys nature' }), similarity: 0.8 },
      ];
      mockMemoriesRepo.searchByVector.mockResolvedValue(memories);
      mockMemoriesRepo.recordAccessBatch.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'outdoor activities',
          companionId: mockCompanionId,
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(2);
      expect(body.data.items[0].similarity).toBe(0.9);
      expect(body.data.query).toBe('outdoor activities');
    });

    it('should generate embedding for the search query', async () => {
      mockMemoriesRepo.searchByVector.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'test query',
          companionId: mockCompanionId,
        }),
      });

      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('test query');
    });

    it('should fall back to text search when embedding fails', async () => {
      mockEmbeddingService.generateEmbedding.mockRejectedValueOnce(
        new Error('Embedding service unavailable')
      );
      const textResults = [createMockMemory({ id: 'mem-text' })];
      mockMemoriesRepo.searchByText.mockResolvedValue(textResults);
      mockMemoriesRepo.recordAccessBatch.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'test query',
          companionId: mockCompanionId,
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].similarity).toBe(0.5);
    });

    it('should pass contentType filter', async () => {
      mockMemoriesRepo.searchByVector.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'test',
          companionId: mockCompanionId,
          contentType: 'fact',
        }),
      });

      expect(mockMemoriesRepo.searchByVector).toHaveBeenCalledWith(
        expect.objectContaining({ contentTypes: ['fact'] })
      );
    });

    it('should pass minImportance filter', async () => {
      mockMemoriesRepo.searchByVector.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'test',
          companionId: mockCompanionId,
          minImportance: 0.8,
        }),
      });

      expect(mockMemoriesRepo.searchByVector).toHaveBeenCalledWith(
        expect.objectContaining({ minImportance: 0.8 })
      );
    });

    it('should pass limit parameter', async () => {
      mockMemoriesRepo.searchByVector.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'test',
          companionId: mockCompanionId,
          limit: 5,
        }),
      });

      expect(mockMemoriesRepo.searchByVector).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5 })
      );
    });

    it('should record access for returned memories', async () => {
      const memories = [
        { ...createMockMemory({ id: 'mem-1' }), similarity: 0.9 },
        { ...createMockMemory({ id: 'mem-2' }), similarity: 0.8 },
      ];
      mockMemoriesRepo.searchByVector.mockResolvedValue(memories);
      mockMemoriesRepo.recordAccessBatch.mockResolvedValue(undefined);

      await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'test',
          companionId: mockCompanionId,
        }),
      });

      expect(mockMemoriesRepo.recordAccessBatch).toHaveBeenCalledWith(['mem-1', 'mem-2']);
    });

    it('should not record access when no results', async () => {
      mockMemoriesRepo.searchByVector.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'test',
          companionId: mockCompanionId,
        }),
      });

      expect(mockMemoriesRepo.recordAccessBatch).not.toHaveBeenCalled();
    });

    it('should return 400 when companionId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({ query: 'test' }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for empty query', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: '',
          companionId: mockCompanionId,
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for query exceeding max length', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'x'.repeat(1001),
          companionId: mockCompanionId,
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for invalid companionId format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: jsonHeaders,
        payload: JSON.stringify({
          query: 'test',
          companionId: 'not-a-uuid',
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories/search',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          query: 'test',
          companionId: mockCompanionId,
        }),
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ===========================================================================
  // POST /memories - Create Memory
  // ===========================================================================

  describe('POST /memories', () => {
    it('should create a memory with embedding', async () => {
      const created = createMockMemory();
      mockMemoriesRepo.create.mockResolvedValue(created);

      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: jsonHeaders,
        payload: JSON.stringify({
          companionId: mockCompanionId,
          content: 'User loves hiking',
          contentType: 'fact',
          importance: 0.8,
        }),
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(mockMemoryId);
      expect(body.data.content).toBe('User loves hiking');
    });

    it('should generate embedding when creating', async () => {
      mockMemoriesRepo.create.mockResolvedValue(createMockMemory());

      await app.inject({
        method: 'POST',
        url: '/memories',
        headers: jsonHeaders,
        payload: JSON.stringify({
          companionId: mockCompanionId,
          content: 'User loves hiking',
        }),
      });

      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('User loves hiking');
      expect(mockMemoriesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          embedding: expect.any(Array),
        })
      );
    });

    it('should still create memory when embedding fails', async () => {
      mockEmbeddingService.generateEmbedding.mockRejectedValueOnce(new Error('fail'));
      mockMemoriesRepo.create.mockResolvedValue(createMockMemory());

      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: jsonHeaders,
        payload: JSON.stringify({
          companionId: mockCompanionId,
          content: 'User loves hiking',
        }),
      });

      expect(response.statusCode).toBe(201);
      expect(mockMemoriesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          embedding: undefined,
        })
      );
    });

    it('should emit memory.created event', async () => {
      mockMemoriesRepo.create.mockResolvedValue(createMockMemory());

      await app.inject({
        method: 'POST',
        url: '/memories',
        headers: jsonHeaders,
        payload: JSON.stringify({
          companionId: mockCompanionId,
          content: 'Test memory',
        }),
      });

      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory.created',
          payload: expect.objectContaining({
            memoryId: mockMemoryId,
            companionId: mockCompanionId,
          }),
        })
      );
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: jsonHeaders,
        payload: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for invalid companionId format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: jsonHeaders,
        payload: JSON.stringify({
          companionId: 'not-a-uuid',
          content: 'Test',
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for empty content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: jsonHeaders,
        payload: JSON.stringify({
          companionId: mockCompanionId,
          content: '',
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          companionId: mockCompanionId,
          content: 'Test memory',
        }),
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ===========================================================================
  // Authentication Tests (across all endpoints)
  // ===========================================================================

  describe('Authentication', () => {
    it('should require authentication for all CRUD endpoints', async () => {
      const endpoints = [
        { method: 'GET' as const, url: '/memories' },
        { method: 'GET' as const, url: `/memories/${mockMemoryId}` },
        { method: 'PATCH' as const, url: `/memories/${mockMemoryId}` },
        { method: 'DELETE' as const, url: `/memories/${mockMemoryId}` },
        { method: 'POST' as const, url: '/memories/search' },
        { method: 'POST' as const, url: '/memories' },
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
