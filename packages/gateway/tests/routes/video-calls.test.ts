/**
 * Video Calls Routes Tests
 * Tests for creating, ending, listing, and querying video calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { videoCallsRoutes } from '../../src/routes/video-calls.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock auth middleware
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn(async (request: any, reply: any) => {
    if (request.headers.authorization === 'Bearer valid-token') {
      request.user = {
        userId: 'a0000000-0000-4000-8000-000000000001',
        email: 'test@example.com',
        role: 'user',
      };
      return;
    }
    if (request.headers.authorization === 'Bearer admin-token') {
      request.user = {
        userId: 'a0000000-0000-4000-8000-000000000002',
        email: 'admin@example.com',
        role: 'admin',
      };
      return;
    }
    if (request.headers.authorization === 'Bearer other-user-token') {
      request.user = {
        userId: 'a0000000-0000-4000-8000-000000000003',
        email: 'other@example.com',
        role: 'user',
      };
      return;
    }
    return reply.status(401).send({ error: 'Unauthorized' });
  }),
}));

// Mock video calls repository
const mockVideoCallsRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findByRoomName: vi.fn(),
  findActiveByUser: vi.fn(),
  updateStatus: vi.fn(),
  endCall: vi.fn(),
  incrementTokens: vi.fn(),
  listByUser: vi.fn(),
};

vi.mock('../../src/repositories/video-calls.js', () => ({
  getVideoCallsRepository: () => mockVideoCallsRepo,
}));

// Mock gifts repository
const mockGiftsRepo = {
  getTokenBalance: vi.fn(),
};

vi.mock('../../src/repositories/gifts.js', () => ({
  getGiftsRepository: () => mockGiftsRepo,
}));

// Mock companions repository
const mockCompanionsRepo = {
  findById: vi.fn(),
};

vi.mock('../../src/repositories/companions.js', () => ({
  getCompanionsRepository: () => mockCompanionsRepo,
}));

// Mock livekit-server-sdk
const mockToJwt = vi.fn().mockResolvedValue('mock-livekit-token');
vi.mock('livekit-server-sdk', () => ({
  AccessToken: vi.fn().mockImplementation(() => ({
    addGrant: vi.fn(),
    toJwt: mockToJwt,
  })),
  VideoGrant: vi.fn(),
}));

// Mock env
vi.mock('../../src/env.js', () => ({
  env: {
    ORCHESTRATOR_URL: 'http://localhost:8000',
    LIVEKIT_API_KEY: 'test-api-key',
    LIVEKIT_API_SECRET: 'test-api-secret',
    LIVEKIT_WS_URL: 'wss://livekit.example.com',
  },
}));

// Mock logger
vi.mock('../../src/observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fetch for orchestrator calls
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

// ============================================================================
// Test Data
// ============================================================================

const mockCompanion = {
  id: 'c0000000-0000-4000-8000-000000000001',
  user_id: 'a0000000-0000-4000-8000-000000000001',
  is_public: false,
  status: 'active',
  name: 'Test Companion',
};

const mockPublicCompanion = {
  id: 'c0000000-0000-4000-8000-000000000002',
  user_id: 'a0000000-0000-4000-8000-000000000009',
  is_public: true,
  status: 'active',
  name: 'Public Companion',
};

const mockVideoCall = {
  id: 'd0000000-0000-4000-8000-000000000001',
  user_id: 'a0000000-0000-4000-8000-000000000001',
  companion_id: 'c0000000-0000-4000-8000-000000000001',
  session_id: null,
  room_name: 'campfire-abc12345-1711411200000',
  status: 'connecting',
  avatar_provider: 'simli',
  avatar_face_id: null,
  started_at: new Date('2026-03-26T00:00:00Z'),
  ended_at: null,
  duration_seconds: null,
  tokens_deducted: 0,
  cost_usd: null,
  metadata: null,
  created_at: new Date('2026-03-26T00:00:00Z'),
};

const mockActiveVideoCall = {
  ...mockVideoCall,
  status: 'active',
};

const mockEndedVideoCall = {
  ...mockVideoCall,
  status: 'ended',
  ended_at: new Date('2026-03-26T00:05:00Z'),
  duration_seconds: 300,
  tokens_deducted: 600,
};

// ============================================================================
// Test Suite
// ============================================================================

describe('Video Calls Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(videoCallsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ==========================================================================
  // POST / - Create video call
  // ==========================================================================

  describe('POST / (create video call)', () => {
    it('should create a video call successfully', async () => {
      mockCompanionsRepo.findById.mockResolvedValue(mockCompanion);
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(null);
      mockGiftsRepo.getTokenBalance.mockResolvedValue({ balance: 500 });
      mockVideoCallsRepo.create.mockResolvedValue(mockVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.videoCallId).toBe('d0000000-0000-4000-8000-000000000001');
      expect(body.roomName).toBeDefined();
      expect(body.roomUrl).toBe('wss://livekit.example.com');
      expect(body.token).toBe('mock-livekit-token');
      expect(body.status).toBe('connecting');
    });

    it('should allow creating a call with a public companion from another user', async () => {
      mockCompanionsRepo.findById.mockResolvedValue(mockPublicCompanion);
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(null);
      mockGiftsRepo.getTokenBalance.mockResolvedValue({ balance: 500 });
      mockVideoCallsRepo.create.mockResolvedValue(mockVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000002' },
      });

      expect(response.statusCode).toBe(201);
    });

    it('should reject if not authenticated', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for invalid request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'not-a-uuid' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 if companion not found', async () => {
      mockCompanionsRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 for private companion owned by another user', async () => {
      mockCompanionsRepo.findById.mockResolvedValue({
        ...mockCompanion,
        user_id: 'a0000000-0000-4000-8000-000000000099',
        is_public: false,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 409 if user already has an active video call', async () => {
      mockCompanionsRepo.findById.mockResolvedValue(mockCompanion);
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(mockActiveVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.activeCallId).toBe('d0000000-0000-4000-8000-000000000001');
    });

    it('should return 402 if insufficient tokens (less than 120 for 1 min at 2/sec)', async () => {
      mockCompanionsRepo.findById.mockResolvedValue(mockCompanion);
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(null);
      mockGiftsRepo.getTokenBalance.mockResolvedValue({ balance: 50 });

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      expect(response.statusCode).toBe(402);
      const body = JSON.parse(response.body);
      expect(body.required).toBe(120);
      expect(body.balance).toBe(50);
    });

    it('should return 402 if no token balance at all', async () => {
      mockCompanionsRepo.findById.mockResolvedValue(mockCompanion);
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(null);
      mockGiftsRepo.getTokenBalance.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      expect(response.statusCode).toBe(402);
    });

    it('should call orchestrator to start video agent', async () => {
      mockCompanionsRepo.findById.mockResolvedValue(mockCompanion);
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(null);
      mockGiftsRepo.getTokenBalance.mockResolvedValue({ balance: 500 });
      mockVideoCallsRepo.create.mockResolvedValue(mockVideoCall);

      await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      // Wait for the async orchestrator call
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/video-agent/start',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should include optional fields in creation', async () => {
      mockCompanionsRepo.findById.mockResolvedValue(mockCompanion);
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(null);
      mockGiftsRepo.getTokenBalance.mockResolvedValue({ balance: 500 });
      mockVideoCallsRepo.create.mockResolvedValue(mockVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          companionId: 'c0000000-0000-4000-8000-000000000001',
          sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          avatarFaceId: 'face-abc',
          videoQuality: 'high',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(mockVideoCallsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          avatar_face_id: 'face-abc',
          metadata: { videoQuality: 'high' },
        })
      );
    });
  });

  // ==========================================================================
  // POST /:id/end - End video call
  // ==========================================================================

  describe('POST /:id/end (end video call)', () => {
    it('should end an active video call', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(mockActiveVideoCall);
      mockVideoCallsRepo.endCall.mockResolvedValue(mockEndedVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/d0000000-0000-4000-8000-000000000001/end',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('d0000000-0000-4000-8000-000000000001');
      expect(body.status).toBe('ended');
      expect(body.durationSeconds).toBeDefined();
      expect(body.tokensDeducted).toBeDefined();
    });

    it('should notify orchestrator to stop agent', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(mockActiveVideoCall);
      mockVideoCallsRepo.endCall.mockResolvedValue(mockEndedVideoCall);

      await app.inject({
        method: 'POST',
        url: '/d0000000-0000-4000-8000-000000000001/end',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/video-agent/stop',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should return 404 if call not found', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/d0000000-0000-4000-8000-000000000099/end',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 if not owner', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(mockActiveVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/d0000000-0000-4000-8000-000000000001/end',
        headers: { authorization: 'Bearer other-user-token' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow admin to end any call', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(mockActiveVideoCall);
      mockVideoCallsRepo.endCall.mockResolvedValue(mockEndedVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/d0000000-0000-4000-8000-000000000001/end',
        headers: { authorization: 'Bearer admin-token' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 400 if call already ended', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(mockEndedVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/d0000000-0000-4000-8000-000000000001/end',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 if call already failed', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue({
        ...mockVideoCall,
        status: 'failed',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/d0000000-0000-4000-8000-000000000001/end',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ==========================================================================
  // GET /:id - Get call details
  // ==========================================================================

  describe('GET /:id (get call details)', () => {
    it('should return call details', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(mockVideoCall);

      const response = await app.inject({
        method: 'GET',
        url: '/d0000000-0000-4000-8000-000000000001',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('d0000000-0000-4000-8000-000000000001');
      expect(body.userId).toBe('a0000000-0000-4000-8000-000000000001');
      expect(body.companionId).toBe('c0000000-0000-4000-8000-000000000001');
      expect(body.roomName).toBeDefined();
      expect(body.status).toBe('connecting');
    });

    it('should return 404 if not found', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/d0000000-0000-4000-8000-000000000099',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 if not owner and not admin', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(mockVideoCall);

      const response = await app.inject({
        method: 'GET',
        url: '/d0000000-0000-4000-8000-000000000001',
        headers: { authorization: 'Bearer other-user-token' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow admin to view any call', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue(mockVideoCall);

      const response = await app.inject({
        method: 'GET',
        url: '/d0000000-0000-4000-8000-000000000001',
        headers: { authorization: 'Bearer admin-token' },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ==========================================================================
  // GET /active - Get active call
  // ==========================================================================

  describe('GET /active (get active call)', () => {
    it('should return active call if one exists', async () => {
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(mockActiveVideoCall);

      const response = await app.inject({
        method: 'GET',
        url: '/active',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.activeCall).not.toBeNull();
      expect(body.activeCall.id).toBe('d0000000-0000-4000-8000-000000000001');
      expect(body.activeCall.status).toBe('active');
    });

    it('should return null if no active call', async () => {
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/active',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.activeCall).toBeNull();
    });
  });

  // ==========================================================================
  // GET / - List call history
  // ==========================================================================

  describe('GET / (list call history)', () => {
    it('should return paginated call history', async () => {
      mockVideoCallsRepo.listByUser.mockResolvedValue({
        data: [mockEndedVideoCall, mockVideoCall],
        total: 2,
        hasMore: false,
        limit: 20,
        offset: 0,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.videoCalls).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    });

    it('should pass pagination parameters', async () => {
      mockVideoCallsRepo.listByUser.mockResolvedValue({
        data: [],
        total: 0,
        hasMore: false,
        limit: 5,
        offset: 10,
      });

      await app.inject({
        method: 'GET',
        url: '/?limit=5&offset=10',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(mockVideoCallsRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'a0000000-0000-4000-8000-000000000001',
          limit: 5,
          offset: 10,
        })
      );
    });

    it('should filter by companionId and status', async () => {
      mockVideoCallsRepo.listByUser.mockResolvedValue({
        data: [],
        total: 0,
        hasMore: false,
        limit: 20,
        offset: 0,
      });

      await app.inject({
        method: 'GET',
        url: '/?companionId=c0000000-0000-4000-8000-000000000001&status=ended',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(mockVideoCallsRepo.listByUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'a0000000-0000-4000-8000-000000000001',
          companionId: 'c0000000-0000-4000-8000-000000000001',
          status: 'ended',
        })
      );
    });
  });

  // ==========================================================================
  // Billing calculations
  // ==========================================================================

  describe('billing calculations', () => {
    it('should compute duration correctly when ending a call', async () => {
      const startTime = new Date('2026-03-26T00:00:00Z');
      mockVideoCallsRepo.findById.mockResolvedValue({
        ...mockActiveVideoCall,
        started_at: startTime,
        tokens_deducted: 600,
      });
      mockVideoCallsRepo.endCall.mockImplementation(
        async (_id: string, endedAt: Date, durationSeconds: number, tokensDeducted: number) => ({
          ...mockEndedVideoCall,
          ended_at: endedAt,
          duration_seconds: durationSeconds,
          tokens_deducted: tokensDeducted,
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/d0000000-0000-4000-8000-000000000001/end',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      // endCall should have been called with the right arguments
      expect(mockVideoCallsRepo.endCall).toHaveBeenCalledWith(
        'd0000000-0000-4000-8000-000000000001',
        expect.any(Date),
        expect.any(Number),
        600 // tokens from the mock
      );
    });
  });

  // ==========================================================================
  // LiveKit token generation
  // ==========================================================================

  describe('LiveKit token generation', () => {
    it('should generate a valid LiveKit token for the user', async () => {
      mockCompanionsRepo.findById.mockResolvedValue(mockCompanion);
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(null);
      mockGiftsRepo.getTokenBalance.mockResolvedValue({ balance: 500 });
      mockVideoCallsRepo.create.mockResolvedValue(mockVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.token).toBe('mock-livekit-token');
      expect(mockToJwt).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should return 503 when LiveKit is not configured', async () => {
      // Override env to remove LiveKit config
      const envModule = await import('../../src/env.js');
      const originalLkKey = (envModule.env as any).LIVEKIT_API_KEY;
      (envModule.env as any).LIVEKIT_API_KEY = undefined;

      mockCompanionsRepo.findById.mockResolvedValue(mockCompanion);
      mockVideoCallsRepo.findActiveByUser.mockResolvedValue(null);
      mockGiftsRepo.getTokenBalance.mockResolvedValue({ balance: 500 });

      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { authorization: 'Bearer valid-token' },
        payload: { companionId: 'c0000000-0000-4000-8000-000000000001' },
      });

      expect(response.statusCode).toBe(503);

      // Restore
      (envModule.env as any).LIVEKIT_API_KEY = originalLkKey;
    });

    it('should handle ending a connecting call', async () => {
      mockVideoCallsRepo.findById.mockResolvedValue({
        ...mockVideoCall,
        status: 'connecting',
      });
      mockVideoCallsRepo.endCall.mockResolvedValue(mockEndedVideoCall);

      const response = await app.inject({
        method: 'POST',
        url: '/d0000000-0000-4000-8000-000000000001/end',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
