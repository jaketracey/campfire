/**
 * Provider Registry
 * Manages provider instances and provides access to them by name.
 */

import type {
  ProviderRegistry,
  LLMProvider,
  STTProvider,
  TTSProvider,
  ImageGenProvider,
} from './types.js';
import {
  StubLLMProvider,
  StubSTTProvider,
  StubTTSProvider,
  StubImageGenProvider,
} from './stubs.js';
import { logger } from '../observability/logger.js';

/**
 * Default provider registry implementation
 */
export class DefaultProviderRegistry implements ProviderRegistry {
  private llmProviders = new Map<string, LLMProvider>();
  private sttProviders = new Map<string, STTProvider>();
  private ttsProviders = new Map<string, TTSProvider>();
  private imageGenProviders = new Map<string, ImageGenProvider>();

  private defaultLLM = 'stub';
  private defaultSTT = 'stub';
  private defaultTTS = 'stub';
  private defaultImageGen = 'stub';

  constructor() {
    // Register stub providers as defaults
    this.registerLLMProvider(new StubLLMProvider());
    this.registerSTTProvider(new StubSTTProvider());
    this.registerTTSProvider(new StubTTSProvider());
    this.registerImageGenProvider(new StubImageGenProvider());

    logger.info('Provider registry initialized with stub providers');
  }

  getLLMProvider(name?: string): LLMProvider {
    const providerName = name ?? this.defaultLLM;
    const provider = this.llmProviders.get(providerName);
    if (!provider) {
      throw new Error(`LLM provider not found: ${providerName}`);
    }
    return provider;
  }

  getSTTProvider(name?: string): STTProvider {
    const providerName = name ?? this.defaultSTT;
    const provider = this.sttProviders.get(providerName);
    if (!provider) {
      throw new Error(`STT provider not found: ${providerName}`);
    }
    return provider;
  }

  getTTSProvider(name?: string): TTSProvider {
    const providerName = name ?? this.defaultTTS;
    const provider = this.ttsProviders.get(providerName);
    if (!provider) {
      throw new Error(`TTS provider not found: ${providerName}`);
    }
    return provider;
  }

  getImageGenProvider(name?: string): ImageGenProvider {
    const providerName = name ?? this.defaultImageGen;
    const provider = this.imageGenProviders.get(providerName);
    if (!provider) {
      throw new Error(`ImageGen provider not found: ${providerName}`);
    }
    return provider;
  }

  registerLLMProvider(provider: LLMProvider): void {
    this.llmProviders.set(provider.name, provider);
    logger.debug({ provider: provider.name }, 'Registered LLM provider');
  }

  registerSTTProvider(provider: STTProvider): void {
    this.sttProviders.set(provider.name, provider);
    logger.debug({ provider: provider.name }, 'Registered STT provider');
  }

  registerTTSProvider(provider: TTSProvider): void {
    this.ttsProviders.set(provider.name, provider);
    logger.debug({ provider: provider.name }, 'Registered TTS provider');
  }

  registerImageGenProvider(provider: ImageGenProvider): void {
    this.imageGenProviders.set(provider.name, provider);
    logger.debug({ provider: provider.name }, 'Registered ImageGen provider');
  }

  /**
   * Set the default LLM provider
   */
  setDefaultLLM(name: string): void {
    if (!this.llmProviders.has(name)) {
      throw new Error(`LLM provider not found: ${name}`);
    }
    this.defaultLLM = name;
  }

  /**
   * Set the default STT provider
   */
  setDefaultSTT(name: string): void {
    if (!this.sttProviders.has(name)) {
      throw new Error(`STT provider not found: ${name}`);
    }
    this.defaultSTT = name;
  }

  /**
   * Set the default TTS provider
   */
  setDefaultTTS(name: string): void {
    if (!this.ttsProviders.has(name)) {
      throw new Error(`TTS provider not found: ${name}`);
    }
    this.defaultTTS = name;
  }

  /**
   * Set the default ImageGen provider
   */
  setDefaultImageGen(name: string): void {
    if (!this.imageGenProviders.has(name)) {
      throw new Error(`ImageGen provider not found: ${name}`);
    }
    this.defaultImageGen = name;
  }

  /**
   * Get all registered provider names
   */
  getRegisteredProviders(): {
    llm: string[];
    stt: string[];
    tts: string[];
    imageGen: string[];
  } {
    return {
      llm: Array.from(this.llmProviders.keys()),
      stt: Array.from(this.sttProviders.keys()),
      tts: Array.from(this.ttsProviders.keys()),
      imageGen: Array.from(this.imageGenProviders.keys()),
    };
  }

  /**
   * Health check all providers
   */
  async healthCheckAll(): Promise<{
    llm: Record<string, boolean>;
    stt: Record<string, boolean>;
    tts: Record<string, boolean>;
    imageGen: Record<string, boolean>;
  }> {
    const results = {
      llm: {} as Record<string, boolean>,
      stt: {} as Record<string, boolean>,
      tts: {} as Record<string, boolean>,
      imageGen: {} as Record<string, boolean>,
    };

    const checks: Promise<void>[] = [];

    for (const [name, provider] of this.llmProviders) {
      checks.push(
        provider.healthCheck()
          .then((ok) => { results.llm[name] = ok; })
          .catch(() => { results.llm[name] = false; })
      );
    }

    for (const [name, provider] of this.sttProviders) {
      checks.push(
        provider.healthCheck()
          .then((ok) => { results.stt[name] = ok; })
          .catch(() => { results.stt[name] = false; })
      );
    }

    for (const [name, provider] of this.ttsProviders) {
      checks.push(
        provider.healthCheck()
          .then((ok) => { results.tts[name] = ok; })
          .catch(() => { results.tts[name] = false; })
      );
    }

    for (const [name, provider] of this.imageGenProviders) {
      checks.push(
        provider.healthCheck()
          .then((ok) => { results.imageGen[name] = ok; })
          .catch(() => { results.imageGen[name] = false; })
      );
    }

    await Promise.all(checks);
    return results;
  }
}

// Singleton instance
let registryInstance: DefaultProviderRegistry | null = null;

/**
 * Get the global provider registry instance
 */
export function getProviderRegistry(): DefaultProviderRegistry {
  if (!registryInstance) {
    registryInstance = new DefaultProviderRegistry();
  }
  return registryInstance;
}
