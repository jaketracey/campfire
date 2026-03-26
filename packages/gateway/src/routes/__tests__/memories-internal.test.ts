import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const {
  mockMemoriesRepo,
  mockEventStore,
  mockEmbeddingService,
} = vi.hoisted(() => ({
  mockMemoriesRepo: {
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateEmbedding: vi.fn(),
    delete: vi.fn(),
    searchByVector: vi.fn(),
    searchByText: vi.fn(),
    recordAccessBatch: vi.fn(),
  },
  mockEventStore: {
    append: vi.fn(),
  },
  mockEmbeddingService: {
    generateEmbedding: vi.fn(),
  },
}));

vi.mock('../../repositories/memories.js', () => ({
  getMemoriesRepository: () => mockMemoriesRepo,
}));

vi.mock('../../db/event-store.js', () => ({
  getEventStore: () => mockEventStore,
}));

vi.mock('../../services/embeddings.js', () => ({
  getEmbeddingService: () => mockEmbeddingService,
}));

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: async () => {},
  requireInternalService: async () => {},
}));

vi.mock('../../observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../observability/tracing.js', () => ({
  withSpan: async (_name: string, fn: (span: any) => Promise<any>) => {
    const mockSpan = { setAttributes: vi.fn() };
    return fn(mockSpan);
  },
}));

import { memoriesRoutes } from '../memories.js';

describe('Internal Memory Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(memoriesRoutes, { prefix: '/memories' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // PATCH /memories/internal/:memoryId
  // ========================================================================

  describe('PATCH /memories/internal/:memoryId', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const companionId = '00000000-0000-0000-0000-000000000002';
    const memoryId = '00000000-0000-0000-0000-000000000010';

    it('should update a memory successfully', async () => {
      mockMemoriesRepo.findById.mockResolvedValue({
        id: memoryId,
        user_id: userId,
        companion_id: companionId,
        content: 'old content',
        content_type: 'fact',
        importance: 0.5,
      });

      mockMemoriesRepo.update.mockResolvedValue({
        id: memoryId,
        user_id: userId,
        companion_id: companionId,
        content: 'new content',
        content_type: 'fact',
        importance: 0.8,
        updated_at: new Date(),
      });

      mockEmbeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      mockMemoriesRepo.updateEmbedding.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/internal/${memoryId}`,
        payload: {
          userId,
          companionId,
          content: 'new content',
          importance: 0.8,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.content).toBe('new content');
      expect(body.data.importance).toBe(0.8);
      expect(mockMemoriesRepo.update).toHaveBeenCalledWith(memoryId, {
        content: 'new content',
        importance: 0.8,
      });
      expect(mockMemoriesRepo.updateEmbedding).toHaveBeenCalledWith(
        memoryId,
        [0.1, 0.2, 0.3],
      );
      expect(mockEventStore.append).toHaveBeenCalled();
    });

    it('should return 404 if memory not found', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/internal/${memoryId}`,
        payload: {
          userId,
          companionId,
          content: 'new content',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 if memory belongs to different user', async () => {
      mockMemoriesRepo.findById.mockResolvedValue({
        id: memoryId,
        user_id: 'other-user-id',
        companion_id: companionId,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/internal/${memoryId}`,
        payload: {
          userId,
          companionId,
          content: 'new content',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid body', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/internal/${memoryId}`,
        payload: {
          userId: 'not-a-uuid',
          companionId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should not regenerate embedding if content not updated', async () => {
      mockMemoriesRepo.findById.mockResolvedValue({
        id: memoryId,
        user_id: userId,
        companion_id: companionId,
      });

      mockMemoriesRepo.update.mockResolvedValue({
        id: memoryId,
        user_id: userId,
        companion_id: companionId,
        content: 'old content',
        content_type: 'fact',
        importance: 0.9,
        updated_at: new Date(),
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/memories/internal/${memoryId}`,
        payload: {
          userId,
          companionId,
          importance: 0.9,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockEmbeddingService.generateEmbedding).not.toHaveBeenCalled();
      expect(mockMemoriesRepo.updateEmbedding).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // DELETE /memories/internal/:memoryId
  // ========================================================================

  describe('DELETE /memories/internal/:memoryId', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const companionId = '00000000-0000-0000-0000-000000000002';
    const memoryId = '00000000-0000-0000-0000-000000000010';

    it('should soft-delete a memory successfully', async () => {
      mockMemoriesRepo.findById.mockResolvedValue({
        id: memoryId,
        user_id: userId,
        companion_id: companionId,
      });

      mockMemoriesRepo.delete.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/internal/${memoryId}?userId=${userId}&companionId=${companionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(memoryId);
      expect(body.data.deleted).toBe(true);
      expect(mockMemoriesRepo.delete).toHaveBeenCalledWith(memoryId);
      expect(mockEventStore.append).toHaveBeenCalled();
    });

    it('should return 404 if memory not found', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/internal/${memoryId}?userId=${userId}&companionId=${companionId}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 if memory belongs to different user', async () => {
      mockMemoriesRepo.findById.mockResolvedValue({
        id: memoryId,
        user_id: 'other-user-id',
        companion_id: companionId,
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/internal/${memoryId}?userId=${userId}&companionId=${companionId}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 if userId or companionId missing', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/memories/internal/${memoryId}`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ========================================================================
  // POST /memories/internal/search - minSimilarity parameter
  // ========================================================================

  describe('POST /memories/internal/search with minSimilarity', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const companionId = '00000000-0000-0000-0000-000000000002';

    it('should pass minSimilarity to vector search', async () => {
      mockEmbeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2]);
      mockMemoriesRepo.searchByVector.mockResolvedValue([]);
      mockMemoriesRepo.recordAccessBatch.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/memories/internal/search',
        payload: {
          userId,
          companionId,
          query: 'test query',
          minSimilarity: 0.3,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockMemoriesRepo.searchByVector).toHaveBeenCalledWith(
        expect.objectContaining({
          minSimilarity: 0.3,
        }),
      );
    });

    it('should default minSimilarity to 0.5 when not provided', async () => {
      mockEmbeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2]);
      mockMemoriesRepo.searchByVector.mockResolvedValue([]);

      const response = await app.inject({
        method: 'POST',
        url: '/memories/internal/search',
        payload: {
          userId,
          companionId,
          query: 'test query',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockMemoriesRepo.searchByVector).toHaveBeenCalledWith(
        expect.objectContaining({
          minSimilarity: 0.5,
        }),
      );
    });
  });
});
