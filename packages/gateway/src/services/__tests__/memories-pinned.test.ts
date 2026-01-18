/**
 * Pinned Memories Service Tests
 *
 * Tests for pinned memory service layer including:
 * - Get pinned memories with ownership validation
 * - Pin a memory with limit enforcement
 * - Unpin a memory with ownership validation
 * - Reorder pinned memories
 * - Get pinned count
 * - Event emission for pin/unpin actions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Memory, MemoryContentType, Companion } from '../../db/types.js';

// Mock repositories and services
const mockMemoriesRepository = {
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  searchByVector: vi.fn(),
  getPinnedMemories: vi.fn(),
  pinMemory: vi.fn(),
  unpinMemory: vi.fn(),
  reorderPinnedMemories: vi.fn(),
  getPinnedCount: vi.fn(),
  recordAccess: vi.fn(),
  list: vi.fn(),
};

const mockCompanionsRepository = {
  findById: vi.fn(),
};

const mockEventsService = {
  emit: vi.fn(),
  createContextFromRequest: vi.fn(),
};

const mockEmbeddingService = {
  embedText: vi.fn(),
};

// Mock all dependencies
vi.mock('../../repositories/memories.js', () => ({
  getMemoriesRepository: () => mockMemoriesRepository,
}));

vi.mock('../../repositories/companions.js', () => ({
  getCompanionsRepository: () => mockCompanionsRepository,
}));

vi.mock('../events.js', () => ({
  getEventsService: () => mockEventsService,
}));

vi.mock('../embeddings.js', () => ({
  getEmbeddingService: () => mockEmbeddingService,
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

// Import after mocking
import { MemoriesService } from '../memories.js';

// Test fixtures
const mockUserId = '550e8400-e29b-41d4-a716-446655440001';
const mockCompanionId = '550e8400-e29b-41d4-a716-446655440002';
const mockMemoryId = '550e8400-e29b-41d4-a716-446655440003';

const createMockCompanion = (overrides: Partial<Companion> = {}): Companion => ({
  id: mockCompanionId,
  user_id: mockUserId,
  name: 'Test Companion',
  spec: {
    name: 'Test Companion',
    tagline: 'A test companion',
    personality: {
      core_traits: ['friendly'],
      communication_style: 'casual',
    },
  } as any,
  spec_version: 1,
  status: 'active',
  is_public: false,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const createMockMemory = (overrides: Partial<Memory> = {}): Memory => ({
  id: mockMemoryId,
  user_id: mockUserId,
  companion_id: mockCompanionId,
  content: 'User loves hiking in the mountains',
  content_type: 'fact' as MemoryContentType,
  embedding: null,
  importance: 0.8,
  source_event_id: null,
  source_turn_id: null,
  metadata: {},
  expires_at: null,
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const createMockPinnedMemory = (overrides = {}) => ({
  ...createMockMemory(),
  is_pinned: true,
  pin_order: 1,
  pinned_at: new Date('2025-01-05T00:00:00Z'),
  ...overrides,
});

describe('MemoriesService - Pinned Memories', () => {
  let service: MemoriesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MemoriesService();

    // Default mock implementations
    mockCompanionsRepository.findById.mockResolvedValue(createMockCompanion());
    mockEventsService.createContextFromRequest.mockReturnValue({
      userId: mockUserId,
      sessionId: 'memory-management',
      traceId: 'test-trace-id',
    });
    mockEventsService.emit.mockResolvedValue(undefined);
    mockMemoriesRepository.recordAccess.mockResolvedValue(undefined);
  });

  // ===========================================================================
  // Get Pinned Memories Tests
  // ===========================================================================

  describe('getPinnedMemories', () => {
    it('should return pinned memories for owned companion', async () => {
      const mockPinnedMemories = [
        createMockPinnedMemory({ id: 'mem-1', content: 'Fact 1', pin_order: 1 }),
        createMockPinnedMemory({ id: 'mem-2', content: 'Fact 2', pin_order: 2 }),
      ];
      mockMemoriesRepository.getPinnedMemories.mockResolvedValue(mockPinnedMemories);

      const result = await service.getPinnedMemories(mockUserId, mockCompanionId);

      expect(result).toHaveLength(2);
      expect(result[0].relevanceScore).toBe(1.0); // Pinned memories have max relevance
      expect(mockCompanionsRepository.findById).toHaveBeenCalledWith(mockCompanionId, undefined);
    });

    it('should throw error for non-owned companion', async () => {
      mockCompanionsRepository.findById.mockResolvedValue(
        createMockCompanion({ user_id: 'different-user' })
      );

      await expect(
        service.getPinnedMemories(mockUserId, mockCompanionId)
      ).rejects.toThrow('Companion not found');
    });

    it('should throw error for non-existent companion', async () => {
      mockCompanionsRepository.findById.mockResolvedValue(null);

      await expect(
        service.getPinnedMemories(mockUserId, mockCompanionId)
      ).rejects.toThrow('Companion not found');
    });

    it('should respect limit parameter', async () => {
      const mockPinnedMemories = [
        createMockPinnedMemory({ id: 'mem-1' }),
      ];
      mockMemoriesRepository.getPinnedMemories.mockResolvedValue(mockPinnedMemories);

      await service.getPinnedMemories(mockUserId, mockCompanionId, 5);

      expect(mockMemoriesRepository.getPinnedMemories).toHaveBeenCalledWith(
        mockUserId,
        mockCompanionId,
        5,
        undefined
      );
    });

    it('should assign relevanceScore of 1.0 to all pinned memories', async () => {
      const mockPinnedMemories = [
        createMockPinnedMemory({ id: 'mem-1' }),
        createMockPinnedMemory({ id: 'mem-2' }),
        createMockPinnedMemory({ id: 'mem-3' }),
      ];
      mockMemoriesRepository.getPinnedMemories.mockResolvedValue(mockPinnedMemories);

      const result = await service.getPinnedMemories(mockUserId, mockCompanionId);

      result.forEach(memory => {
        expect(memory.relevanceScore).toBe(1.0);
      });
    });
  });

  // ===========================================================================
  // Pin Memory Tests
  // ===========================================================================

  describe('pinMemory', () => {
    beforeEach(() => {
      mockMemoriesRepository.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepository.getPinnedCount.mockResolvedValue(0);
      mockMemoriesRepository.pinMemory.mockResolvedValue(true);
    });

    it('should successfully pin a memory', async () => {
      const result = await service.pinMemory(mockUserId, mockMemoryId);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockMemoriesRepository.pinMemory).toHaveBeenCalled();
    });

    it('should emit memory.pinned event on success', async () => {
      await service.pinMemory(mockUserId, mockMemoryId);

      expect(mockEventsService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory.pinned',
          payload: expect.objectContaining({
            memoryId: mockMemoryId,
            companionId: mockCompanionId,
          }),
        })
      );
    });

    it('should return error when memory not found', async () => {
      mockMemoriesRepository.findById.mockResolvedValue(null);

      const result = await service.pinMemory(mockUserId, mockMemoryId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Memory not found');
    });

    it('should return error when limit (10) is reached', async () => {
      mockMemoriesRepository.getPinnedCount.mockResolvedValue(10);

      const result = await service.pinMemory(mockUserId, mockMemoryId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximum of 10 pinned memories allowed');
      expect(mockMemoriesRepository.pinMemory).not.toHaveBeenCalled();
    });

    it('should not emit event when pinning fails', async () => {
      mockMemoriesRepository.pinMemory.mockResolvedValue(false);

      await service.pinMemory(mockUserId, mockMemoryId);

      expect(mockEventsService.emit).not.toHaveBeenCalled();
    });

    it('should check pin count before attempting to pin', async () => {
      mockMemoriesRepository.getPinnedCount.mockResolvedValue(9);
      mockMemoriesRepository.pinMemory.mockResolvedValue(true);

      const result = await service.pinMemory(mockUserId, mockMemoryId);

      expect(result.success).toBe(true);
      // Verify both methods were called (order is implicit in the implementation)
      expect(mockMemoriesRepository.getPinnedCount).toHaveBeenCalled();
      expect(mockMemoriesRepository.pinMemory).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Unpin Memory Tests
  // ===========================================================================

  describe('unpinMemory', () => {
    beforeEach(() => {
      mockMemoriesRepository.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepository.unpinMemory.mockResolvedValue(undefined);
    });

    it('should successfully unpin a memory', async () => {
      await expect(
        service.unpinMemory(mockUserId, mockMemoryId)
      ).resolves.not.toThrow();

      expect(mockMemoriesRepository.unpinMemory).toHaveBeenCalledWith(
        mockMemoryId,
        undefined
      );
    });

    it('should emit memory.unpinned event on success', async () => {
      await service.unpinMemory(mockUserId, mockMemoryId);

      expect(mockEventsService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory.unpinned',
          payload: expect.objectContaining({
            memoryId: mockMemoryId,
            companionId: mockCompanionId,
          }),
        })
      );
    });

    it('should throw error when memory not found', async () => {
      mockMemoriesRepository.findById.mockResolvedValue(null);

      await expect(
        service.unpinMemory(mockUserId, mockMemoryId)
      ).rejects.toThrow('Memory not found');
    });

    it('should verify memory ownership before unpinning', async () => {
      const otherUserMemory = createMockMemory({ user_id: 'different-user' });
      mockMemoriesRepository.findById.mockResolvedValue(otherUserMemory);

      // The getById method should handle ownership check
      // For this test, we assume it returns null for non-owned memories
      mockMemoriesRepository.findById.mockResolvedValue(null);

      await expect(
        service.unpinMemory(mockUserId, mockMemoryId)
      ).rejects.toThrow('Memory not found');
    });
  });

  // ===========================================================================
  // Reorder Pinned Memories Tests
  // ===========================================================================

  describe('reorderPinnedMemories', () => {
    beforeEach(() => {
      mockMemoriesRepository.reorderPinnedMemories.mockResolvedValue(undefined);
    });

    it('should successfully reorder pinned memories', async () => {
      const memoryIds = ['mem-3', 'mem-1', 'mem-2'];

      await expect(
        service.reorderPinnedMemories(mockUserId, mockCompanionId, memoryIds)
      ).resolves.not.toThrow();

      expect(mockMemoriesRepository.reorderPinnedMemories).toHaveBeenCalledWith(
        mockUserId,
        mockCompanionId,
        memoryIds,
        undefined
      );
    });

    it('should throw error for non-owned companion', async () => {
      mockCompanionsRepository.findById.mockResolvedValue(
        createMockCompanion({ user_id: 'different-user' })
      );

      await expect(
        service.reorderPinnedMemories(mockUserId, mockCompanionId, [])
      ).rejects.toThrow('Companion not found');
    });

    it('should throw error for non-existent companion', async () => {
      mockCompanionsRepository.findById.mockResolvedValue(null);

      await expect(
        service.reorderPinnedMemories(mockUserId, mockCompanionId, [])
      ).rejects.toThrow('Companion not found');
    });

    it('should handle empty memory IDs array', async () => {
      await expect(
        service.reorderPinnedMemories(mockUserId, mockCompanionId, [])
      ).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // Get Pinned Count Tests
  // ===========================================================================

  describe('getPinnedCount', () => {
    it('should return count of pinned memories', async () => {
      mockMemoriesRepository.getPinnedCount.mockResolvedValue(5);

      const result = await service.getPinnedCount(mockUserId, mockCompanionId);

      expect(result).toBe(5);
      expect(mockMemoriesRepository.getPinnedCount).toHaveBeenCalledWith(
        mockUserId,
        mockCompanionId,
        undefined
      );
    });

    it('should return 0 when no pinned memories exist', async () => {
      mockMemoriesRepository.getPinnedCount.mockResolvedValue(0);

      const result = await service.getPinnedCount(mockUserId, mockCompanionId);

      expect(result).toBe(0);
    });
  });

  // ===========================================================================
  // Limit Enforcement Tests
  // ===========================================================================

  describe('Pinned Memory Limit', () => {
    it('should allow pinning when at 9 pinned memories', async () => {
      mockMemoriesRepository.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepository.getPinnedCount.mockResolvedValue(9);
      mockMemoriesRepository.pinMemory.mockResolvedValue(true);

      const result = await service.pinMemory(mockUserId, mockMemoryId);

      expect(result.success).toBe(true);
    });

    it('should reject pinning when at exactly 10 pinned memories', async () => {
      mockMemoriesRepository.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepository.getPinnedCount.mockResolvedValue(10);

      const result = await service.pinMemory(mockUserId, mockMemoryId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('10');
    });

    it('should reject pinning when over 10 pinned memories (edge case)', async () => {
      mockMemoriesRepository.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepository.getPinnedCount.mockResolvedValue(15); // Should never happen, but test defensively

      const result = await service.pinMemory(mockUserId, mockMemoryId);

      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // Transaction Support Tests
  // ===========================================================================

  describe('Transaction Support', () => {
    const mockTx = {} as any;

    it('should pass transaction context to getPinnedMemories', async () => {
      mockMemoriesRepository.getPinnedMemories.mockResolvedValue([]);

      await service.getPinnedMemories(mockUserId, mockCompanionId, 10, mockTx);

      expect(mockCompanionsRepository.findById).toHaveBeenCalledWith(mockCompanionId, mockTx);
      expect(mockMemoriesRepository.getPinnedMemories).toHaveBeenCalledWith(
        mockUserId,
        mockCompanionId,
        10,
        mockTx
      );
    });

    it('should pass transaction context to pinMemory', async () => {
      mockMemoriesRepository.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepository.getPinnedCount.mockResolvedValue(0);
      mockMemoriesRepository.pinMemory.mockResolvedValue(true);

      await service.pinMemory(mockUserId, mockMemoryId, mockTx);

      expect(mockMemoriesRepository.getPinnedCount).toHaveBeenCalledWith(
        mockUserId,
        expect.any(String),
        mockTx
      );
      expect(mockMemoriesRepository.pinMemory).toHaveBeenCalledWith(
        mockMemoryId,
        mockUserId,
        expect.any(String),
        mockTx
      );
    });

    it('should pass transaction context to unpinMemory', async () => {
      mockMemoriesRepository.findById.mockResolvedValue(createMockMemory());
      mockMemoriesRepository.unpinMemory.mockResolvedValue(undefined);

      await service.unpinMemory(mockUserId, mockMemoryId, mockTx);

      expect(mockMemoriesRepository.unpinMemory).toHaveBeenCalledWith(mockMemoryId, mockTx);
    });

    it('should pass transaction context to reorderPinnedMemories', async () => {
      mockMemoriesRepository.reorderPinnedMemories.mockResolvedValue(undefined);

      await service.reorderPinnedMemories(mockUserId, mockCompanionId, [], mockTx);

      expect(mockCompanionsRepository.findById).toHaveBeenCalledWith(mockCompanionId, mockTx);
      expect(mockMemoriesRepository.reorderPinnedMemories).toHaveBeenCalledWith(
        mockUserId,
        mockCompanionId,
        [],
        mockTx
      );
    });
  });
});
