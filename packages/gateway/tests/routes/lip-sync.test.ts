/**
 * Lip-Sync Routes Tests
 * Tests for the lip-sync video generation endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { lipSyncRoutes } from '../../src/routes/lip-sync.js';

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
    return reply.status(401).send({ error: 'Unauthorized' });
  }),
}));

// Mock env
vi.mock('../../src/env.js', () => ({
  env: {
    FAL_API_KEY: 'test-fal-key',
    ELEVENLABS_API_KEY: 'test-eleven-key',
  },
}));

// Mock FalLipSyncService
const mockGenerateLipSyncVideo = vi.fn();
const mockGenerateFromAudio = vi.fn();
vi.mock('../../src/services/fal-lip-sync.js', () => ({
  getFalLipSyncService: () => ({
    generateLipSyncVideo: mockGenerateLipSyncVideo,
    generateFromAudio: mockGenerateFromAudio,
  }),
}));

// Mock imagegen-helpers (companion identity anchor lookup)
const mockGetCompanionIdentityAnchorUrl = vi.fn();
vi.mock('../../src/routes/imagegen-helpers.js', () => ({
  getCompanionIdentityAnchorUrl: (...args: unknown[]) => mockGetCompanionIdentityAnchorUrl(...args),
}));

// ============================================================================
// Test Suite
// ============================================================================

describe('Lip-Sync Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(lipSyncRoutes, { prefix: '/lip-sync' });
    await app.ready();

    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /lip-sync/generate', () => {
    const validBody = {
      text: 'Hello, how are you today?',
      companionId: 'a0000000-0000-4000-8000-000000000010',
      voiceId: 'EXAVITQu4vr4xnSDxMaL',
    };

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate',
        headers: { 'Content-Type': 'application/json' },
        payload: validBody,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for invalid body (missing text)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: { companionId: validBody.companionId, voiceId: validBody.voiceId },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid companionId (not UUID)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: { ...validBody, companionId: 'not-a-uuid' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when companion has no anchor avatar', async () => {
      mockGetCompanionIdentityAnchorUrl.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('COMPANION_AVATAR_NOT_FOUND');
    });

    it('returns 200 with video URL on success', async () => {
      mockGetCompanionIdentityAnchorUrl.mockResolvedValue('https://example.com/avatar.png');
      mockGenerateLipSyncVideo.mockResolvedValue({
        videoUrl: 'https://fal.run/storage/video123.mp4',
        durationSeconds: 3.5,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.videoUrl).toBe('https://fal.run/storage/video123.mp4');
      expect(body.data.duration).toBe(3.5);

      // Verify service was called correctly
      expect(mockGenerateLipSyncVideo).toHaveBeenCalledWith(
        validBody.text,
        validBody.voiceId,
        'https://example.com/avatar.png',
        undefined
      );
    });

    it('passes voiceSettings when provided', async () => {
      mockGetCompanionIdentityAnchorUrl.mockResolvedValue('https://example.com/avatar.png');
      mockGenerateLipSyncVideo.mockResolvedValue({
        videoUrl: 'https://fal.run/storage/video456.mp4',
        durationSeconds: 2.0,
      });

      const bodyWithSettings = {
        ...validBody,
        voiceSettings: { stability: 0.5, similarity_boost: 0.8 },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: bodyWithSettings,
      });

      expect(response.statusCode).toBe(200);
      expect(mockGenerateLipSyncVideo).toHaveBeenCalledWith(
        validBody.text,
        validBody.voiceId,
        'https://example.com/avatar.png',
        { stability: 0.5, similarity_boost: 0.8 }
      );
    });

    it('returns 500 when service throws', async () => {
      mockGetCompanionIdentityAnchorUrl.mockResolvedValue('https://example.com/avatar.png');
      mockGenerateLipSyncVideo.mockRejectedValue(new Error('FAL API timeout'));

      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('LIP_SYNC_GENERATION_FAILED');
    });
  });

  describe('POST /lip-sync/generate-from-audio', () => {
    const validBody = {
      companionId: 'a0000000-0000-4000-8000-000000000010',
      audioChunks: [
        Buffer.from('fake-pcm-1').toString('base64'),
        Buffer.from('fake-pcm-2').toString('base64'),
      ],
      sampleRate: 16000,
    };

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate-from-audio',
        headers: { 'Content-Type': 'application/json' },
        payload: validBody,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for invalid body (missing audioChunks)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate-from-audio',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: { companionId: validBody.companionId },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for empty audioChunks array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate-from-audio',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: { ...validBody, audioChunks: [] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid companionId (not UUID)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate-from-audio',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: { ...validBody, companionId: 'not-a-uuid' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when companion has no anchor avatar', async () => {
      mockGetCompanionIdentityAnchorUrl.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate-from-audio',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('COMPANION_AVATAR_NOT_FOUND');
    });

    it('returns 200 with video URL on success', async () => {
      mockGetCompanionIdentityAnchorUrl.mockResolvedValue('https://example.com/avatar.png');
      mockGenerateFromAudio.mockResolvedValue({
        videoUrl: 'https://fal.run/storage/video-from-audio.mp4',
        durationSeconds: 4.2,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate-from-audio',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.videoUrl).toBe('https://fal.run/storage/video-from-audio.mp4');
      expect(body.data.duration).toBe(4.2);

      // Verify service was called correctly
      expect(mockGenerateFromAudio).toHaveBeenCalledWith(
        validBody.audioChunks,
        16000,
        'https://example.com/avatar.png',
      );
    });

    it('defaults sampleRate to 16000 when not provided', async () => {
      mockGetCompanionIdentityAnchorUrl.mockResolvedValue('https://example.com/avatar.png');
      mockGenerateFromAudio.mockResolvedValue({
        videoUrl: 'https://fal.run/storage/video.mp4',
        durationSeconds: 1.0,
      });

      const { sampleRate: _, ...bodyWithoutSampleRate } = validBody;

      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate-from-audio',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: bodyWithoutSampleRate,
      });

      expect(response.statusCode).toBe(200);
      expect(mockGenerateFromAudio).toHaveBeenCalledWith(
        validBody.audioChunks,
        16000,
        'https://example.com/avatar.png',
      );
    });

    it('returns 500 when service throws', async () => {
      mockGetCompanionIdentityAnchorUrl.mockResolvedValue('https://example.com/avatar.png');
      mockGenerateFromAudio.mockRejectedValue(new Error('S3 upload failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/lip-sync/generate-from-audio',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('LIP_SYNC_GENERATION_FAILED');
    });
  });
});
