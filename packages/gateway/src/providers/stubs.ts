/**
 * Stub implementations of provider interfaces.
 * These are placeholder implementations that throw errors or return mock data.
 * Replace with real implementations when integrating with actual services.
 */

import type {
  LLMProvider,
  LLMCompletionOptions,
  LLMCompletionResult,
  LLMStreamChunk,
  STTProvider,
  STTSession,
  STTSessionOptions,
  STTTranscript,
  TTSProvider,
  TTSVoice,
  TTSSynthesisOptions,
  TTSSynthesisResult,
  TTSAudioChunk,
  ImageGenProvider,
  ImageGenOptions,
  ImageGenResult,
} from './types.js';

/**
 * Stub LLM Provider
 */
export class StubLLMProvider implements LLMProvider {
  readonly name = 'stub';
  readonly models = ['stub-model'] as const;

  async complete(options: LLMCompletionOptions): Promise<LLMCompletionResult> {
    const startTime = Date.now();
    // Simulate some latency
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      text: `[STUB] Response to: ${options.messages.at(-1)?.content?.slice(0, 50) ?? 'empty'}...`,
      inputTokens: 10,
      outputTokens: 20,
      finishReason: 'stop',
      model: options.model,
      durationMs: Date.now() - startTime,
    };
  }

  async *stream(options: LLMCompletionOptions): AsyncIterable<LLMStreamChunk> {
    const words = `[STUB] Streaming response to: ${options.messages.at(-1)?.content?.slice(0, 30) ?? 'empty'}`.split(' ');

    for (let i = 0; i < words.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield {
        text: (i === 0 ? '' : ' ') + words[i],
        index: i,
        finishReason: i === words.length - 1 ? 'stop' : null,
      };
    }
  }

  async countTokens(text: string, _model: string): Promise<number> {
    // Rough approximation: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * Stub STT Session
 */
class StubSTTSession implements STTSession {
  readonly sessionId: string;
  private transcriptCallback?: (transcript: STTTranscript) => void;
  private errorCallback?: (error: Error) => void;
  private audioBuffer: Buffer[] = [];
  private closed = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  sendAudio(data: Buffer): void {
    if (this.closed) {
      this.errorCallback?.(new Error('Session is closed'));
      return;
    }
    this.audioBuffer.push(data);

    // Simulate interim results periodically
    if (this.audioBuffer.length % 5 === 0 && this.transcriptCallback) {
      this.transcriptCallback({
        text: '[STUB] Processing audio...',
        isFinal: false,
        confidence: 0.8,
      });
    }
  }

  endAudio(): void {
    if (this.closed) return;

    // Simulate final transcript
    setTimeout(() => {
      this.transcriptCallback?.({
        text: '[STUB] Final transcription of audio input',
        isFinal: true,
        confidence: 0.95,
        language: 'en-US',
      });
    }, 100);
  }

  onTranscript(callback: (transcript: STTTranscript) => void): void {
    this.transcriptCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.audioBuffer = [];
  }
}

/**
 * Stub STT Provider
 */
export class StubSTTProvider implements STTProvider {
  readonly name = 'stub';
  readonly supportedLanguages = ['en-US', 'en-GB', 'es-ES'] as const;

  private sessionCounter = 0;

  async createSession(_options: STTSessionOptions): Promise<STTSession> {
    const sessionId = `stub-stt-${++this.sessionCounter}`;
    return new StubSTTSession(sessionId);
  }

  async transcribe(_audio: Buffer, _options: STTSessionOptions): Promise<STTTranscript> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      text: '[STUB] Transcription of uploaded audio',
      isFinal: true,
      confidence: 0.92,
      language: 'en-US',
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * Stub TTS Provider
 */
export class StubTTSProvider implements TTSProvider {
  readonly name = 'stub';
  readonly voices: readonly TTSVoice[] = [
    { id: 'stub-voice-1', name: 'Stub Voice 1', language: 'en-US', gender: 'female' },
    { id: 'stub-voice-2', name: 'Stub Voice 2', language: 'en-US', gender: 'male' },
  ];

  async synthesize(options: TTSSynthesisOptions): Promise<TTSSynthesisResult> {
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Generate a small silent audio buffer as placeholder
    const sampleRate = options.sampleRate ?? 24000;
    const durationMs = Math.min(options.text.length * 50, 5000);
    const samples = Math.floor((sampleRate * durationMs) / 1000);
    const audio = Buffer.alloc(samples * 2); // 16-bit PCM

    return {
      audio,
      format: options.format ?? 'pcm16',
      sampleRate,
      durationMs,
    };
  }

  async *stream(options: TTSSynthesisOptions): AsyncIterable<TTSAudioChunk> {
    const chunkCount = Math.ceil(options.text.length / 20);
    const chunkSize = 4096;

    for (let i = 0; i < chunkCount; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield {
        data: Buffer.alloc(chunkSize),
        index: i,
        isFinal: i === chunkCount - 1,
      };
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    return [...this.voices];
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * Stub Image Generation Provider
 */
export class StubImageGenProvider implements ImageGenProvider {
  readonly name = 'stub';
  readonly models = ['stub-image-model'] as const;

  private imageCounter = 0;

  async generate(options: ImageGenOptions): Promise<ImageGenResult> {
    const startTime = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      id: `stub-image-${++this.imageCounter}`,
      url: `https://placeholder.example.com/image/${this.imageCounter}.png`,
      width: options.width ?? 1024,
      height: options.height ?? 1024,
      prompt: options.prompt,
      revisedPrompt: `[STUB] ${options.prompt}`,
      durationMs: Date.now() - startTime,
    };
  }

  async generateBatch(options: ImageGenOptions, count: number): Promise<ImageGenResult[]> {
    const results: ImageGenResult[] = [];
    for (let i = 0; i < count; i++) {
      results.push(await this.generate(options));
    }
    return results;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
