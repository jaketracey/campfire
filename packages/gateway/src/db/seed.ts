#!/usr/bin/env tsx
/**
 * Database Seed Script for Project Campfire
 *
 * Creates development test data:
 * - Test users with profiles
 * - Sample companions with specs
 * - Example sessions and turns
 * - Sample memories and KG entities
 * - Test subscription data
 *
 * Usage:
 *   pnpm db:seed
 */

import { createPool, closePool } from './pool.js';
import type postgres from 'postgres';
import { hashPassword } from '../utils/password.js';

const TEST_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface SeedData {
  users: Array<{
    id: string;
    email: string;
    display_name: string;
  }>;
  companions: Array<{
    id: string;
    user_id: string;
    name: string;
  }>;
  sessions: Array<{
    id: string;
    user_id: string;
    companion_id: string;
  }>;
}

async function seed(sql: postgres.Sql): Promise<SeedData> {
  console.log('[Seed] Starting database seed...');

  const data: SeedData = {
    users: [],
    companions: [],
    sessions: [],
  };

  // =========================================================================
  // Users
  // =========================================================================
  console.log('[Seed] Creating test users...');

  const users = await sql`
    INSERT INTO users (id, email, password_hash, email_verified, status)
    VALUES
      ('00000000-0000-0000-0000-000000000001', 'alice@example.com', ${TEST_PASSWORD_HASH}, TRUE, 'active'),
      ('00000000-0000-0000-0000-000000000002', 'bob@example.com', ${TEST_PASSWORD_HASH}, TRUE, 'active'),
      ('00000000-0000-0000-0000-000000000003', 'charlie@example.com', ${TEST_PASSWORD_HASH}, FALSE, 'active')
    ON CONFLICT (email_normalized) DO UPDATE SET email = EXCLUDED.email
    RETURNING id, email
  `;

  // User profiles
  await sql`
    INSERT INTO user_profiles (user_id, display_name, timezone, locale, preferences)
    VALUES
      ('00000000-0000-0000-0000-000000000001', 'Alice Smith', 'America/New_York', 'en-US', '{"theme": "dark", "notifications": true}'),
      ('00000000-0000-0000-0000-000000000002', 'Bob Jones', 'America/Los_Angeles', 'en-US', '{"theme": "light", "notifications": true}'),
      ('00000000-0000-0000-0000-000000000003', 'Charlie Brown', 'Europe/London', 'en-GB', '{"theme": "system", "notifications": false}')
    ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name
  `;

  for (const user of users) {
    data.users.push({
      id: user.id as string,
      email: user.email as string,
      display_name: user.email.split('@')[0] as string,
    });
  }

  console.log(`[Seed] Created ${users.length} users`);

  // =========================================================================
  // Admin User
  // =========================================================================
  console.log('[Seed] Creating admin user...');

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.warn('[Seed] SEED_ADMIN_PASSWORD not set - skipping admin user creation');
    console.warn('[Seed] To create admin user, set SEED_ADMIN_PASSWORD env var (min 12 chars)');
  } else {
    if (adminPassword.length < 12) {
      throw new Error('[Seed] SEED_ADMIN_PASSWORD must be at least 12 characters');
    }

    const adminPasswordHash = await hashPassword(adminPassword);

    await sql`
      INSERT INTO users (id, email, password_hash, email_verified, status, role)
      VALUES (
        '00000000-0000-0000-0000-000000000100',
        'admin@example.com',
        ${adminPasswordHash},
        TRUE,
        'active',
        'admin'
      )
      ON CONFLICT (email_normalized) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role
    `;

    await sql`
      INSERT INTO user_profiles (user_id, display_name, timezone, locale, preferences)
      VALUES (
        '00000000-0000-0000-0000-000000000100',
        'Admin User',
        'America/New_York',
        'en-US',
        '{"theme": "dark", "notifications": true}'
      )
      ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name
    `;

    console.log('[Seed] Created admin user: admin@example.com (password from SEED_ADMIN_PASSWORD)');
  }

  // =========================================================================
  // Companions
  // =========================================================================
  console.log('[Seed] Creating test companions...');

  const companionSpecs = [
    {
      id: '00000000-0000-0000-0001-000000000001',
      user_id: '00000000-0000-0000-0000-000000000001',
      name: 'Luna',
      spec: {
        identity: {
          name: 'Luna',
          pronouns: 'she/her',
          address_style: 'friendly and warm',
        },
        personality: {
          archetype: 'supportive_friend',
          traits: {
            warmth: 0.9,
            humor: 0.7,
            curiosity: 0.8,
            empathy: 0.95,
          },
        },
        voice: {
          provider: 'elevenlabs',
          voice_id: 'voice_luna_001',
          settings: { stability: 0.75, similarity_boost: 0.8 },
        },
        visual_style: {
          style_type: 'anime',
          palette: ['#FFB6C1', '#DDA0DD', '#E6E6FA'],
          constraints: ['soft lighting', 'warm colors'],
        },
        boundaries: {
          relationship_pacing: 'gradual',
          topics_avoid: ['violence', 'politics'],
          content_rating: 'PG-13',
        },
        memory_consent: {
          allow_long_term: true,
          allow_kg_extraction: true,
          retention_days: 365,
        },
      },
    },
    {
      id: '00000000-0000-0000-0001-000000000002',
      user_id: '00000000-0000-0000-0000-000000000001',
      name: 'Atlas',
      spec: {
        identity: {
          name: 'Atlas',
          pronouns: 'he/him',
          address_style: 'professional and knowledgeable',
        },
        personality: {
          archetype: 'wise_mentor',
          traits: {
            warmth: 0.6,
            humor: 0.4,
            curiosity: 0.9,
            empathy: 0.7,
          },
        },
        voice: {
          provider: 'elevenlabs',
          voice_id: 'voice_atlas_001',
          settings: { stability: 0.85, similarity_boost: 0.7 },
        },
        visual_style: {
          style_type: 'realistic',
          palette: ['#2C3E50', '#34495E', '#5D6D7E'],
          constraints: ['neutral lighting', 'professional attire'],
        },
        boundaries: {
          relationship_pacing: 'professional',
          content_rating: 'PG',
        },
        memory_consent: {
          allow_long_term: true,
          allow_kg_extraction: true,
        },
      },
    },
    {
      id: '00000000-0000-0000-0001-000000000003',
      user_id: '00000000-0000-0000-0000-000000000002',
      name: 'Sage',
      spec: {
        identity: {
          name: 'Sage',
          pronouns: 'they/them',
          address_style: 'calm and thoughtful',
        },
        personality: {
          archetype: 'creative_partner',
          traits: {
            warmth: 0.75,
            humor: 0.6,
            curiosity: 0.95,
            empathy: 0.8,
          },
        },
        voice: {
          provider: 'elevenlabs',
          voice_id: 'voice_sage_001',
        },
        visual_style: {
          style_type: 'stylized',
          palette: ['#2ECC71', '#27AE60', '#1ABC9C'],
        },
        boundaries: {
          relationship_pacing: 'adaptive',
          content_rating: 'PG-13',
        },
        memory_consent: {
          allow_long_term: true,
          allow_kg_extraction: true,
        },
      },
    },
  ];

  for (const comp of companionSpecs) {
    await sql`
      INSERT INTO companions (id, user_id, name, spec, status)
      VALUES (${comp.id}, ${comp.user_id}, ${comp.name}, ${JSON.stringify(comp.spec)}, 'active')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, spec = EXCLUDED.spec
    `;

    data.companions.push({
      id: comp.id,
      user_id: comp.user_id,
      name: comp.name,
    });
  }

  console.log(`[Seed] Created ${companionSpecs.length} companions`);

  // =========================================================================
  // Sessions and Turns
  // =========================================================================
  console.log('[Seed] Creating test sessions and turns...');

  const sessions = [
    {
      id: '00000000-0000-0000-0002-000000000001',
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
    },
    {
      id: '00000000-0000-0000-0002-000000000002',
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
    },
    {
      id: '00000000-0000-0000-0002-000000000003',
      user_id: '00000000-0000-0000-0000-000000000002',
      companion_id: '00000000-0000-0000-0001-000000000003',
    },
  ];

  for (const session of sessions) {
    await sql`
      INSERT INTO sessions (id, user_id, companion_id, status)
      VALUES (${session.id}, ${session.user_id}, ${session.companion_id}, 'ended')
      ON CONFLICT (id) DO NOTHING
    `;

    data.sessions.push(session);
  }

  // Sample turns for first session
  const sampleTurns = [
    {
      session_id: sessions[0]!.id,
      turn_number: 1,
      user_message: 'Hey Luna! How are you today?',
      agent_message: 'Hi there! I am doing wonderfully, thank you for asking! It is always lovely to chat with you. How has your day been so far?',
      token_count_input: 12,
      token_count_output: 35,
      latency_ms: 450,
    },
    {
      session_id: sessions[0]!.id,
      turn_number: 2,
      user_message: 'Pretty good! I just finished a big project at work.',
      agent_message: 'That is fantastic news! Completing a big project is such a rewarding feeling. What kind of project was it? I would love to hear more about what you have been working on!',
      token_count_input: 15,
      token_count_output: 42,
      latency_ms: 520,
    },
    {
      session_id: sessions[0]!.id,
      turn_number: 3,
      user_message: 'It was a web application for tracking fitness goals. We used React and Node.js.',
      agent_message: 'Oh, that sounds like such a meaningful project! Helping people track their fitness goals can really make a positive impact on their lives. React and Node.js are great choices - did you enjoy the technical challenges?',
      token_count_input: 22,
      token_count_output: 48,
      latency_ms: 580,
    },
  ];

  for (const turn of sampleTurns) {
    await sql`
      INSERT INTO turns (
        session_id, turn_number, user_message, agent_message,
        token_count_input, token_count_output, latency_ms,
        started_at, completed_at
      )
      VALUES (
        ${turn.session_id}, ${turn.turn_number}, ${turn.user_message}, ${turn.agent_message},
        ${turn.token_count_input}, ${turn.token_count_output}, ${turn.latency_ms},
        NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour'
      )
      ON CONFLICT (session_id, turn_number) DO NOTHING
    `;
  }

  console.log(`[Seed] Created ${sessions.length} sessions with ${sampleTurns.length} turns`);

  // =========================================================================
  // Memories
  // =========================================================================
  console.log('[Seed] Creating test memories...');

  const memories = [
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      content: 'User works as a software developer and recently completed a fitness tracking web application project.',
      content_type: 'fact',
      importance: 0.8,
    },
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      content: 'User is experienced with React and Node.js technologies.',
      content_type: 'fact',
      importance: 0.7,
    },
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      content: 'User enjoys discussing technical topics and seems to take pride in their work.',
      content_type: 'preference',
      importance: 0.6,
    },
    {
      user_id: '00000000-0000-0000-0000-000000000002',
      companion_id: '00000000-0000-0000-0001-000000000003',
      content: 'User prefers thoughtful, reflective conversations over quick exchanges.',
      content_type: 'preference',
      importance: 0.75,
    },
  ];

  for (const memory of memories) {
    await sql`
      INSERT INTO memories (user_id, companion_id, content, content_type, importance)
      VALUES (${memory.user_id}, ${memory.companion_id}, ${memory.content}, ${memory.content_type}::memory_content_type, ${memory.importance})
    `;
  }

  console.log(`[Seed] Created ${memories.length} memories`);

  // =========================================================================
  // Knowledge Graph Entities and Edges
  // =========================================================================
  console.log('[Seed] Creating test KG entities and edges...');

  // Create entities
  const entities = [
    {
      id: '00000000-0000-0000-0003-000000000001',
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      name: 'Alice',
      entity_type: 'person',
      description: 'The user',
    },
    {
      id: '00000000-0000-0000-0003-000000000002',
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      name: 'Fitness Tracker App',
      entity_type: 'project',
      description: 'A web application for tracking fitness goals',
    },
    {
      id: '00000000-0000-0000-0003-000000000003',
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      name: 'React',
      entity_type: 'technology',
      description: 'Frontend JavaScript library',
    },
    {
      id: '00000000-0000-0000-0003-000000000004',
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      name: 'Node.js',
      entity_type: 'technology',
      description: 'Backend JavaScript runtime',
    },
  ];

  for (const entity of entities) {
    await sql`
      INSERT INTO kg_entities (id, user_id, companion_id, name, entity_type, description)
      VALUES (${entity.id}, ${entity.user_id}, ${entity.companion_id}, ${entity.name}, ${entity.entity_type}, ${entity.description})
      ON CONFLICT (user_id, companion_id, canonical_name) DO NOTHING
    `;
  }

  // Create edges
  const edges = [
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      source_entity_id: '00000000-0000-0000-0003-000000000001',
      target_entity_id: '00000000-0000-0000-0003-000000000002',
      relation_type: 'worked_on',
      confidence: 0.95,
      status: 'active',
    },
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      source_entity_id: '00000000-0000-0000-0003-000000000002',
      target_entity_id: '00000000-0000-0000-0003-000000000003',
      relation_type: 'uses_technology',
      confidence: 0.9,
      status: 'active',
    },
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      source_entity_id: '00000000-0000-0000-0003-000000000002',
      target_entity_id: '00000000-0000-0000-0003-000000000004',
      relation_type: 'uses_technology',
      confidence: 0.9,
      status: 'active',
    },
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      companion_id: '00000000-0000-0000-0001-000000000001',
      source_entity_id: '00000000-0000-0000-0003-000000000001',
      target_entity_id: '00000000-0000-0000-0003-000000000003',
      relation_type: 'knows',
      confidence: 0.85,
      status: 'active',
    },
  ];

  for (const edge of edges) {
    await sql`
      INSERT INTO kg_edges (
        user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status
      )
      VALUES (
        ${edge.user_id}, ${edge.companion_id}, ${edge.source_entity_id}, ${edge.target_entity_id},
        ${edge.relation_type}, ${edge.confidence}, ${edge.status}::kg_edge_status
      )
      ON CONFLICT (user_id, companion_id, source_entity_id, target_entity_id, relation_type) DO NOTHING
    `;
  }

  console.log(`[Seed] Created ${entities.length} KG entities and ${edges.length} edges`);

  // =========================================================================
  // Subscriptions
  // =========================================================================
  console.log('[Seed] Creating test subscriptions...');

  const subscriptions = [
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      flowguard_customer_id: 'fg_test_alice_001',
      flowguard_subscription_id: 'fgsub_test_alice_001',
      status: 'active',
      plan: 'pro',
      voice_minutes_limit: 1000,
      message_limit: 10000,
      companion_limit: 5,
    },
    {
      user_id: '00000000-0000-0000-0000-000000000002',
      flowguard_customer_id: 'fg_test_bob_001',
      flowguard_subscription_id: 'fgsub_test_bob_001',
      status: 'active',
      plan: 'starter',
      voice_minutes_limit: 100,
      message_limit: 1000,
      companion_limit: 2,
    },
    {
      user_id: '00000000-0000-0000-0000-000000000003',
      flowguard_customer_id: 'fg_test_charlie_001',
      status: 'trialing',
      plan: 'free',
      voice_minutes_limit: 10,
      message_limit: 100,
      companion_limit: 1,
    },
  ];

  for (const sub of subscriptions) {
    await sql`
      INSERT INTO subscriptions (
        user_id, flowguard_customer_id, flowguard_subscription_id,
        status, plan, voice_minutes_limit, message_limit, companion_limit,
        current_period_start, current_period_end
      )
      VALUES (
        ${sub.user_id}, ${sub.flowguard_customer_id}, ${sub.flowguard_subscription_id ?? null},
        ${sub.status}::subscription_status, ${sub.plan}::subscription_plan,
        ${sub.voice_minutes_limit}, ${sub.message_limit}, ${sub.companion_limit},
        NOW(), NOW() + INTERVAL '30 days'
      )
      ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan
    `;
  }

  console.log(`[Seed] Created ${subscriptions.length} subscriptions`);

  // =========================================================================
  // Sample Events
  // =========================================================================
  console.log('[Seed] Creating sample events...');

  const events = [
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0002-000000000001',
      type: 'session.started',
      payload: { companion_id: '00000000-0000-0000-0001-000000000001' },
    },
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0002-000000000001',
      type: 'user.message.created',
      payload: { content: 'Hey Luna! How are you today?' },
    },
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0002-000000000001',
      type: 'llm.final',
      payload: {
        model: 'claude-3-opus',
        tokens_input: 150,
        tokens_output: 45,
        latency_ms: 450,
      },
    },
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0002-000000000001',
      type: 'agent.message.created',
      payload: { content: 'Hi there! I am doing wonderfully...' },
    },
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0002-000000000001',
      type: 'session.ended',
      payload: { reason: 'user_ended', turn_count: 3 },
    },
  ];

  for (const event of events) {
    await sql`
      INSERT INTO events (user_id, session_id, type, payload)
      VALUES (${event.user_id}, ${event.session_id}, ${event.type}, ${JSON.stringify(event.payload)})
    `;
  }

  console.log(`[Seed] Created ${events.length} events`);

  // =========================================================================
  // Token Bundles
  // =========================================================================
  console.log('[Seed] Creating token bundles...');

  const tokenBundles = [
    {
      name: 'Starter Pack',
      description: 'Perfect for trying out gifts with your companion.',
      tokens: 100,
      price_cents: 499,
      currency: 'usd',
      flowguard_price_id: 'fg_price_tokens_starter_100',
      flowguard_product_id: 'fg_prod_tokens_starter',
      display_order: 1,
      bonus_tokens: 0,
    },
    {
      name: 'Popular Pack',
      description: 'Our most popular choice! Great value with bonus tokens.',
      tokens: 500,
      price_cents: 1999,
      currency: 'usd',
      flowguard_price_id: 'fg_price_tokens_popular_500',
      flowguard_product_id: 'fg_prod_tokens_popular',
      display_order: 2,
      bonus_tokens: 50,
    },
    {
      name: 'Best Value',
      description: 'The best value for dedicated gift-givers.',
      tokens: 1200,
      price_cents: 3999,
      currency: 'usd',
      flowguard_price_id: 'fg_price_tokens_value_1200',
      flowguard_product_id: 'fg_prod_tokens_value',
      display_order: 3,
      bonus_tokens: 200,
    },
    {
      name: 'Ultimate Pack',
      description: 'For the ultimate companion experience. Maximum savings!',
      tokens: 3000,
      price_cents: 7999,
      currency: 'usd',
      flowguard_price_id: 'fg_price_tokens_ultimate_3000',
      flowguard_product_id: 'fg_prod_tokens_ultimate',
      display_order: 4,
      bonus_tokens: 600,
    },
  ];

  for (const bundle of tokenBundles) {
    await sql`
      INSERT INTO token_bundles (
        name, description, tokens, price_cents, currency,
        flowguard_price_id, flowguard_product_id, display_order, bonus_tokens, is_active
      )
      VALUES (
        ${bundle.name}, ${bundle.description}, ${bundle.tokens}, ${bundle.price_cents}, ${bundle.currency},
        ${bundle.flowguard_price_id}, ${bundle.flowguard_product_id}, ${bundle.display_order}, ${bundle.bonus_tokens}, TRUE
      )
      ON CONFLICT (flowguard_price_id) DO UPDATE SET
        name = EXCLUDED.name,
        tokens = EXCLUDED.tokens,
        price_cents = EXCLUDED.price_cents,
        bonus_tokens = EXCLUDED.bonus_tokens,
        display_order = EXCLUDED.display_order
    `;
  }

  console.log(`[Seed] Created ${tokenBundles.length} token bundles`);

  // =========================================================================
  // Token Balances (for test users)
  // =========================================================================
  console.log('[Seed] Creating test token balances...');

  const tokenBalances = [
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      balance: 500,
      lifetime_purchased: 500,
      lifetime_bonus: 50,
      lifetime_spent: 50,
    },
    {
      user_id: '00000000-0000-0000-0000-000000000002',
      balance: 100,
      lifetime_purchased: 100,
      lifetime_bonus: 0,
      lifetime_spent: 0,
    },
  ];

  for (const balance of tokenBalances) {
    await sql`
      INSERT INTO token_balances (
        user_id, balance, lifetime_purchased, lifetime_bonus, lifetime_spent
      )
      VALUES (
        ${balance.user_id}, ${balance.balance}, ${balance.lifetime_purchased},
        ${balance.lifetime_bonus}, ${balance.lifetime_spent}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        balance = EXCLUDED.balance,
        lifetime_purchased = EXCLUDED.lifetime_purchased
    `;
  }

  console.log(`[Seed] Created ${tokenBalances.length} token balances`);

  // =========================================================================
  // Provider Configs (LLM + Image)
  // =========================================================================
  console.log('[Seed] Creating provider configs...');

  await sql`
    INSERT INTO provider_configs (id, provider, display_name, is_enabled, priority, category, metadata)
    VALUES
      -- Text/LLM Providers
      ('00000000-0000-0000-0004-000000000001', 'openai', 'OpenAI', true, 1, 'text', '{}'),
      ('00000000-0000-0000-0004-000000000002', 'anthropic', 'Anthropic', false, 2, 'text', '{}'),
      -- Image Provider
      ('00000000-0000-0000-0004-000000000003', 'fal', 'FAL.ai', true, 0, 'image', '{"category": "image"}')
    ON CONFLICT (provider) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      is_enabled = EXCLUDED.is_enabled,
      category = EXCLUDED.category
  `;

  console.log('[Seed] Created provider configs');

  // =========================================================================
  // Model Configs (LLM + Image)
  // =========================================================================
  console.log('[Seed] Creating model configs...');

  // LLM Models
  await sql`
    INSERT INTO model_configs (id, provider_config_id, model_id, display_name, is_enabled, capabilities, metadata)
    VALUES
      ('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0004-000000000001', 'gpt-4o', 'GPT-4o', true, '[]', '{}'),
      ('00000000-0000-0000-0005-000000000002', '00000000-0000-0000-0004-000000000001', 'gpt-4o-mini', 'GPT-4o Mini', true, '[]', '{}'),
      ('00000000-0000-0000-0005-000000000003', '00000000-0000-0000-0004-000000000002', 'claude-sonnet-4-20250514', 'Claude Sonnet 4', true, '[]', '{}'),
      ('00000000-0000-0000-0005-000000000004', '00000000-0000-0000-0004-000000000002', 'claude-3-5-haiku-20241022', 'Claude 3.5 Haiku', true, '[]', '{}')
    ON CONFLICT (provider_config_id, model_id) DO UPDATE SET display_name = EXCLUDED.display_name
  `;

  // Image Models (FAL.ai)
  await sql`
    INSERT INTO model_configs (id, provider_config_id, model_id, display_name, is_enabled, capabilities, metadata)
    VALUES
      -- State of the Art
      ('00000000-0000-0000-0005-000000000010', '00000000-0000-0000-0004-000000000003', 'fal/dreamina-v3.1', 'Bytedance Dreamina 3.1', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/bytedance/dreamina/v3.1/text-to-image"}'),
      ('00000000-0000-0000-0005-000000000011', '00000000-0000-0000-0004-000000000003', 'fal/seedream-v4', 'Seedream V4 (Bytedance)', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/bytedance/seedream/v4/text-to-image"}'),
      ('00000000-0000-0000-0005-000000000012', '00000000-0000-0000-0004-000000000003', 'fal/seedream-4.5', 'Seedream 4.5 (Bytedance)', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/bytedance/seedream/v4.5/text-to-image"}'),
      ('00000000-0000-0000-0005-000000000013', '00000000-0000-0000-0004-000000000003', 'fal/reve', 'Reve Text-to-Image', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/reve/text-to-image"}'),
      ('00000000-0000-0000-0005-000000000014', '00000000-0000-0000-0004-000000000003', 'fal/nano-banana-pro', 'Nano Banana Pro', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/nano-banana-pro"}'),
      ('00000000-0000-0000-0005-000000000015', '00000000-0000-0000-0004-000000000003', 'fal/flux-2', 'Flux 2', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/flux-2"}'),
      ('00000000-0000-0000-0005-000000000016', '00000000-0000-0000-0004-000000000003', 'fal/flux-2-pro', 'Flux 2 Pro', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/flux-2-pro"}'),
      -- Fast Open Source
      ('00000000-0000-0000-0005-000000000020', '00000000-0000-0000-0004-000000000003', 'fal/flux-krea', 'Flux Krea', true, '[]', '{"tier": "fast", "fal_endpoint": "fal-ai/flux/krea"}'),
      ('00000000-0000-0000-0005-000000000021', '00000000-0000-0000-0004-000000000003', 'fal/flux-1-krea', 'Flux 1 Krea', true, '[]', '{"tier": "fast", "fal_endpoint": "fal-ai/flux-1/krea"}'),
      ('00000000-0000-0000-0005-000000000022', '00000000-0000-0000-0004-000000000003', 'fal/flux-schnell', 'Flux Schnell (Fast)', true, '[]', '{"tier": "fast", "fal_endpoint": "fal-ai/flux/schnell"}'),
      ('00000000-0000-0000-0005-000000000023', '00000000-0000-0000-0004-000000000003', 'fal/flux-dev', 'Flux Dev', true, '[]', '{"tier": "standard", "fal_endpoint": "fal-ai/flux/dev"}'),
      -- Flux 2 Series
      ('00000000-0000-0000-0005-000000000030', '00000000-0000-0000-0004-000000000003', 'fal/flux-2-max', 'Flux 2 Max (Premium)', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/flux-2-max"}'),
      ('00000000-0000-0000-0005-000000000031', '00000000-0000-0000-0004-000000000003', 'fal/flux-2-turbo', 'Flux 2 Turbo (Fast)', true, '[]', '{"tier": "fast", "fal_endpoint": "fal-ai/flux-2/turbo"}'),
      ('00000000-0000-0000-0005-000000000032', '00000000-0000-0000-0004-000000000003', 'fal/flux-2-flash', 'Flux 2 Flash (Ultra-Fast)', true, '[]', '{"tier": "fast", "fal_endpoint": "fal-ai/flux-2/flash"}'),
      ('00000000-0000-0000-0005-000000000033', '00000000-0000-0000-0004-000000000003', 'fal/flux-2-flex', 'Flux 2 Flex (Configurable)', true, '[]', '{"tier": "standard", "fal_endpoint": "fal-ai/flux-2-flex"}'),
      -- Identity/Editing
      ('00000000-0000-0000-0005-000000000040', '00000000-0000-0000-0004-000000000003', 'fal/flux-pulid', 'Flux PuLID (Face Identity)', true, '["ip_adapter", "img2img", "identity_preservation"]', '{"tier": "quality", "requires_reference_image": true, "fal_endpoint": "fal-ai/flux-pulid"}'),
      ('00000000-0000-0000-0005-000000000041', '00000000-0000-0000-0004-000000000003', 'fal/flux-kontext-pro', 'Flux Kontext Pro (Edit)', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/flux-pro/kontext"}'),
      ('00000000-0000-0000-0005-000000000042', '00000000-0000-0000-0004-000000000003', 'fal/flux-kontext-max', 'Flux Kontext Max (Premium Edit)', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/flux-pro/kontext/max"}'),
      ('00000000-0000-0000-0005-000000000043', '00000000-0000-0000-0004-000000000003', 'fal/flux-kontext-lora', 'Flux Kontext LoRA', true, '[]', '{"tier": "standard", "fal_endpoint": "fal-ai/flux-kontext-lora"}'),
      ('00000000-0000-0000-0005-000000000044', '00000000-0000-0000-0004-000000000003', 'fal/flux-lora', 'Flux Dev LoRA', true, '[]', '{"tier": "standard", "fal_endpoint": "fal-ai/flux-lora"}'),
      -- Other Quality Models
      ('00000000-0000-0000-0005-000000000050', '00000000-0000-0000-0004-000000000003', 'fal/flux-1.1-pro', 'Flux 1.1 Pro', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/flux-pro/v1.1"}'),
      ('00000000-0000-0000-0005-000000000051', '00000000-0000-0000-0004-000000000003', 'fal/recraft-v3', 'Recraft V3', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/recraft/v3/text-to-image"}'),
      ('00000000-0000-0000-0005-000000000052', '00000000-0000-0000-0004-000000000003', 'fal/qwen-image-2512', 'Qwen Image 2512', true, '[]', '{"tier": "quality", "fal_endpoint": "fal-ai/qwen-image-2512"}'),
      ('00000000-0000-0000-0005-000000000053', '00000000-0000-0000-0004-000000000003', 'fal/longcat-image', 'LongCat Image', true, '[]', '{"tier": "standard", "fal_endpoint": "fal-ai/longcat-image"}'),
      ('00000000-0000-0000-0005-000000000054', '00000000-0000-0000-0004-000000000003', 'fal/z-image-turbo', 'Z-Image Turbo (Super Fast)', true, '[]', '{"tier": "fast", "fal_endpoint": "fal-ai/z-image/turbo"}')
    ON CONFLICT (provider_config_id, model_id) DO UPDATE SET display_name = EXCLUDED.display_name
  `;

  console.log('[Seed] Created model configs (4 LLM + 25 image models)');

  // =========================================================================
  // Routing Rules
  // =========================================================================
  console.log('[Seed] Creating routing rules...');

  await sql`
    INSERT INTO routing_rules (id, use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
    VALUES
      -- LLM Routing
      ('00000000-0000-0000-0006-000000000001', 'chat_simple', 1, '00000000-0000-0000-0005-000000000002', 100, true, 2, 30000, '{}'),
      ('00000000-0000-0000-0006-000000000002', 'chat_complex', 1, '00000000-0000-0000-0005-000000000001', 100, true, 2, 60000, '{}'),
      ('00000000-0000-0000-0006-000000000003', 'memory_extraction', 1, '00000000-0000-0000-0005-000000000002', 100, true, 2, 30000, '{}'),
      ('00000000-0000-0000-0006-000000000004', 'summarization', 1, '00000000-0000-0000-0005-000000000002', 100, true, 2, 30000, '{}'),
      ('00000000-0000-0000-0006-000000000005', 'safety_check', 1, '00000000-0000-0000-0005-000000000002', 100, true, 2, 15000, '{}'),
      ('00000000-0000-0000-0006-000000000006', 'content_moderation', 1, '00000000-0000-0000-0005-000000000002', 100, true, 2, 15000, '{}'),
      -- Image Routing (different models for each use case)
      ('00000000-0000-0000-0006-000000000010', 'image_generation', 1, '00000000-0000-0000-0005-000000000016', 100, true, 2, 60000, '{"description": "flux-2-pro for general image generation"}'),
      ('00000000-0000-0000-0006-000000000011', 'image_anchor', 1, '00000000-0000-0000-0005-000000000012', 100, true, 2, 30000, '{"description": "seedream-4.5 for anchor/portrait creation"}'),
      ('00000000-0000-0000-0006-000000000012', 'image_variation', 1, '00000000-0000-0000-0005-000000000040', 100, true, 2, 60000, '{"description": "flux-pulid for identity-preserving variations"}')
    ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
      weight = EXCLUDED.weight,
      is_enabled = EXCLUDED.is_enabled,
      metadata = EXCLUDED.metadata
  `;

  console.log('[Seed] Created routing rules (6 LLM + 3 image)');

  console.log('[Seed] Database seed completed successfully!');

  return data;
}

async function main(): Promise<void> {
  const sql = createPool();

  try {
    await seed(sql);
  } catch (error) {
    console.error('[Seed] Error:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();

export { seed };
