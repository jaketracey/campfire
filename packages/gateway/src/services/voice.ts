/**
 * Voice Service
 * Handles ElevenLabs STT (speech-to-text) and TTS (text-to-speech) integration.
 */

import WebSocketLib from 'ws';
import type { WebSocket as WebSocketType } from 'ws';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';

// ElevenLabs API configuration
const ELEVENLABS_API_KEY = env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_STT_MODEL = env.ELEVENLABS_STT_MODEL || 'scribe_v2_realtime';
const ELEVENLABS_TTS_MODEL = env.ELEVENLABS_TTS_MODEL || 'eleven_turbo_v2_5';

// ============================================================================
// Types
// ============================================================================

export interface VoiceTuning {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export interface STTSession {
  ws: WebSocketType;
  isConnected: boolean;
  onTranscription: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  pendingAudioChunks: string[];
  pendingEnd: boolean;
}

export interface TTSOptions {
  voiceId: string;
  tuning?: VoiceTuning;
  model?: string;
  outputFormat?: string;
}

// ============================================================================
// Voice Service Implementation
// ============================================================================

export class VoiceService {
  private sttSessions = new Map<string, STTSession>();

  /**
   * Start a new STT (speech-to-text) session
   */
  async startSTTSession(
    clientId: string,
    onTranscription: (text: string, isFinal: boolean) => void,
    onError: (error: string) => void
  ): Promise<boolean> {
    if (!ELEVENLABS_API_KEY) {
      logger.error('ELEVENLABS_API_KEY not configured');
      onError('Voice service not configured');
      return false;
    }

    // Close existing session if any (synchronous — no await to avoid yielding
    // to the event loop before the new session is registered in the map)
    this.stopSTTSession(clientId);

    try {
      const wsUrl = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=${ELEVENLABS_STT_MODEL}`;

      const ws = new WebSocketLib(wsUrl, {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
        },
      });

      const session: STTSession = {
        ws: ws as unknown as WebSocketType,
        isConnected: false,
        onTranscription,
        onError,
        pendingAudioChunks: [],
        pendingEnd: false,
      };

      ws.on('open', () => {
        session.isConnected = true;
        logger.info({ clientId, bufferedChunks: session.pendingAudioChunks.length }, 'STT session connected');

        // Send initial configuration
        ws.send(
          JSON.stringify({
            type: 'config',
            sample_rate: 16000,
            encoding: 'pcm_s16le',
            language: 'en',
          })
        );

        // Flush any buffered audio chunks that arrived before connection
        for (const chunk of session.pendingAudioChunks) {
          ws.send(
            JSON.stringify({
              type: 'audio',
              data: chunk,
            })
          );
        }
        session.pendingAudioChunks = [];

        // If voice_end arrived before connection, send end signal now
        if (session.pendingEnd) {
          ws.send(JSON.stringify({ type: 'end' }));
          session.pendingEnd = false;
        }
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'transcript') {
            const text = message.transcript || '';
            const isFinal = message.is_final || false;
            onTranscription(text, isFinal);
          } else if (message.type === 'error') {
            logger.error({ clientId, error: message }, 'STT error');
            onError(message.message || 'STT error');
          }
        } catch (err) {
          logger.error({ clientId, err }, 'Failed to parse STT message');
        }
      });

      ws.on('error', (err) => {
        logger.error({ clientId, err }, 'STT WebSocket error');
        onError(err.message);
      });

      ws.on('close', (code, reason) => {
        session.isConnected = false;
        logger.info({ clientId, code, reason: reason.toString() }, 'STT session closed');
        this.sttSessions.delete(clientId);
      });

      this.sttSessions.set(clientId, session);
      return true;
    } catch (err) {
      logger.error({ clientId, err }, 'Failed to start STT session');
      onError(err instanceof Error ? err.message : 'Failed to start STT');
      return false;
    }
  }

  /**
   * Send audio chunk to STT session
   */
  sendAudioToSTT(clientId: string, base64AudioData: string): boolean {
    const session = this.sttSessions.get(clientId);

    if (!session) {
      logger.warn({ clientId }, 'No STT session found for audio chunk — dropped');
      return false;
    }

    try {
      // Decode base64 to buffer
      const audioBuffer = Buffer.from(base64AudioData, 'base64');
      const chunk = audioBuffer.toString('base64');

      if (!session.isConnected) {
        // Buffer audio until WS connects
        session.pendingAudioChunks.push(chunk);
        logger.debug({ clientId, buffered: session.pendingAudioChunks.length }, 'Buffered audio chunk (WS connecting)');
        return true;
      }

      // Send audio chunk
      session.ws.send(
        JSON.stringify({
          type: 'audio',
          data: chunk,
        })
      );

      return true;
    } catch (err) {
      logger.error({ clientId, err }, 'Failed to send audio to STT');
      return false;
    }
  }

  /**
   * Signal end of audio input to STT session
   */
  endSTTAudio(clientId: string): boolean {
    const session = this.sttSessions.get(clientId);

    if (!session) {
      return false;
    }

    if (!session.isConnected) {
      // Buffer end signal until WS connects
      session.pendingEnd = true;
      return true;
    }

    try {
      session.ws.send(JSON.stringify({ type: 'end' }));
      return true;
    } catch (err) {
      logger.error({ clientId, err }, 'Failed to end STT audio');
      return false;
    }
  }

  /**
   * Check if an STT session exists for a client
   */
  hasSTTSession(clientId: string): boolean {
    return this.sttSessions.has(clientId);
  }

  /**
   * Stop STT session
   */
  async stopSTTSession(clientId: string): Promise<void> {
    const session = this.sttSessions.get(clientId);

    if (session) {
      try {
        if (session.ws.readyState === WebSocketLib.OPEN) {
          session.ws.close(1000, 'Session ended');
        }
      } catch (err) {
        logger.warn({ clientId, err }, 'Error closing STT session');
      }
      this.sttSessions.delete(clientId);
    }
  }

  /**
   * Synthesize text to speech and stream audio chunks
   */
  async synthesizeTTS(
    text: string,
    options: TTSOptions,
    onChunk: (data: Buffer, format: string) => void,
    onEnd: () => void,
    onError: (error: string) => void
  ): Promise<void> {
    if (!ELEVENLABS_API_KEY) {
      logger.error('ELEVENLABS_API_KEY not configured');
      onError('Voice service not configured');
      return;
    }

    const {
      voiceId,
      tuning = {},
      model = ELEVENLABS_TTS_MODEL,
      outputFormat = 'mp3_44100_128',
    } = options;

    try {
      const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}&output_format=${outputFormat}`;

      const ws = new WebSocketLib(wsUrl, {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
        },
      });

      ws.on('open', () => {
        logger.debug({ voiceId, model }, 'TTS WebSocket connected');

        // Send initial configuration with voice settings
        ws.send(
          JSON.stringify({
            text: ' ',
            voice_settings: {
              stability: tuning.stability ?? 0.5,
              similarity_boost: tuning.similarityBoost ?? 0.75,
              style: tuning.style ?? 0,
              use_speaker_boost: tuning.useSpeakerBoost ?? true,
            },
            generation_config: {
              chunk_length_schedule: [120, 160, 250, 290],
            },
            xi_api_key: ELEVENLABS_API_KEY,
          })
        );

        // Send the actual text
        ws.send(
          JSON.stringify({
            text,
            try_trigger_generation: true,
          })
        );

        // Signal end of input
        ws.send(JSON.stringify({ text: '' }));
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.audio) {
            // Decode base64 audio and send chunk
            const audioBuffer = Buffer.from(message.audio, 'base64');
            onChunk(audioBuffer, 'mp3');
          }

          if (message.isFinal) {
            onEnd();
            ws.close();
          }
        } catch {
          // Binary audio data
          if (data.length > 0) {
            onChunk(data, 'mp3');
          }
        }
      });

      ws.on('error', (err) => {
        logger.error({ voiceId, err }, 'TTS WebSocket error');
        onError(err.message);
      });

      ws.on('close', () => {
        logger.debug({ voiceId }, 'TTS WebSocket closed');
        onEnd();
      });
    } catch (err) {
      logger.error({ voiceId, err }, 'Failed to start TTS');
      onError(err instanceof Error ? err.message : 'Failed to start TTS');
    }
  }

  /**
   * Synthesize text to speech using HTTP streaming (alternative to WebSocket)
   */
  async synthesizeTTSStream(
    text: string,
    options: TTSOptions,
    onChunk: (data: Buffer, format: string) => void,
    onEnd: () => void,
    onError: (error: string) => void
  ): Promise<void> {
    if (!ELEVENLABS_API_KEY) {
      logger.error('ELEVENLABS_API_KEY not configured');
      onError('Voice service not configured');
      return;
    }

    const {
      voiceId,
      tuning = {},
      model = ELEVENLABS_TTS_MODEL,
      outputFormat = 'mp3_44100_128',
    } = options;

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY,
          },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: {
              stability: tuning.stability ?? 0.5,
              similarity_boost: tuning.similarityBoost ?? 0.75,
              style: tuning.style ?? 0,
              use_speaker_boost: tuning.useSpeakerBoost ?? true,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ voiceId, status: response.status, error: errorText }, 'TTS HTTP error');
        onError(`TTS failed: ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response body');
        return;
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          onChunk(Buffer.from(value), 'mp3');
        }
      } finally {
        reader.releaseLock();
        onEnd();
      }
    } catch (err) {
      logger.error({ voiceId, err }, 'Failed TTS stream');
      onError(err instanceof Error ? err.message : 'TTS stream failed');
    }
  }

  /**
   * Cleanup all sessions
   */
  async cleanup(): Promise<void> {
    const clientIds = Array.from(this.sttSessions.keys());
    for (const clientId of clientIds) {
      await this.stopSTTSession(clientId);
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let voiceServiceInstance: VoiceService | null = null;

export function getVoiceService(): VoiceService {
  if (!voiceServiceInstance) {
    voiceServiceInstance = new VoiceService();
  }
  return voiceServiceInstance;
}
