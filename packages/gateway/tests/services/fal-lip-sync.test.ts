/**
 * FalLipSyncService Tests
 * Tests TTS generation, FAL upload, and live-avatar submission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FalLipSyncService } from '../../src/services/fal-lip-sync.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('FalLipSyncService', () => {
  let service: FalLipSyncService;

  beforeEach(() => {
    service = new FalLipSyncService('test-fal-key', 'test-eleven-key');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateTTS', () => {
    it('calls ElevenLabs TTS API with correct params', async () => {
      const mp3Data = new ArrayBuffer(1024);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mp3Data),
      });

      const result = await service.generateTTS('Hello world', 'voice123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=mp3_44100_128',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': 'test-eleven-key',
          },
        })
      );

      // Verify body
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.text).toBe('Hello world');
      expect(callBody.model_id).toBe('eleven_turbo_v2_5');
      expect(callBody.voice_settings.stability).toBe(0.35);
      expect(callBody.voice_settings.similarity_boost).toBe(0.75);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.byteLength).toBe(1024);
    });

    it('uses custom voice settings when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(512)),
      });

      await service.generateTTS('Hi', 'voice456', { stability: 0.8, similarity_boost: 0.6 });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.voice_settings.stability).toBe(0.8);
      expect(callBody.voice_settings.similarity_boost).toBe(0.6);
    });

    it('throws on ElevenLabs API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
      });

      await expect(service.generateTTS('Hello', 'voice123')).rejects.toThrow(
        'ElevenLabs TTS failed: 429 Rate limited'
      );
    });
  });

  describe('uploadToFalStorage', () => {
    it('uploads buffer and returns URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ url: 'https://fal.run/storage/abc123' }),
      });

      const buffer = Buffer.from('fake-mp3-data');
      const url = await service.uploadToFalStorage(buffer);

      expect(url).toBe('https://fal.run/storage/abc123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://fal.run/api/storage/upload/v3',
        expect.objectContaining({
          method: 'PUT',
          headers: {
            Authorization: 'Key test-fal-key',
            'Content-Type': 'audio/mpeg',
          },
          body: buffer,
        })
      );
    });

    it('throws on upload failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal error'),
      });

      await expect(service.uploadToFalStorage(Buffer.from('data'))).rejects.toThrow(
        'FAL storage upload failed: 500 Internal error'
      );
    });
  });

  describe('submitLiveAvatar', () => {
    it('submits job, polls, and returns result', async () => {
      // Submit response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ request_id: 'req-abc', status: 'IN_QUEUE' }),
      });

      // First poll - IN_PROGRESS
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'IN_PROGRESS' }),
      });

      // Second poll - COMPLETED
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'COMPLETED' }),
      });

      // Result fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            video: { url: 'https://fal.run/storage/video-output.mp4' },
            duration: 4.2,
          }),
      });

      const result = await service.submitLiveAvatar(
        'https://example.com/avatar.png',
        'https://fal.run/storage/audio.mp3'
      );

      expect(result.video.url).toBe('https://fal.run/storage/video-output.mp4');
      expect(result.duration).toBe(4.2);

      // Verify submit call
      expect(mockFetch.mock.calls[0][0]).toBe('https://queue.fal.run/fal-ai/live-avatar');
      const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(submitBody.image_url).toBe('https://example.com/avatar.png');
      expect(submitBody.audio_url).toBe('https://fal.run/storage/audio.mp3');
      expect(submitBody.acceleration).toBe('high');
    });

    it('throws on FAILED status', async () => {
      // Submit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ request_id: 'req-fail', status: 'IN_QUEUE' }),
      });

      // Poll - FAILED
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'FAILED', error: 'Model error' }),
      });

      await expect(
        service.submitLiveAvatar('https://example.com/avatar.png', 'https://example.com/audio.mp3')
      ).rejects.toThrow('FAL live-avatar job failed: Model error');
    });

    it('throws on submit failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
      });

      await expect(
        service.submitLiveAvatar('https://example.com/avatar.png', 'https://example.com/audio.mp3')
      ).rejects.toThrow('FAL live-avatar submit failed: 400 Bad request');
    });
  });

  describe('generateLipSyncVideo (full flow)', () => {
    it('chains TTS, upload, and live-avatar correctly', async () => {
      // TTS
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048)),
      });

      // FAL upload
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ url: 'https://fal.run/storage/audio-xyz.mp3' }),
      });

      // Submit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ request_id: 'req-full', status: 'IN_QUEUE' }),
      });

      // Poll - COMPLETED immediately
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'COMPLETED' }),
      });

      // Result
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            video: { url: 'https://fal.run/storage/final-video.mp4' },
            duration: 5.0,
          }),
      });

      const result = await service.generateLipSyncVideo(
        'Hello there, how are you?',
        'voice-id-123',
        'https://example.com/companion.png'
      );

      expect(result.videoUrl).toBe('https://fal.run/storage/final-video.mp4');
      expect(result.durationSeconds).toBe(5.0);
      expect(mockFetch).toHaveBeenCalledTimes(5); // TTS + upload + submit + poll + result
    });
  });
});
