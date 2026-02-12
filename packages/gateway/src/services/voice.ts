/**
 * Voice Service
 * Handles ElevenLabs STT (speech-to-text) and TTS (text-to-speech) integration.
 * STT uses the official @elevenlabs/elevenlabs-js SDK for realtime transcription.
 */

import {
  ElevenLabsClient,
  RealtimeConnection,
  RealtimeEvents,
  AudioFormat,
  CommitStrategy,
} from '@elevenlabs/elevenlabs-js';
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
  connection: RealtimeConnection | null;
  isConnected: boolean;
  onTranscription: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  pendingAudioChunks: string[];
  pendingCommit: boolean;
}

export interface TTSOptions {
  voiceId: string;
  tuning?: VoiceTuning;
  model?: string;
  outputFormat?: string;
}

// ============================================================================
// ElevenLabs Client Singleton
// ============================================================================

let elevenLabsClient: ElevenLabsClient | null = null;

function getElevenLabsClient(): ElevenLabsClient {
  if (!elevenLabsClient) {
    elevenLabsClient = new ElevenLabsClient({
      apiKey: ELEVENLABS_API_KEY,
    });
  }
  return elevenLabsClient;
}

// ============================================================================
// Voice Service Implementation
// ============================================================================

export class VoiceService {
  private sttSessions = new Map<string, STTSession>();

  /**
   * Start a new STT (speech-to-text) session using ElevenLabs SDK
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

    // Close existing session if any (synchronous to avoid yielding)
    this.stopSTTSession(clientId);

    // Register session in map BEFORE async connect to allow audio buffering
    const session: STTSession = {
      connection: null,
      isConnected: false,
      onTranscription,
      onError,
      pendingAudioChunks: [],
      pendingCommit: false,
    };
    this.sttSessions.set(clientId, session);

    try {
      const client = getElevenLabsClient();

      logger.info({ clientId, model: ELEVENLABS_STT_MODEL }, 'Starting STT session');

      const connection = await client.speechToText.realtime.connect({
        modelId: ELEVENLABS_STT_MODEL,
        audioFormat: AudioFormat.PCM_16000,
        sampleRate: 16000,
        languageCode: 'en',
        commitStrategy: CommitStrategy.MANUAL,
      });

      // Check if session was replaced while we were connecting
      if (this.sttSessions.get(clientId) !== session) {
        logger.info({ clientId }, 'STT session replaced during connect, closing new connection');
        connection.close();
        return false;
      }

      session.connection = connection;
      session.isConnected = true;

      logger.info({ clientId, bufferedChunks: session.pendingAudioChunks.length }, 'STT session connected');

      // Set up event handlers
      connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
        const text = data.text || '';
        if (text) {
          onTranscription(text, false);
        }
      });

      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
        const text = data.text || '';
        logger.info({ clientId, text: text.substring(0, 80) }, 'STT committed transcript');
        onTranscription(text, true);
      });

      connection.on(RealtimeEvents.ERROR, (error) => {
        if ('message_type' in error) {
          logger.error({ clientId, type: error.message_type, error: error.error }, 'STT server error');
          onError(error.error || 'STT error');
        } else {
          logger.error({ clientId, err: error }, 'STT WebSocket error');
          onError(error.message || 'STT error');
        }
      });

      connection.on(RealtimeEvents.CLOSE, () => {
        logger.info({ clientId }, 'STT session closed');
        // Only delete from map if this session is still the current one
        if (this.sttSessions.get(clientId) === session) {
          this.sttSessions.delete(clientId);
        }
      });

      // Flush any buffered audio chunks that arrived before connection
      for (const chunk of session.pendingAudioChunks) {
        connection.send({ audioBase64: chunk });
      }
      if (session.pendingAudioChunks.length > 0) {
        logger.info({ clientId, flushed: session.pendingAudioChunks.length }, 'Flushed buffered audio chunks');
      }
      session.pendingAudioChunks = [];

      // If commit was requested before connection, commit now
      if (session.pendingCommit) {
        connection.commit();
        session.pendingCommit = false;
      }

      return true;
    } catch (err) {
      logger.error({ clientId, err }, 'Failed to start STT session');
      // Clean up the session we registered
      if (this.sttSessions.get(clientId) === session) {
        this.sttSessions.delete(clientId);
      }
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
      logger.info({ clientId, isConnected: session.isConnected, dataLen: base64AudioData.length }, 'sendAudioToSTT called');

      if (!session.isConnected || !session.connection) {
        // Buffer audio until connection is ready
        session.pendingAudioChunks.push(base64AudioData);
        logger.info({ clientId, buffered: session.pendingAudioChunks.length }, 'Buffered audio chunk (connecting)');
        return true;
      }

      // Send audio via SDK
      session.connection.send({ audioBase64: base64AudioData });
      return true;
    } catch (err) {
      logger.error({ clientId, err }, 'Failed to send audio to STT');
      return false;
    }
  }

  /**
   * Signal end of audio input — commits the transcription
   */
  endSTTAudio(clientId: string): boolean {
    const session = this.sttSessions.get(clientId);

    if (!session) {
      return false;
    }

    if (!session.isConnected || !session.connection) {
      // Buffer commit signal until connection is ready
      session.pendingCommit = true;
      return true;
    }

    try {
      session.connection.commit();
      return true;
    } catch (err) {
      logger.error({ clientId, err }, 'Failed to commit STT audio');
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
        if (session.connection) {
          session.connection.close();
        }
      } catch (err) {
        logger.warn({ clientId, err }, 'Error closing STT session');
      }
      this.sttSessions.delete(clientId);
    }
  }

  /**
   * Synthesize text to speech using HTTP streaming
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
