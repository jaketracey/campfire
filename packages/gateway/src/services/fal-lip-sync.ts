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
    // Upload directly to S3 — FAL can read public S3 URLs
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const key = `companions/lip-sync-audio/${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;
    const bucket = process.env.S3_MEDIA_BUCKET;
    if (!bucket) throw new Error('No S3_MEDIA_BUCKET configured');

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: mp3Buffer,
      ContentType: 'audio/mpeg',
    }));

    const url = `https://${bucket}.s3.amazonaws.com/${key}`;
    logger.info({ url, sizeBytes: mp3Buffer.length }, 'Audio uploaded to S3');
    return url;
  }

  /**
   * Submit a live-avatar job to FAL queue and poll until completion.
   */
  async submitLiveAvatar(
    imageUrl: string,
    audioUrl: string
  ): Promise<LiveAvatarResult> {
    // Submit to queue
    const submitResponse = await fetch('https://queue.fal.run/fal-ai/sadtalker', {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.falApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_image_url: imageUrl,
        driven_audio_url: audioUrl,
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
        `https://queue.fal.run/fal-ai/sadtalker/requests/${requestId}/status`,
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
          `https://queue.fal.run/fal-ai/sadtalker/requests/${requestId}`,
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

  /**
   * Generate a lip-synced video from pre-recorded PCM audio chunks (base64)
   * and a companion image. Skips TTS entirely — uses the exact audio the
   * ConvAI agent already played to the user.
   */
  async generateFromAudio(
    pcmBase64Chunks: string[],
    sampleRate: number,
    companionImageUrl: string,
  ): Promise<{ videoUrl: string; durationSeconds: number }> {
    const startTime = Date.now();

    // 1. Decode and concatenate PCM chunks
    const pcmBuffers = pcmBase64Chunks.map(chunk => Buffer.from(chunk, 'base64'));
    const pcmData = Buffer.concat(pcmBuffers);
    logger.info(
      { chunks: pcmBase64Chunks.length, pcmBytes: pcmData.length, sampleRate },
      'Assembling PCM audio for lip-sync'
    );

    // 2. Convert to WAV
    const wavBuffer = this.pcmToWav(pcmData, sampleRate, 1);

    // 3. Upload to S3
    const uploadStart = Date.now();
    const audioUrl = await this.uploadWavToS3(wavBuffer);
    const uploadMs = Date.now() - uploadStart;
    logger.info({ audioUrl, uploadMs }, 'WAV audio uploaded to S3');

    // 4. Submit to live-avatar and poll for result
    const avatarStart = Date.now();
    const result = await this.submitLiveAvatar(companionImageUrl, audioUrl);
    const avatarMs = Date.now() - avatarStart;

    const totalMs = Date.now() - startTime;
    logger.info(
      { videoUrl: result.video.url, duration: result.duration, uploadMs, avatarMs, totalMs },
      'Lip-sync video generated from audio chunks'
    );

    return {
      videoUrl: result.video.url,
      durationSeconds: result.duration ?? 0,
    };
  }

  /**
   * Convert raw PCM 16-bit data to a WAV file buffer by prepending the
   * standard 44-byte RIFF/WAVE header.
   */
  pcmToWav(pcmData: Buffer, sampleRate: number, channels: number): Buffer {
    const byteRate = sampleRate * channels * 2; // 16-bit = 2 bytes per sample
    const blockAlign = channels * 2;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmData.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);           // subchunk1 size (PCM)
    header.writeUInt16LE(1, 20);            // audio format: PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);           // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(pcmData.length, 40);
    return Buffer.concat([header, pcmData]);
  }

  /**
   * Upload a WAV buffer to S3 and return the public URL.
   */
  private async uploadWavToS3(wavBuffer: Buffer): Promise<string> {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const key = `companions/lip-sync-audio/${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;
    const bucket = process.env.S3_MEDIA_BUCKET;
    if (!bucket) throw new Error('No S3_MEDIA_BUCKET configured');

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: wavBuffer,
      ContentType: 'audio/wav',
    }));

    const url = `https://${bucket}.s3.amazonaws.com/${key}`;
    logger.info({ url, sizeBytes: wavBuffer.length }, 'WAV uploaded to S3');
    return url;
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
