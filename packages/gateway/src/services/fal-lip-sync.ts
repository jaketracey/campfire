/**
 * FAL Lip-Sync Service
 * Generates lip-synced avatar videos by combining ElevenLabs TTS audio
 * with FAL's live-avatar model.
 *
 * Flow: text -> TTS audio -> upload to FAL storage -> live-avatar -> video URL
 */

import { logger } from '../observability/logger.js';

interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
}

interface LiveAvatarResult {
  video: { url: string };
  duration?: number;
}

interface FalQueueResponse {
  request_id: string;
  status: string;
}

interface FalStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  error?: string;
}

export class FalLipSyncService {
  private falApiKey: string;
  private elevenLabsApiKey: string;

  constructor(falApiKey: string, elevenLabsApiKey: string) {
    this.falApiKey = falApiKey;
    this.elevenLabsApiKey = elevenLabsApiKey;
  }

  /**
   * Generate a lip-synced video from text, a voice, and a companion image.
   */
  async generateLipSyncVideo(
    text: string,
    voiceId: string,
    companionImageUrl: string,
    voiceSettings?: VoiceSettings
  ): Promise<{ videoUrl: string; durationSeconds: number }> {
    const startTime = Date.now();

    // 1. Generate TTS audio from text
    logger.info({ voiceId, textLength: text.length }, 'Generating TTS audio for lip-sync');
    const mp3Buffer = await this.generateTTS(text, voiceId, voiceSettings);
    const ttsMs = Date.now() - startTime;
    logger.info({ voiceId, mp3Bytes: mp3Buffer.byteLength, ttsMs }, 'TTS audio generated');

    // 2. Upload MP3 to FAL storage
    const uploadStart = Date.now();
    const audioUrl = await this.uploadToFalStorage(mp3Buffer);
    const uploadMs = Date.now() - uploadStart;
    logger.info({ audioUrl, uploadMs }, 'Audio uploaded to FAL storage');

    // 3. Submit to live-avatar and poll for result
    const avatarStart = Date.now();
    const result = await this.submitLiveAvatar(companionImageUrl, audioUrl);
    const avatarMs = Date.now() - avatarStart;

    const totalMs = Date.now() - startTime;
    logger.info(
      { videoUrl: result.video.url, duration: result.duration, ttsMs, uploadMs, avatarMs, totalMs },
      'Lip-sync video generated'
    );

    return {
      videoUrl: result.video.url,
      durationSeconds: result.duration ?? 0,
    };
  }

  /**
   * Generate TTS audio via ElevenLabs API.
   * Returns raw MP3 buffer.
   */
  async generateTTS(
    text: string,
    voiceId: string,
    settings?: VoiceSettings
  ): Promise<Buffer> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.elevenLabsApiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: settings?.stability ?? 0.35,
            similarity_boost: settings?.similarity_boost ?? 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText, voiceId }, 'ElevenLabs TTS failed');
      throw new Error(`ElevenLabs TTS failed: ${response.status} ${errorText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Upload an MP3 buffer to FAL storage and return the public URL.
   */
  async uploadToFalStorage(mp3Buffer: Buffer): Promise<string> {
    // FAL expects a PUT to their storage upload endpoint
    const response = await fetch('https://fal.run/api/storage/upload/v3', {
      method: 'PUT',
      headers: {
        Authorization: `Key ${this.falApiKey}`,
        'Content-Type': 'audio/mpeg',
      },
      body: mp3Buffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'FAL storage upload failed');
      throw new Error(`FAL storage upload failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { url: string };
    return data.url;
  }

  /**
   * Submit a live-avatar job to FAL queue and poll until completion.
   */
  async submitLiveAvatar(
    imageUrl: string,
    audioUrl: string
  ): Promise<LiveAvatarResult> {
    // Submit to queue
    const submitResponse = await fetch('https://queue.fal.run/fal-ai/live-avatar', {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.falApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        audio_url: audioUrl,
        num_clips: 1,
        acceleration: 'high',
      }),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      logger.error({ status: submitResponse.status, error: errorText }, 'FAL live-avatar submit failed');
      throw new Error(`FAL live-avatar submit failed: ${submitResponse.status} ${errorText}`);
    }

    const queueData = (await submitResponse.json()) as FalQueueResponse;
    const requestId = queueData.request_id;
    logger.info({ requestId }, 'FAL live-avatar job submitted');

    // Poll for completion (max 120 seconds, poll every 2s)
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(2000);

      const statusResponse = await fetch(
        `https://queue.fal.run/fal-ai/live-avatar/requests/${requestId}/status`,
        {
          method: 'GET',
          headers: {
            Authorization: `Key ${this.falApiKey}`,
          },
        }
      );

      if (!statusResponse.ok) {
        logger.warn(
          { status: statusResponse.status, requestId, attempt: i },
          'FAL status poll failed, retrying'
        );
        continue;
      }

      const statusData = (await statusResponse.json()) as FalStatusResponse;

      if (statusData.status === 'COMPLETED') {
        // Fetch the result
        const resultResponse = await fetch(
          `https://queue.fal.run/fal-ai/live-avatar/requests/${requestId}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Key ${this.falApiKey}`,
            },
          }
        );

        if (!resultResponse.ok) {
          const errorText = await resultResponse.text();
          throw new Error(`FAL live-avatar result fetch failed: ${resultResponse.status} ${errorText}`);
        }

        return (await resultResponse.json()) as LiveAvatarResult;
      }

      if (statusData.status === 'FAILED') {
        throw new Error(`FAL live-avatar job failed: ${statusData.error || 'unknown error'}`);
      }

      logger.debug({ requestId, status: statusData.status, attempt: i }, 'FAL live-avatar polling');
    }

    throw new Error(`FAL live-avatar job timed out after ${maxAttempts * 2}s`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance cache
let instance: FalLipSyncService | null = null;

export function getFalLipSyncService(falApiKey: string, elevenLabsApiKey: string): FalLipSyncService {
  if (!instance) {
    instance = new FalLipSyncService(falApiKey, elevenLabsApiKey);
  }
  return instance;
}
