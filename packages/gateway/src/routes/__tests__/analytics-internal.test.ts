import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ============================================================================
// Mocks
// ============================================================================

const mockSql = vi.fn();

const {
  mockEnv,
} = vi.hoisted(() => ({
  mockEnv: {
    API_BASE_URL: 'https://api.example.com',
    INTERNAL_SERVICE_KEY: 'test-internal-key',
  },
}));

vi.mock('../../env.js', () => ({ env: mockEnv }));

vi.mock('../../db/pool.js', () => ({
  sql: () => mockSql,
}));

vi.mock('../../repositories/sessions.js', () => ({
  getSessionsRepository: () => ({}),
}));

vi.mock('../../repositories/memories.js', () => ({
  getMemoriesRepository: () => ({}),
}));

vi.mock('../../middleware/auth.js', () => ({
  requireInternalService: async (request: any, reply: any) => {
    const serviceKey = request.headers?.['x-internal-service-key'];
    if (serviceKey !== 'test-internal-key') {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  },
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
  withSpan: async (_name: string, fn: (span?: any) => Promise<any>) => fn(undefined),
}));

// ============================================================================
// Test Setup
// ============================================================================

import { analyticsInternalRoutes } from '../analytics-internal.js';

let app: FastifyInstance;

const internalHeaders = {
  'x-internal-service-key': 'test-internal-key',
};

const testUserId = '550e8400-e29b-41d4-a716-446655440000';
const testCompanionId = '660e8400-e29b-41d4-a716-446655440000';

beforeAll(async () => {
  app = Fastify();
  await app.register(analyticsInternalRoutes, { prefix: '/analytics' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('GET /analytics/internal/relationship/:companionId', () => {
  describe('authentication', () => {
    it('should reject requests without internal service key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'summary', userId: testUserId },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject requests with wrong service key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'summary', userId: testUserId },
        headers: { 'x-internal-service-key': 'wrong-key' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('validation', () => {
    it('should reject invalid analysis type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'invalid_type', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing userId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'summary' },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject non-UUID userId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'summary', userId: 'not-a-uuid' },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('summary analysis', () => {
    it('should return summary data', async () => {
      // Mock SQL calls - getSummary makes 2 queries
      mockSql
        .mockResolvedValueOnce([{
          total_sessions: 10,
          total_turns: 150,
          first_session_at: '2025-01-01T00:00:00Z',
          last_session_at: '2026-03-20T00:00:00Z',
          total_duration_ms: 3600000n,
        }])
        .mockResolvedValueOnce([{ memory_count: 25 }]);

      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'summary', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.totalSessions).toBe(10);
      expect(body.data.totalTurns).toBe(150);
      expect(body.data.memoryCount).toBe(25);
      expect(body.data.totalDurationHours).toBeCloseTo(1.0, 1);
    });

    it('should handle zero sessions', async () => {
      mockSql
        .mockResolvedValueOnce([{
          total_sessions: 0,
          total_turns: 0,
          first_session_at: null,
          last_session_at: null,
          total_duration_ms: 0n,
        }])
        .mockResolvedValueOnce([{ memory_count: 0 }]);

      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'summary', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.totalSessions).toBe(0);
      expect(body.data.firstSessionAt).toBeNull();
    });
  });

  describe('emotional_trajectory analysis', () => {
    it('should return emotional data from sessions', async () => {
      mockSql.mockResolvedValueOnce([
        {
          id: 'session-1',
          started_at: '2026-03-20T10:00:00Z',
          metadata: { averageSentiment: 'positive', dominantEmotion: 'joy' },
          turn_count: 20,
        },
        {
          id: 'session-2',
          started_at: '2026-03-18T10:00:00Z',
          metadata: { averageSentiment: 'neutral', dominantEmotion: 'calm' },
          turn_count: 15,
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'emotional_trajectory', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.sessions).toHaveLength(2);
      expect(body.data.sessions[0].averageSentiment).toBe('positive');
      expect(body.data.overallTrend).toBeDefined();
    });

    it('should handle sessions with no metadata', async () => {
      mockSql.mockResolvedValueOnce([
        { id: 's1', started_at: '2026-03-20T10:00:00Z', metadata: null, turn_count: 5 },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'emotional_trajectory', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.sessions[0].averageSentiment).toBe('neutral');
    });
  });

  describe('topic_history analysis', () => {
    it('should return topic data from memory tags', async () => {
      mockSql.mockResolvedValueOnce([
        { tag: 'cooking', mention_count: 12, last_mentioned: '2026-03-20T00:00:00Z' },
        { tag: 'travel', mention_count: 8, last_mentioned: '2026-03-15T00:00:00Z' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'topic_history', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.topics).toHaveLength(2);
      expect(body.data.topics[0].name).toBe('cooking');
      expect(body.data.topics[0].mentionCount).toBe(12);
    });

    it('should handle no topics', async () => {
      mockSql.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'topic_history', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.topics).toHaveLength(0);
    });
  });

  describe('interaction_stats analysis', () => {
    it('should return interaction statistics', async () => {
      // getInteractionStats makes 3 SQL queries
      mockSql
        .mockResolvedValueOnce([{
          avg_duration_ms: 900000,
          avg_turns: 25,
          max_duration_ms: 2700000,
          total_sessions: 10,
          first_session_at: '2025-06-01T00:00:00Z',
          last_session_at: '2026-03-20T00:00:00Z',
        }])
        .mockResolvedValueOnce([{ hour: 20, session_count: 5 }])
        .mockResolvedValueOnce([{ day_name: 'Saturday  ', session_count: 4 }]);

      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'interaction_stats', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.avgSessionLengthMinutes).toBeCloseTo(15, 0);
      expect(body.data.avgTurnsPerSession).toBe(25);
      expect(body.data.mostActiveHour).toBe('20:00');
      expect(body.data.mostActiveDay).toBe('Saturday');
    });

    it('should handle no session data', async () => {
      mockSql
        .mockResolvedValueOnce([{
          avg_duration_ms: 0,
          avg_turns: 0,
          max_duration_ms: 0,
          total_sessions: 0,
          first_session_at: null,
          last_session_at: null,
        }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'interaction_stats', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.sessionsPerWeek).toBe(0);
      expect(body.data.mostActiveHour).toBe('unknown');
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error', async () => {
      mockSql.mockRejectedValueOnce(new Error('Database connection lost'));

      const response = await app.inject({
        method: 'GET',
        url: `/analytics/internal/relationship/${testCompanionId}`,
        query: { type: 'summary', userId: testUserId },
        headers: internalHeaders,
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
