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

// Curated list of ElevenLabs voices suitable for companions
// These are pre-selected voices from ElevenLabs library
const AVAILABLE_VOICES = [
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Sarah',
    description: 'Soft, warm, and naturally alluring.',
    gender: 'feminine' as const,
  },
  {
    id: 'FGY2WhTYpPnrIDTdsKH5',
    name: 'Laura',
    description: 'Calm, soothing, with a hint of playfulness.',
    gender: 'feminine' as const,
  },
  {
    id: 'XB0fDUnXU5powFXDhCwa',
    name: 'Charlotte',
    description: 'Elegant, seductive, and confident.',
    gender: 'feminine' as const,
  },
  {
    id: 'pFZP5JQG7iQjIQuC4Bku',
    name: 'Lily',
    description: 'Sweet, youthful, and energetic.',
    gender: 'feminine' as const,
  },
  {
    id: 'cgSgspJ2msm6clMCkdW9',
    name: 'Jessica',
    description: 'Expressive, friendly, and engaging.',
    gender: 'feminine' as const,
  },
  {
    id: 'onwK4e9ZLuTAKqWW03F9',
    name: 'Daniel',
    description: 'Deep, resonant, and authoritative.',
    gender: 'masculine' as const,
  },
  {
    id: 'cjVigY5qzO86Huf0OWal',
    name: 'Eric',
    description: 'Smooth, charming, and sophisticated.',
    gender: 'masculine' as const,
  },
  {
    id: 'N2lVS1w4EtoT3dr4eOWO',
    name: 'Callum',
    description: 'Warm, intimate, and captivating.',
    gender: 'masculine' as const,
  },
  {
    id: 'IKne3meq5aSn9XLyUdCD',
    name: 'Charlie',
    description: 'Friendly, playful, and inviting.',
    gender: 'neutral' as const,
  },
  {
    id: 'JBFqnCBsd6RMkjVDRZzb',
    name: 'George',
    description: 'Rich, thoughtful, and comforting.',
    gender: 'masculine' as const,
  },
];

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
      return reply.send({
        success: true,
        data: {
          voices: AVAILABLE_VOICES,
        },
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

    // Verify the voice is in our curated list
    const voice = AVAILABLE_VOICES.find((v) => v.id === voiceId);
    if (!voice) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'VOICE_NOT_FOUND',
          message: 'Voice not found in available voices',
          timestamp: new Date().toISOString(),
        },
      });
    }

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
          voiceName: voice.name,
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

      logger.info({ voiceId, voiceName: voice.name, bytes: audioBuffer.byteLength }, 'Voice sample generated');

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
