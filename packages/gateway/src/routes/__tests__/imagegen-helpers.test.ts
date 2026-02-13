import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateCacheKey, generateWithOrchestrator } from '../imagegen-helpers.js';

describe('imagegen-helpers', () => {
  describe('generateCacheKey', () => {
    it('changes when referenceImageUrl changes', () => {
      const base = {
        prompt: 'test prompt',
        emotionalState: 'neutral',
        style: 'stylized' as const,
        width: 832,
        height: 1248,
        userId: 'user-1',
        sessionId: 'session-1',
        companionId: 'companion-1',
      };

      const keyA = generateCacheKey({ ...base, referenceImageUrl: 'https://example.com/a.png' });
      const keyB = generateCacheKey({ ...base, referenceImageUrl: 'https://example.com/b.png' });
      expect(keyA).not.toEqual(keyB);
    });

    it('changes when loras changes', () => {
      const base = {
        prompt: 'test prompt',
        emotionalState: 'neutral',
        style: 'stylized' as const,
        width: 832,
        height: 1248,
        userId: 'user-1',
        sessionId: 'session-1',
        companionId: 'companion-1',
      };

      const keyA = generateCacheKey({
        ...base,
        loras: [{ path: 'https://example.com/lora-a.safetensors', scale: 1.0 }],
      });
      const keyB = generateCacheKey({
        ...base,
        loras: [{ path: 'https://example.com/lora-b.safetensors', scale: 1.0 }],
      });
      expect(keyA).not.toEqual(keyB);
    });

    it('changes when seed changes', () => {
      const base = {
        prompt: 'test prompt',
        emotionalState: 'neutral',
        style: 'stylized' as const,
        width: 832,
        height: 1248,
        userId: 'user-1',
        sessionId: 'session-1',
        companionId: 'companion-1',
      };

      const keyA = generateCacheKey({ ...base, seed: 123 });
      const keyB = generateCacheKey({ ...base, seed: 124 });
      expect(keyA).not.toEqual(keyB);
    });
  });

  describe('generateWithOrchestrator', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sends reference_image_url, loras, lora_trigger_word, and seed when provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          image_base64: Buffer.from('x').toString('base64'),
          format: 'png',
          width: 512,
          height: 512,
          latency_ms: 12,
          provider: 'fal',
          model_id: 'fal/flux-lora',
          prompt_used: 'ignored',
        }),
      });

      await generateWithOrchestrator(
        'hello world',
        'neutral',
        'stylized',
        512,
        512,
        'https://example.com/ref.png',
        0.9,
        false,
        'companion-1',
        false,
        [{ path: 'https://example.com/lora.safetensors', scale: 0.8 }],
        'TRIGGER',
        42
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(url).toContain('/imagegen/generate');

      const body = JSON.parse(options.body);
      expect(body.reference_image_url).toBe('https://example.com/ref.png');
      expect(body.reference_strength).toBe(0.9);
      expect(body.loras).toEqual([{ path: 'https://example.com/lora.safetensors', scale: 0.8 }]);
      expect(body.lora_trigger_word).toBe('TRIGGER');
      expect(body.seed).toBe(42);
    });
  });
});

