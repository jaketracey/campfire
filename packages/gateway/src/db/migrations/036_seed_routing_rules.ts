/**
 * Migration: Seed Default Routing Rules and Update Model Metadata
 * Created: 2026-01-03
 *
 * 1. Updates model_configs with content_capability, is_abliterated, and tier metadata
 * 2. Adds the abliterated model (JOSIEFIED-Qwen3:8b) if missing
 * 3. Seeds routing rules for all 7 use cases:
 *    - chat_simple, chat_complex: Primary conversation routing
 *    - memory_extraction, summarization, context_compression: Backend processing
 *    - safety_check, content_moderation: Safety and moderation
 *
 * Strategy:
 * - Tier 1: Local Ollama models (llama3.2 for SFW, JOSIEFIED for NSFW)
 * - Tier 2: Cloud fallbacks (Claude Haiku/Sonnet, GPT-4o-mini)
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Step 1: Update model metadata for content routing
  // =========================================================================

  // Get Ollama provider ID
  const ollamaProvider = await sql<{ id: string }[]>`
    SELECT id FROM provider_configs WHERE provider = 'ollama'
  `;

  if (ollamaProvider.length > 0) {
    const ollamaId = ollamaProvider[0].id;

    // Update SFW local models with metadata
    await sql`
      UPDATE model_configs SET metadata = '{"content_capability": "SFW_ONLY", "is_abliterated": false, "tier": "LOCAL", "tags": ["local", "sfw"]}'::jsonb
      WHERE provider_config_id = ${ollamaId}
        AND model_id IN ('llama3.2', 'llama3.1', 'mistral', 'mixtral', 'qwen2.5')
    `;

    // Add abliterated model if missing
    await sql`
      INSERT INTO model_configs (
        provider_config_id, model_id, display_name, is_enabled,
        context_window, max_output_tokens,
        input_cost_per_million, output_cost_per_million,
        capabilities, metadata
      ) VALUES
        (${ollamaId}, 'goekdenizguelmez/JOSIEFIED-Qwen3:8b', 'JOSIEFIED Qwen3 8B', TRUE,
         32768, 4096, 0, 0,
         '["chat", "function_calling", "streaming"]'::jsonb,
         '{"content_capability": "UNRESTRICTED", "is_abliterated": true, "tier": "LOCAL", "tags": ["local", "abliterated", "uncensored", "gabliterated", "primary"]}'::jsonb)
      ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
        metadata = EXCLUDED.metadata,
        capabilities = EXCLUDED.capabilities
    `;
  }

  // Update Anthropic models metadata
  await sql`
    UPDATE model_configs SET metadata = '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "STANDARD"}'::jsonb
    WHERE model_id IN ('claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022')
  `;
  await sql`
    UPDATE model_configs SET metadata = '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb
    WHERE model_id IN ('claude-3-5-haiku-20241022', 'claude-3-haiku-20240307')
  `;
  await sql`
    UPDATE model_configs SET metadata = '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FLAGSHIP"}'::jsonb
    WHERE model_id = 'claude-3-opus-20240229'
  `;

  // Update OpenAI models metadata
  await sql`
    UPDATE model_configs SET metadata = '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "STANDARD"}'::jsonb
    WHERE model_id = 'gpt-4o'
  `;
  await sql`
    UPDATE model_configs SET metadata = '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FAST"}'::jsonb
    WHERE model_id IN ('gpt-4o-mini', 'o1-mini')
  `;
  await sql`
    UPDATE model_configs SET metadata = '{"content_capability": "SUGGESTIVE", "is_abliterated": false, "tier": "FLAGSHIP"}'::jsonb
    WHERE model_id IN ('gpt-4-turbo', 'o1')
  `;

  // =========================================================================
  // Step 2: Seed routing rules
  // =========================================================================

  // Get model IDs by model_id
  const models = await sql<{ id: string; model_id: string }[]>`
    SELECT id, model_id FROM model_configs WHERE is_enabled = TRUE
  `;

  const modelMap = new Map(models.map(m => [m.model_id, m.id]));

  // Helper to get model config ID
  const getModelId = (modelId: string): string | undefined => modelMap.get(modelId);

  // =========================================================================
  // chat_simple: Simple conversational exchanges
  // Tier 1: llama3.2 (local SFW)
  // Tier 2: Claude 3.5 Haiku (fast cloud)
  // =========================================================================
  const llama32Id = getModelId('llama3.2');
  const haikuId = getModelId('claude-3-5-haiku-20241022');

  if (llama32Id) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('chat_simple', 1, ${llama32Id}, 100, TRUE, 2, 30000, '{"description": "Local SFW model for simple chat"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  if (haikuId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('chat_simple', 2, ${haikuId}, 100, TRUE, 3, 60000, '{"description": "Cloud fallback for simple chat"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  // =========================================================================
  // chat_complex: Complex roleplay and multi-turn conversations
  // Tier 1: JOSIEFIED (abliterated for adult) + llama3.2 (SFW fallback within tier)
  // Tier 2: Claude Sonnet 4 (high quality cloud)
  // =========================================================================
  const josieId = getModelId('goekdenizguelmez/JOSIEFIED-Qwen3:8b');
  const sonnetId = getModelId('claude-sonnet-4-20250514');

  if (josieId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('chat_complex', 1, ${josieId}, 80, TRUE, 2, 60000, '{"description": "Abliterated model for adult content", "content_capability": "UNRESTRICTED"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  if (llama32Id) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('chat_complex', 1, ${llama32Id}, 20, TRUE, 2, 60000, '{"description": "SFW local model for complex chat", "content_capability": "SFW_ONLY"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  if (sonnetId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('chat_complex', 2, ${sonnetId}, 100, TRUE, 3, 120000, '{"description": "High quality cloud fallback"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  // =========================================================================
  // memory_extraction: Extract memories from conversations
  // Tier 1: llama3.2 (local, fast)
  // Tier 2: Claude 3.5 Haiku (accurate cloud)
  // =========================================================================
  if (llama32Id) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('memory_extraction', 1, ${llama32Id}, 100, TRUE, 2, 30000, '{"description": "Local model for memory extraction"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  if (haikuId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('memory_extraction', 2, ${haikuId}, 100, TRUE, 3, 60000, '{"description": "Cloud fallback for memory extraction"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  // =========================================================================
  // summarization: Summarize long conversations or content
  // Tier 1: llama3.2 (local)
  // Tier 2: Claude 3.5 Haiku (good at summarization)
  // =========================================================================
  if (llama32Id) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('summarization', 1, ${llama32Id}, 100, TRUE, 2, 45000, '{"description": "Local model for summarization"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  if (haikuId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('summarization', 2, ${haikuId}, 100, TRUE, 3, 90000, '{"description": "Cloud fallback for summarization"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  // =========================================================================
  // context_compression: Compress context for long conversations
  // Tier 1: llama3.2 (local, fast)
  // Tier 2: GPT-4o Mini (cheap, fast cloud)
  // =========================================================================
  const gpt4oMiniId = getModelId('gpt-4o-mini');

  if (llama32Id) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('context_compression', 1, ${llama32Id}, 100, TRUE, 2, 30000, '{"description": "Local model for context compression"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  if (gpt4oMiniId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('context_compression', 2, ${gpt4oMiniId}, 100, TRUE, 3, 60000, '{"description": "Cheap cloud fallback for compression"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  // =========================================================================
  // safety_check: Check content for safety violations
  // Tier 1: Claude 3.5 Haiku (good at safety, aligned)
  // Tier 2: GPT-4o Mini (backup)
  // =========================================================================
  if (haikuId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('safety_check', 1, ${haikuId}, 100, TRUE, 2, 15000, '{"description": "Claude for safety checking - well aligned"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  if (gpt4oMiniId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('safety_check', 2, ${gpt4oMiniId}, 100, TRUE, 3, 30000, '{"description": "GPT fallback for safety checking"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  // =========================================================================
  // content_moderation: Moderate user-generated content
  // Tier 1: Claude 3.5 Haiku (good at moderation, aligned)
  // Tier 2: GPT-4o Mini (backup)
  // =========================================================================
  if (haikuId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('content_moderation', 1, ${haikuId}, 100, TRUE, 2, 15000, '{"description": "Claude for content moderation"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }

  if (gpt4oMiniId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('content_moderation', 2, ${gpt4oMiniId}, 100, TRUE, 3, 30000, '{"description": "GPT fallback for content moderation"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled
    `;
  }
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Remove all seeded routing rules
  await sql`DELETE FROM routing_rules`;
}
