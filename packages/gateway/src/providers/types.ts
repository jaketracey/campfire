/**
 * Provider interfaces for external AI services.
 * These define the contract that all provider implementations must follow.
 */

/**
 * Result of a streaming chunk from LLM
 */
export interface LLMStreamChunk {
  text: string;
  index: number;
  finishReason?: 'stop' | 'length' | 'content_filter' | null;
}

/**
 * LLM completion result
 */
export interface LLMCompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: 'stop' | 'length' | 'content_filter' | 'error';
  model: string;
  durationMs: number;
}

/**
 * LLM message format
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM completion options
 */
export interface LLMCompletionOptions {
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  userId?: string;
}

/**
 * LLM Provider Interface
 * Provides text generation capabilities
 */
export interface LLMProvider {
  readonly name: string;
  readonly models: readonly string[];

  /**
   * Generate a completion (non-streaming)
   */
  complete(options: LLMCompletionOptions): Promise<LLMCompletionResult>;

  /**
   * Generate a streaming completion
   */
  stream(options: LLMCompletionOptions): AsyncIterable<LLMStreamChunk>;

  /**
   * Count tokens for a given text
   */
  countTokens(text: string, model: string): Promise<number>;

  /**
   * Check if the provider is healthy
   */
  healthCheck(): Promise<boolean>;
}

/**
 * STT audio format configuration
 */
export interface STTAudioConfig {
  format: 'pcm16' | 'opus' | 'mp3' | 'wav';
  sampleRate: number;
  channels?: number;
}

/**
 * STT transcript result
 */
export interface STTTranscript {
  text: string;
  isFinal: boolean;
  confidence?: number;
  language?: string;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

/**
 * STT session options
 */
export interface STTSessionOptions {
  language?: string;
  model?: string;
  audioConfig: STTAudioConfig;
  interimResults?: boolean;
  punctuate?: boolean;
  profanityFilter?: boolean;
}

/**
 * STT streaming session
 */
export interface STTSession {
  readonly sessionId: string;

  /**
   * Send audio data to the session
   */
  sendAudio(data: Buffer): void;

  /**
   * Signal end of audio stream
   */
  endAudio(): void;

  /**
   * Subscribe to transcript events
   */
  onTranscript(callback: (transcript: STTTranscript) => void): void;

  /**
   * Subscribe to error events
   */
  onError(callback: (error: Error) => void): void;

  /**
   * Close the session
   */
  close(): Promise<void>;
}

/**
 * STT Provider Interface
 * Provides speech-to-text capabilities
 */
export interface STTProvider {
  readonly name: string;
  readonly supportedLanguages: readonly string[];

  /**
   * Create a streaming transcription session
   */
  createSession(options: STTSessionOptions): Promise<STTSession>;

  /**
   * Transcribe a complete audio file (non-streaming)
   */
  transcribe(audio: Buffer, options: STTSessionOptions): Promise<STTTranscript>;

  /**
   * Check if the provider is healthy
   */
  healthCheck(): Promise<boolean>;
}

/**
 * TTS voice configuration
 */
export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  style?: string;
}

/**
 * TTS synthesis options
 */
export interface TTSSynthesisOptions {
  voiceId: string;
  text: string;
  format?: 'mp3' | 'wav' | 'opus' | 'pcm16';
  sampleRate?: number;
  speed?: number;
  pitch?: number;
}

/**
 * TTS audio chunk
 */
export interface TTSAudioChunk {
  data: Buffer;
  index: number;
  isFinal: boolean;
}

/**
 * TTS synthesis result
 */
export interface TTSSynthesisResult {
  audio: Buffer;
  format: string;
  sampleRate: number;
  durationMs: number;
}

/**
 * TTS Provider Interface
 * Provides text-to-speech capabilities
 */
export interface TTSProvider {
  readonly name: string;
  readonly voices: readonly TTSVoice[];

  /**
   * Synthesize text to audio (non-streaming)
   */
  synthesize(options: TTSSynthesisOptions): Promise<TTSSynthesisResult>;

  /**
   * Synthesize text to audio with streaming output
   */
  stream(options: TTSSynthesisOptions): AsyncIterable<TTSAudioChunk>;

  /**
   * Get available voices
   */
  getVoices(): Promise<TTSVoice[]>;

  /**
   * Check if the provider is healthy
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Image generation options
 */
export interface ImageGenOptions {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  model?: string;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  style?: string;
}

/**
 * Generated image result
 */
export interface ImageGenResult {
  id: string;
  url: string;
  base64?: string;
  width: number;
  height: number;
  prompt: string;
  revisedPrompt?: string;
  durationMs: number;
}

/**
 * Image Generation Provider Interface
 * Provides image generation capabilities
 */
export interface ImageGenProvider {
  readonly name: string;
  readonly models: readonly string[];

  /**
   * Generate an image from a text prompt
   */
  generate(options: ImageGenOptions): Promise<ImageGenResult>;

  /**
   * Generate multiple images
   */
  generateBatch(options: ImageGenOptions, count: number): Promise<ImageGenResult[]>;

  /**
   * Check if the provider is healthy
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Provider registry for managing multiple provider implementations
 */
export interface ProviderRegistry {
  getLLMProvider(name?: string): LLMProvider;
  getSTTProvider(name?: string): STTProvider;
  getTTSProvider(name?: string): TTSProvider;
  getImageGenProvider(name?: string): ImageGenProvider;

  registerLLMProvider(provider: LLMProvider): void;
  registerSTTProvider(provider: STTProvider): void;
  registerTTSProvider(provider: TTSProvider): void;
  registerImageGenProvider(provider: ImageGenProvider): void;
}
