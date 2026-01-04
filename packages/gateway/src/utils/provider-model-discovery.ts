/**
 * Provider Model Discovery
 * Fetches available models from provider APIs for auto-discovery.
 */

import { logger } from '../observability/logger.js';

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  ownedBy?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  capabilities?: string[];
  created?: number;
}

export interface DiscoveryResult {
  success: boolean;
  models: DiscoveredModel[];
  error?: string;
}

// Known model metadata for enriching discovered models
const OPENAI_MODEL_METADATA: Record<string, Partial<DiscoveredModel>> = {
  'gpt-4.1': { displayName: 'GPT-4.1', contextWindow: 1047576, maxOutputTokens: 32768, inputCostPerMillion: 2.0, outputCostPerMillion: 8.0, capabilities: ['chat', 'vision', 'function_calling', 'streaming', 'json_mode'] },
  'gpt-4.1-mini': { displayName: 'GPT-4.1 Mini', contextWindow: 1047576, maxOutputTokens: 32768, inputCostPerMillion: 0.4, outputCostPerMillion: 1.6, capabilities: ['chat', 'vision', 'function_calling', 'streaming', 'json_mode'] },
  'gpt-4.1-nano': { displayName: 'GPT-4.1 Nano', contextWindow: 1047576, maxOutputTokens: 32768, inputCostPerMillion: 0.1, outputCostPerMillion: 0.4, capabilities: ['chat', 'vision', 'function_calling', 'streaming', 'json_mode'] },
  'gpt-4o': { displayName: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384, inputCostPerMillion: 2.5, outputCostPerMillion: 10.0, capabilities: ['chat', 'vision', 'function_calling', 'streaming', 'json_mode'] },
  'gpt-4o-mini': { displayName: 'GPT-4o Mini', contextWindow: 128000, maxOutputTokens: 16384, inputCostPerMillion: 0.15, outputCostPerMillion: 0.6, capabilities: ['chat', 'vision', 'function_calling', 'streaming', 'json_mode'] },
  'gpt-4-turbo': { displayName: 'GPT-4 Turbo', contextWindow: 128000, maxOutputTokens: 4096, inputCostPerMillion: 10.0, outputCostPerMillion: 30.0, capabilities: ['chat', 'vision', 'function_calling', 'streaming', 'json_mode'] },
  'o1': { displayName: 'o1', contextWindow: 200000, maxOutputTokens: 100000, inputCostPerMillion: 15.0, outputCostPerMillion: 60.0, capabilities: ['chat', 'streaming'] },
  'o1-mini': { displayName: 'o1 Mini', contextWindow: 128000, maxOutputTokens: 65536, inputCostPerMillion: 3.0, outputCostPerMillion: 12.0, capabilities: ['chat', 'streaming'] },
  'o1-pro': { displayName: 'o1 Pro', contextWindow: 200000, maxOutputTokens: 100000, inputCostPerMillion: 150.0, outputCostPerMillion: 600.0, capabilities: ['chat', 'streaming'] },
  'o3-mini': { displayName: 'o3 Mini', contextWindow: 200000, maxOutputTokens: 100000, inputCostPerMillion: 1.1, outputCostPerMillion: 4.4, capabilities: ['chat', 'streaming'] },
  'gpt-4.5-preview': { displayName: 'GPT-4.5 Preview', contextWindow: 128000, maxOutputTokens: 16384, inputCostPerMillion: 75.0, outputCostPerMillion: 150.0, capabilities: ['chat', 'vision', 'function_calling', 'streaming', 'json_mode'] },
};

const ANTHROPIC_MODELS: DiscoveredModel[] = [
  { modelId: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', contextWindow: 200000, maxOutputTokens: 16384, inputCostPerMillion: 3.0, outputCostPerMillion: 15.0, capabilities: ['chat', 'vision', 'function_calling', 'streaming'] },
  { modelId: 'claude-opus-4-20250514', displayName: 'Claude Opus 4', contextWindow: 200000, maxOutputTokens: 32000, inputCostPerMillion: 15.0, outputCostPerMillion: 75.0, capabilities: ['chat', 'vision', 'function_calling', 'streaming'] },
  { modelId: 'claude-3-7-sonnet-20250219', displayName: 'Claude 3.7 Sonnet', contextWindow: 200000, maxOutputTokens: 128000, inputCostPerMillion: 3.0, outputCostPerMillion: 15.0, capabilities: ['chat', 'vision', 'function_calling', 'streaming'] },
  { modelId: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', contextWindow: 200000, maxOutputTokens: 8192, inputCostPerMillion: 3.0, outputCostPerMillion: 15.0, capabilities: ['chat', 'vision', 'function_calling', 'streaming'] },
  { modelId: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku', contextWindow: 200000, maxOutputTokens: 8192, inputCostPerMillion: 0.8, outputCostPerMillion: 4.0, capabilities: ['chat', 'function_calling', 'streaming'] },
  { modelId: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', contextWindow: 200000, maxOutputTokens: 4096, inputCostPerMillion: 15.0, outputCostPerMillion: 75.0, capabilities: ['chat', 'vision', 'function_calling', 'streaming'] },
  { modelId: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku', contextWindow: 200000, maxOutputTokens: 4096, inputCostPerMillion: 0.25, outputCostPerMillion: 1.25, capabilities: ['chat', 'function_calling', 'streaming'] },
];

/**
 * Discover available models from OpenAI API
 */
async function discoverOpenAIModels(apiKey: string, baseUrl?: string): Promise<DiscoveryResult> {
  try {
    const url = baseUrl ? `${baseUrl}/v1/models` : 'https://api.openai.com/v1/models';
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, models: [], error: `API error ${response.status}: ${text}` };
    }

    const data = await response.json() as { data: Array<{ id: string; owned_by: string; created: number }> };

    // Filter for chat models only (exclude embeddings, whisper, dall-e, tts, etc.)
    const chatModels = data.data.filter(m =>
      (m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('chatgpt')) &&
      !m.id.includes('audio') &&
      !m.id.includes('realtime') &&
      !m.id.includes('transcribe') &&
      !m.id.includes('search') &&
      !m.id.includes('embedding') &&
      !m.id.includes('instruct')
    );

    const models: DiscoveredModel[] = chatModels.map(m => {
      // Get known metadata if available
      const knownMeta = OPENAI_MODEL_METADATA[m.id];

      return {
        modelId: m.id,
        displayName: knownMeta?.displayName || formatModelName(m.id),
        ownedBy: m.owned_by,
        created: m.created,
        contextWindow: knownMeta?.contextWindow,
        maxOutputTokens: knownMeta?.maxOutputTokens,
        inputCostPerMillion: knownMeta?.inputCostPerMillion,
        outputCostPerMillion: knownMeta?.outputCostPerMillion,
        capabilities: knownMeta?.capabilities || ['chat', 'streaming'],
      };
    });

    // Sort by creation date (newest first), then by name
    models.sort((a, b) => (b.created || 0) - (a.created || 0));

    return { success: true, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: message }, 'Failed to discover OpenAI models');
    return { success: false, models: [], error: message };
  }
}

/**
 * Return static list of Anthropic models (no public API available)
 */
async function discoverAnthropicModels(_apiKey: string): Promise<DiscoveryResult> {
  // Anthropic doesn't have a public models API, so we return a curated list
  return { success: true, models: ANTHROPIC_MODELS };
}

/**
 * Discover available models from Together AI API
 */
async function discoverTogetherModels(apiKey: string): Promise<DiscoveryResult> {
  try {
    const response = await fetch('https://api.together.xyz/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, models: [], error: `API error ${response.status}: ${text}` };
    }

    const data = await response.json() as Array<{
      id: string;
      display_name?: string;
      context_length?: number;
      pricing?: { input?: number; output?: number };
      type?: string;
    }>;

    // Filter for chat models
    const chatModels = data.filter(m => m.type === 'chat' || m.id.includes('Instruct') || m.id.includes('Chat'));

    const models: DiscoveredModel[] = chatModels.map(m => ({
      modelId: m.id,
      displayName: m.display_name || formatModelName(m.id),
      contextWindow: m.context_length,
      inputCostPerMillion: m.pricing?.input ? m.pricing.input * 1000000 : undefined,
      outputCostPerMillion: m.pricing?.output ? m.pricing.output * 1000000 : undefined,
      capabilities: ['chat', 'streaming'],
    }));

    return { success: true, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: message }, 'Failed to discover Together models');
    return { success: false, models: [], error: message };
  }
}

/**
 * Discover available models from Groq API
 */
async function discoverGroqModels(apiKey: string): Promise<DiscoveryResult> {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, models: [], error: `API error ${response.status}: ${text}` };
    }

    const data = await response.json() as { data: Array<{ id: string; owned_by: string; context_window?: number }> };

    // Filter for chat models (exclude whisper, embeddings)
    const chatModels = data.data.filter(m =>
      !m.id.includes('whisper') &&
      !m.id.includes('embed') &&
      !m.id.includes('distil-whisper') &&
      !m.id.includes('tool-use')
    );

    const models: DiscoveredModel[] = chatModels.map(m => ({
      modelId: m.id,
      displayName: formatModelName(m.id),
      ownedBy: m.owned_by,
      contextWindow: m.context_window,
      capabilities: ['chat', 'streaming'],
    }));

    return { success: true, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: message }, 'Failed to discover Groq models');
    return { success: false, models: [], error: message };
  }
}

/**
 * Discover available models from local Ollama instance
 */
async function discoverOllamaModels(baseUrl?: string): Promise<DiscoveryResult> {
  try {
    const url = baseUrl || 'http://localhost:11434';
    const response = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, models: [], error: `API error ${response.status}: ${text}` };
    }

    const data = await response.json() as { models: Array<{ name: string; size: number; modified_at: string }> };

    const models: DiscoveredModel[] = data.models.map(m => ({
      modelId: m.name,
      displayName: formatModelName(m.name),
      capabilities: ['chat', 'streaming'],
    }));

    return { success: true, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: message }, 'Failed to discover Ollama models');
    return { success: false, models: [], error: message };
  }
}

/**
 * Format a model ID into a display name
 */
function formatModelName(modelId: string): string {
  // Remove common prefixes
  let name = modelId
    .replace(/^meta-llama\//, '')
    .replace(/^deepseek-ai\//, '')
    .replace(/^Qwen\//, '')
    .replace(/^mistralai\//, '')
    .replace(/^google\//, '');

  // Replace separators with spaces
  name = name.replace(/[-_]/g, ' ');

  // Capitalize words
  name = name.replace(/\b\w/g, c => c.toUpperCase());

  return name;
}

/**
 * Main discovery function - routes to the appropriate provider
 */
export async function discoverModels(
  providerType: string,
  apiKey: string | null,
  baseUrl?: string | null
): Promise<DiscoveryResult> {
  switch (providerType.toLowerCase()) {
    case 'openai':
      if (!apiKey) return { success: false, models: [], error: 'API key required for OpenAI' };
      return discoverOpenAIModels(apiKey, baseUrl || undefined);

    case 'anthropic':
      if (!apiKey) return { success: false, models: [], error: 'API key required for Anthropic' };
      return discoverAnthropicModels(apiKey);

    case 'together':
      if (!apiKey) return { success: false, models: [], error: 'API key required for Together AI' };
      return discoverTogetherModels(apiKey);

    case 'groq':
      if (!apiKey) return { success: false, models: [], error: 'API key required for Groq' };
      return discoverGroqModels(apiKey);

    case 'ollama':
      return discoverOllamaModels(baseUrl || undefined);

    default:
      return { success: false, models: [], error: `Model discovery not supported for provider: ${providerType}` };
  }
}
