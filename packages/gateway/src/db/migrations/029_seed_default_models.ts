/**
 * Migration: Seed Default Models
 * Adds common models to the seeded providers for initial routing configuration.
 * Includes metadata for content_capability, is_abliterated, and tier.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Get provider IDs
  const providers = await sql<{ id: string; provider: string }[]>`
    SELECT id, provider FROM provider_configs
  `;

  const providerMap = new Map(providers.map(p => [p.provider, p.id]));

  // Seed Anthropic models
  const anthropicId = providerMap.get('anthropic');
  if (anthropicId) {
    await sql`
      INSERT INTO model_configs (
        provider_config_id, model_id, display_name, is_enabled,
        context_window, max_output_tokens,
        input_cost_per_million, output_cost_per_million,
        capabilities, metadata
      ) VALUES
        (${anthropicId}, 'claude-sonnet-4-20250514', 'Claude Sonnet 4', TRUE,
         200000, 16384, 3.0, 15.0,
         '["chat", "vision", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "STANDARD"}'::jsonb),
        (${anthropicId}, 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', TRUE,
         200000, 8192, 3.0, 15.0,
         '["chat", "vision", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "STANDARD"}'::jsonb),
        (${anthropicId}, 'claude-3-5-haiku-20241022', 'Claude 3.5 Haiku', TRUE,
         200000, 8192, 1.0, 5.0,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb),
        (${anthropicId}, 'claude-3-haiku-20240307', 'Claude 3 Haiku', TRUE,
         200000, 4096, 0.25, 1.25,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb),
        (${anthropicId}, 'claude-3-opus-20240229', 'Claude 3 Opus', TRUE,
         200000, 4096, 15.0, 75.0,
         '["chat", "vision", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FLAGSHIP"}'::jsonb)
      ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
        metadata = EXCLUDED.metadata
    `;
  }

  // Seed OpenAI models
  const openaiId = providerMap.get('openai');
  if (openaiId) {
    await sql`
      INSERT INTO model_configs (
        provider_config_id, model_id, display_name, is_enabled,
        context_window, max_output_tokens,
        input_cost_per_million, output_cost_per_million,
        capabilities, metadata
      ) VALUES
        (${openaiId}, 'gpt-4o', 'GPT-4o', TRUE,
         128000, 16384, 5.0, 15.0,
         '["chat", "vision", "function_calling", "streaming", "json_mode"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "STANDARD"}'::jsonb),
        (${openaiId}, 'gpt-4o-mini', 'GPT-4o Mini', TRUE,
         128000, 16384, 0.15, 0.6,
         '["chat", "vision", "function_calling", "streaming", "json_mode"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb),
        (${openaiId}, 'gpt-4-turbo', 'GPT-4 Turbo', TRUE,
         128000, 4096, 10.0, 30.0,
         '["chat", "vision", "function_calling", "streaming", "json_mode"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FLAGSHIP"}'::jsonb),
        (${openaiId}, 'o1', 'o1', TRUE,
         200000, 100000, 15.0, 60.0,
         '["chat", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FLAGSHIP"}'::jsonb),
        (${openaiId}, 'o1-mini', 'o1 Mini', TRUE,
         128000, 65536, 3.0, 12.0,
         '["chat", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb)
      ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
        metadata = EXCLUDED.metadata
    `;
  }

  // Seed Together AI models
  const togetherId = providerMap.get('together');
  if (togetherId) {
    await sql`
      INSERT INTO model_configs (
        provider_config_id, model_id, display_name, is_enabled,
        context_window, max_output_tokens,
        input_cost_per_million, output_cost_per_million,
        capabilities, metadata
      ) VALUES
        (${togetherId}, 'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B Turbo', TRUE,
         131072, 4096, 0.88, 0.88,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "STANDARD"}'::jsonb),
        (${togetherId}, 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', 'Llama 3.1 8B Turbo', TRUE,
         131072, 4096, 0.18, 0.18,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb),
        (${togetherId}, 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'Llama 3.1 70B Turbo', TRUE,
         131072, 4096, 0.88, 0.88,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "STANDARD"}'::jsonb),
        (${togetherId}, 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'Qwen 2.5 72B Turbo', TRUE,
         131072, 4096, 1.2, 1.2,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "STANDARD"}'::jsonb),
        (${togetherId}, 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B', 'DeepSeek R1 Distill 70B', TRUE,
         131072, 4096, 0.55, 0.55,
         '["chat", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "STANDARD"}'::jsonb)
      ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
        metadata = EXCLUDED.metadata
    `;
  }

  // Seed Groq models
  const groqId = providerMap.get('groq');
  if (groqId) {
    await sql`
      INSERT INTO model_configs (
        provider_config_id, model_id, display_name, is_enabled,
        context_window, max_output_tokens,
        input_cost_per_million, output_cost_per_million,
        capabilities, metadata
      ) VALUES
        (${groqId}, 'llama-3.3-70b-versatile', 'Llama 3.3 70B', TRUE,
         128000, 32768, 0.59, 0.79,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb),
        (${groqId}, 'llama-3.1-8b-instant', 'Llama 3.1 8B Instant', TRUE,
         128000, 8192, 0.05, 0.08,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb),
        (${groqId}, 'mixtral-8x7b-32768', 'Mixtral 8x7B', TRUE,
         32768, 32768, 0.24, 0.24,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb),
        (${groqId}, 'gemma2-9b-it', 'Gemma 2 9B', TRUE,
         8192, 8192, 0.20, 0.20,
         '["chat", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb)
      ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
        metadata = EXCLUDED.metadata
    `;
  }

  // Seed Ollama models (local, free)
  const ollamaId = providerMap.get('ollama');
  if (ollamaId) {
    await sql`
      INSERT INTO model_configs (
        provider_config_id, model_id, display_name, is_enabled,
        context_window, max_output_tokens,
        input_cost_per_million, output_cost_per_million,
        capabilities, metadata
      ) VALUES
        -- SFW local models (non-abliterated)
        (${ollamaId}, 'llama3.2', 'Llama 3.2', TRUE,
         131072, 4096, 0, 0,
         '["chat", "streaming"]'::jsonb,
         '{"content_capability": "SFW_ONLY", "is_abliterated": false, "tier": "LOCAL", "tags": ["local", "sfw", "meta"]}'::jsonb),
        (${ollamaId}, 'llama3.1', 'Llama 3.1', TRUE,
         131072, 4096, 0, 0,
         '["chat", "streaming"]'::jsonb,
         '{"content_capability": "SFW_ONLY", "is_abliterated": false, "tier": "LOCAL", "tags": ["local", "sfw", "meta"]}'::jsonb),
        (${ollamaId}, 'mistral', 'Mistral 7B', TRUE,
         32768, 4096, 0, 0,
         '["chat", "streaming"]'::jsonb,
         '{"content_capability": "SFW_ONLY", "is_abliterated": false, "tier": "LOCAL", "tags": ["local", "sfw"]}'::jsonb),
        (${ollamaId}, 'mixtral', 'Mixtral 8x7B', TRUE,
         32768, 4096, 0, 0,
         '["chat", "streaming"]'::jsonb,
         '{"content_capability": "SFW_ONLY", "is_abliterated": false, "tier": "LOCAL", "tags": ["local", "sfw", "moe"]}'::jsonb),
        (${ollamaId}, 'qwen2.5:latest', 'Qwen 2.5 7B', TRUE,
         32768, 4096, 0, 0,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "LOCAL", "tags": ["local", "sfw", "primary", "qwen"]}'::jsonb),
        -- Abliterated model for NSFW/adult content
        (${ollamaId}, 'goekdenizguelmez/JOSIEFIED-Qwen3:8b', 'JOSIEFIED Qwen3 8B', TRUE,
         32768, 4096, 0, 0,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "UNRESTRICTED", "is_abliterated": true, "tier": "LOCAL", "tags": ["local", "abliterated", "uncensored", "gabliterated", "primary"]}'::jsonb)
      ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
        metadata = EXCLUDED.metadata
    `;
  }
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Remove seeded models (but keep any manually added ones)
  const seedModels = [
    // Anthropic
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-haiku-20240307',
    'claude-3-opus-20240229',
    // OpenAI
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o1',
    'o1-mini',
    // Together
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    'Qwen/Qwen2.5-72B-Instruct-Turbo',
    'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
    // Groq
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
    // Ollama
    'llama3.2',
    'llama3.1',
    'mistral',
    'mixtral',
    'qwen2.5:latest',
    'goekdenizguelmez/JOSIEFIED-Qwen3:8b',
  ];

  await sql`
    DELETE FROM model_configs WHERE model_id = ANY(${seedModels})
  `;
}
