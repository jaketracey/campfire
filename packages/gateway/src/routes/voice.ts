/**
 * Voice Routes
 * Public endpoints for voice preview and selection.
 * These endpoints do NOT require authentication.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/auth.js';

// ElevenLabs API configuration
const ELEVENLABS_API_KEY = env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_AGENT_ID = env.ELEVENLABS_AGENT_ID || '';
const ELEVENLABS_TTS_MODEL = env.ELEVENLABS_TTS_MODEL || 'eleven_turbo_v2_5';

// Flirty sample text for voice previews
const SAMPLE_TEXT = "Hey there... I've been thinking about you. Want to come a little closer and tell me what's on your mind?";

// Voice type returned by our API
interface Voice {
  id: string;
  name: string;
  description: string;
  gender: 'feminine' | 'masculine' | 'neutral';
  accent: string;
  age: string;
  useCase: string;
  category: string;
  previewUrl: string | null;
}

// Cached voices from ElevenLabs API
let cachedVoices: Voice[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch all available voices from ElevenLabs API with caching
 */
async function getAvailableVoices(): Promise<Voice[]> {
  if (cachedVoices && Date.now() < cacheExpiry) {
    return cachedVoices;
  }

  if (!ELEVENLABS_API_KEY) {
    return [];
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch ElevenLabs voices');
      return cachedVoices || [];
    }

    const data = (await response.json()) as {
      voices: Array<{
        voice_id: string;
        name: string;
        category: string;
        labels: Record<string, string>;
        preview_url: string | null;
      }>;
    };

    cachedVoices = data.voices.map((v) => {
      const labels = v.labels || {};
      const genderLabel = (labels.gender || '').toLowerCase();
      const gender: Voice['gender'] =
        genderLabel === 'female' ? 'feminine' : genderLabel === 'male' ? 'masculine' : 'neutral';

      const descParts = [labels.description, labels.accent ? `${labels.accent} accent` : ''].filter(Boolean);
      const description = descParts.length > 0
        ? descParts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
        : v.category;

      return {
        id: v.voice_id,
        name: v.name,
        description,
        gender,
        accent: labels.accent || '',
        age: labels.age || '',
        useCase: labels.use_case || '',
        category: v.category,
        previewUrl: v.preview_url || null,
      };
    });

    cacheExpiry = Date.now() + CACHE_TTL_MS;
    logger.info({ count: cachedVoices.length }, 'Fetched ElevenLabs voices');
    return cachedVoices;
  } catch (error) {
    logger.error({ err: error }, 'Error fetching ElevenLabs voices');
    return cachedVoices || [];
  }
}

// Request schemas
const VoiceSampleParamsSchema = z.object({
  voiceId: z.string().min(1),
});

const VoiceSampleQuerySchema = z.object({
  // Voice settings (0-1 range)
  stability: z.coerce.number().min(0).max(1).optional().default(0.35), // Lower = more expressive
  similarityBoost: z.coerce.number().min(0).max(1).optional().default(0.75),
  style: z.coerce.number().min(0).max(1).optional().default(0.45), // Higher = more personality
  speed: z.coerce.number().min(0.5).max(2.0).optional().default(0.95), // Slightly slower for intimate feel
  speakerBoost: z.coerce.boolean().optional().default(true),
  // Custom sample text (optional)
  text: z.string().min(1).max(500).optional(),
});

/**
 * Register voice routes (no authentication required)
 */
export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /voice/list
   * Returns list of available voices for companion creation
   */
  app.get('/list', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const voices = await getAvailableVoices();
      return reply
        .header('Cache-Control', 'public, max-age=3600')
        .send({
          success: true,
          data: { voices },
        });
    } catch (error) {
      logger.error({ err: error }, 'Failed to get voice list');
      throw error;
    }
  });

  /**
   * GET /voice/:voiceId/sample
   * Generates and returns a TTS audio sample for the voice
   * Returns MP3 audio data
   *
   * Query params for customization:
   * - stability: 0-1 (lower = more emotional range) default 0.35
   * - similarityBoost: 0-1 (voice fidelity) default 0.75
   * - style: 0-1 (personality amplification) default 0.45
   * - speed: 0.5-2.0 (speech rate) default 0.95
   * - speakerBoost: boolean (enhanced quality) default true
   * - text: custom sample text (optional)
   */
  app.get('/:voiceId/sample', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = VoiceSampleParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid voice ID',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const queryResult = VoiceSampleQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: queryResult.error.flatten(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const { voiceId } = paramsResult.data;
    const { stability, similarityBoost, style, speed, speakerBoost, text } = queryResult.data;

    if (!ELEVENLABS_API_KEY) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Voice service not configured',
          timestamp: new Date().toISOString(),
        },
      });
    }

    try {
      const sampleText = text || SAMPLE_TEXT;

      logger.info(
        {
          voiceId,
          settings: { stability, similarityBoost, style, speed, speakerBoost },
          textLength: sampleText.length,
        },
        'Generating voice sample'
      );

      // Generate TTS sample using ElevenLabs API
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY,
          },
          body: JSON.stringify({
            text: sampleText,
            model_id: ELEVENLABS_TTS_MODEL,
            voice_settings: {
              stability,
              similarity_boost: similarityBoost,
              style,
              speed,
              use_speaker_boost: speakerBoost,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ voiceId, status: response.status, error: errorText }, 'ElevenLabs TTS error');
        return reply.status(502).send({
          success: false,
          error: {
            code: 'TTS_GENERATION_FAILED',
            message: 'Failed to generate voice sample',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const audioBuffer = await response.arrayBuffer();

      logger.info({ voiceId, bytes: audioBuffer.byteLength }, 'Voice sample generated');

      // Return audio as MP3
      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Content-Length', audioBuffer.byteLength)
        .header('Cache-Control', 'public, max-age=3600') // Cache for 1 hour
        .send(Buffer.from(audioBuffer));
    } catch (error) {
      logger.error({ err: error, voiceId }, 'Failed to generate voice sample');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate voice sample',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * GET /voice/signed-url
   * Returns a signed WebSocket URL for ElevenLabs Conversational AI agent.
   * Requires authentication.
   */
  app.get('/signed-url', { preHandler: requireAuth }, async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Voice agent not configured',
          timestamp: new Date().toISOString(),
        },
      });
    }

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${ELEVENLABS_AGENT_ID}`,
        {
          method: 'GET',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Failed to get signed URL from ElevenLabs');
        return reply.status(502).send({
          success: false,
          error: {
            code: 'SIGNED_URL_FAILED',
            message: 'Failed to get voice agent signed URL',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const data = await response.json() as { signed_url: string };

      return reply.send({
        success: true,
        data: { signedUrl: data.signed_url },
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to get signed URL');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get voice agent signed URL',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });
}
