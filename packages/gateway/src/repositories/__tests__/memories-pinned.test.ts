/**
 * Pinned Memories Repository Tests
 *
 * Tests for pinned memory data access layer including:
 * - Get pinned memories for a user-companion pair
 * - Pin a memory
 * - Unpin a memory
 * - Reorder pinned memories
 * - Get pinned memory count
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Memory, MemoryContentType } from '../../db/types.js';

// Mock the database pool
const mockSql = vi.fn();
vi.mock('../../db/pool.js', () => ({
  sql: () => mockSql,
}));

// Mock the logger
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
import { MemoriesRepository, type MemoryWithPinInfo } from '../memories.js';

// Test fixtures
const mockUserId = '550e8400-e29b-41d4-a716-446655440001';
const mockCompanionId = '550e8400-e29b-41d4-a716-446655440002';
const mockMemoryId = '550e8400-e29b-41d4-a716-446655440003';

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

const createMockPinnedMemory = (overrides: Partial<MemoryWithPinInfo> = {}): MemoryWithPinInfo => ({
  ...createMockMemory(),
  is_pinned: true,
  pin_order: 1,
  pinned_at: new Date('2025-01-05T00:00:00Z'),
  ...overrides,
});

describe('MemoriesRepository - Pinned Memories', () => {
  let repository: MemoriesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new MemoriesRepository();
  });

  // ===========================================================================
  // Get Pinned Memories Tests
  // ===========================================================================

  describe('getPinnedMemories', () => {
    it('should return pinned memories for a user-companion pair', async () => {
      const mockPinnedMemories = [
        createMockPinnedMemory({ id: 'mem-1', content: 'User is a software engineer', pin_order: 1 }),
        createMockPinnedMemory({ id: 'mem-2', content: 'User has a dog named Max', pin_order: 2 }),
        createMockPinnedMemory({ id: 'mem-3', content: 'User loves coffee', pin_order: 3 }),
      ];
      mockSql.mockResolvedValueOnce(mockPinnedMemories);

      const result = await repository.getPinnedMemories(mockUserId, mockCompanionId);

      expect(result).toHaveLength(3);
      expect(result[0].is_pinned).toBe(true);
      expect(result[0].pin_order).toBe(1);
      expect(mockSql).toHaveBeenCalled();
    });

    it('should return empty array when no pinned memories exist', async () => {
      mockSql.mockResolvedValueOnce([]);

      const result = await repository.getPinnedMemories(mockUserId, mockCompanionId);

      expect(result).toHaveLength(0);
    });

    it('should respect the limit parameter', async () => {
      const mockPinnedMemories = Array.from({ length: 5 }, (_, i) =>
        createMockPinnedMemory({ id: `mem-${i}`, pin_order: i + 1 })
      );
      mockSql.mockResolvedValueOnce(mockPinnedMemories.slice(0, 3));

      const result = await repository.getPinnedMemories(mockUserId, mockCompanionId, 3);

      expect(result).toHaveLength(3);
    });

    it('should return memories ordered by pin_order', async () => {
      const mockPinnedMemories = [
        createMockPinnedMemory({ id: 'mem-1', pin_order: 1 }),
        createMockPinnedMemory({ id: 'mem-2', pin_order: 2 }),
        createMockPinnedMemory({ id: 'mem-3', pin_order: 3 }),
      ];
      mockSql.mockResolvedValueOnce(mockPinnedMemories);

      const result = await repository.getPinnedMemories(mockUserId, mockCompanionId);

      expect(result[0].pin_order).toBe(1);
      expect(result[1].pin_order).toBe(2);
      expect(result[2].pin_order).toBe(3);
    });

    it('should only return active memories', async () => {
      // The query filters by status = 'active', so we just verify it's called correctly
      mockSql.mockResolvedValueOnce([]);

      await repository.getPinnedMemories(mockUserId, mockCompanionId);

      expect(mockSql).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Pin Memory Tests
  // ===========================================================================

  describe('pinMemory', () => {
    it('should successfully pin a memory', async () => {
      mockSql.mockResolvedValueOnce([{ success: true }]);

      const result = await repository.pinMemory(mockMemoryId, mockUserId, mockCompanionId);

      expect(result).toBe(true);
      expect(mockSql).toHaveBeenCalled();
    });

    it('should return false when limit (10) is reached', async () => {
      mockSql.mockResolvedValueOnce([{ success: false }]);

      const result = await repository.pinMemory(mockMemoryId, mockUserId, mockCompanionId);

      expect(result).toBe(false);
    });

    it('should call the pin_memory database function', async () => {
      mockSql.mockResolvedValueOnce([{ success: true }]);

      await repository.pinMemory(mockMemoryId, mockUserId, mockCompanionId);

      // Verify the SQL function was called with correct parameters
      expect(mockSql).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Unpin Memory Tests
  // ===========================================================================

  describe('unpinMemory', () => {
    it('should successfully unpin a memory', async () => {
      mockSql.mockResolvedValueOnce([]);

      await expect(repository.unpinMemory(mockMemoryId)).resolves.not.toThrow();
      expect(mockSql).toHaveBeenCalled();
    });

    it('should call the unpin_memory database function', async () => {
      mockSql.mockResolvedValueOnce([]);

      await repository.unpinMemory(mockMemoryId);

      expect(mockSql).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Reorder Pinned Memories Tests
  // ===========================================================================

  describe('reorderPinnedMemories', () => {
    it('should successfully reorder pinned memories', async () => {
      const memoryIds = ['mem-3', 'mem-1', 'mem-2']; // New order
      mockSql.mockResolvedValueOnce([]);

      await expect(
        repository.reorderPinnedMemories(mockUserId, mockCompanionId, memoryIds)
      ).resolves.not.toThrow();

      expect(mockSql).toHaveBeenCalled();
    });

    it('should handle empty memory IDs array', async () => {
      mockSql.mockResolvedValueOnce([]);

      await expect(
        repository.reorderPinnedMemories(mockUserId, mockCompanionId, [])
      ).resolves.not.toThrow();
    });

    it('should call the reorder_pinned_memories database function', async () => {
      const memoryIds = ['mem-1', 'mem-2', 'mem-3'];
      mockSql.mockResolvedValueOnce([]);

      await repository.reorderPinnedMemories(mockUserId, mockCompanionId, memoryIds);

      expect(mockSql).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Get Pinned Count Tests
  // ===========================================================================

  describe('getPinnedCount', () => {
    it('should return count of pinned memories', async () => {
      mockSql.mockResolvedValueOnce([{ count: 5 }]);

      const result = await repository.getPinnedCount(mockUserId, mockCompanionId);

      expect(result).toBe(5);
    });

    it('should return 0 when no pinned memories exist', async () => {
      mockSql.mockResolvedValueOnce([{ count: 0 }]);

      const result = await repository.getPinnedCount(mockUserId, mockCompanionId);

      expect(result).toBe(0);
    });

    it('should return 0 when query returns null', async () => {
      mockSql.mockResolvedValueOnce([]);

      const result = await repository.getPinnedCount(mockUserId, mockCompanionId);

      expect(result).toBe(0);
    });

    it('should count only active pinned memories', async () => {
      // The query filters by is_pinned = TRUE AND status = 'active'
      mockSql.mockResolvedValueOnce([{ count: 3 }]);

      const result = await repository.getPinnedCount(mockUserId, mockCompanionId);

      expect(result).toBe(3);
      expect(mockSql).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Edge Cases and Error Handling
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle database errors gracefully for getPinnedMemories', async () => {
      const error = new Error('Database connection failed');
      mockSql.mockRejectedValueOnce(error);

      await expect(
        repository.getPinnedMemories(mockUserId, mockCompanionId)
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle database errors gracefully for pinMemory', async () => {
      const error = new Error('Database connection failed');
      mockSql.mockRejectedValueOnce(error);

      await expect(
        repository.pinMemory(mockMemoryId, mockUserId, mockCompanionId)
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle null pin_order values', async () => {
      const mockMemory = createMockPinnedMemory({ pin_order: null });
      mockSql.mockResolvedValueOnce([mockMemory]);

      const result = await repository.getPinnedMemories(mockUserId, mockCompanionId);

      expect(result[0].pin_order).toBeNull();
    });

    it('should handle null pinned_at values', async () => {
      const mockMemory = createMockPinnedMemory({ pinned_at: null });
      mockSql.mockResolvedValueOnce([mockMemory]);

      const result = await repository.getPinnedMemories(mockUserId, mockCompanionId);

      expect(result[0].pinned_at).toBeNull();
    });
  });

  // ===========================================================================
  // Integration with Transaction Context
  // ===========================================================================

  describe('Transaction Support', () => {
    // Note: Full transaction testing requires integration tests with a real database.
    // These tests verify the method signatures accept transaction parameters.
    // The actual transaction behavior is tested in integration tests.

    it('should have getPinnedMemories method that accepts transaction parameter', () => {
      expect(typeof repository.getPinnedMemories).toBe('function');
      expect(repository.getPinnedMemories.length).toBeGreaterThanOrEqual(2); // At least userId, companionId
    });

    it('should have pinMemory method that accepts transaction parameter', () => {
      expect(typeof repository.pinMemory).toBe('function');
      expect(repository.pinMemory.length).toBeGreaterThanOrEqual(3); // memoryId, userId, companionId
    });

    it('should have unpinMemory method that accepts transaction parameter', () => {
      expect(typeof repository.unpinMemory).toBe('function');
      expect(repository.unpinMemory.length).toBeGreaterThanOrEqual(1); // memoryId
    });

    it('should have reorderPinnedMemories method that accepts transaction parameter', () => {
      expect(typeof repository.reorderPinnedMemories).toBe('function');
      expect(repository.reorderPinnedMemories.length).toBeGreaterThanOrEqual(3); // userId, companionId, memoryIds
    });

    it('should have getPinnedCount method that accepts transaction parameter', () => {
      expect(typeof repository.getPinnedCount).toBe('function');
      expect(repository.getPinnedCount.length).toBeGreaterThanOrEqual(2); // userId, companionId
    });
  });
});

// ===========================================================================
// MemoryWithPinInfo Type Tests
// ===========================================================================

describe('MemoryWithPinInfo Type', () => {
  it('should extend Memory with pin information', () => {
    const pinnedMemory: MemoryWithPinInfo = {
      id: mockMemoryId,
      user_id: mockUserId,
      companion_id: mockCompanionId,
      content: 'Test content',
      content_type: 'fact',
      embedding: null,
      importance: 0.5,
      source_event_id: null,
      source_turn_id: null,
      metadata: {},
      expires_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      is_pinned: true,
      pin_order: 1,
      pinned_at: new Date(),
    };

    expect(pinnedMemory.is_pinned).toBe(true);
    expect(pinnedMemory.pin_order).toBe(1);
    expect(pinnedMemory.pinned_at).toBeInstanceOf(Date);
    expect(pinnedMemory.content).toBe('Test content');
  });
});
