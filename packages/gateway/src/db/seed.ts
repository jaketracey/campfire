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
      stripe_customer_id: 'cus_test_alice_001',
      stripe_subscription_id: 'sub_test_alice_001',
      status: 'active',
      plan: 'pro',
      voice_minutes_limit: 1000,
      message_limit: 10000,
      companion_limit: 5,
    },
    {
      user_id: '00000000-0000-0000-0000-000000000002',
      stripe_customer_id: 'cus_test_bob_001',
      stripe_subscription_id: 'sub_test_bob_001',
      status: 'active',
      plan: 'starter',
      voice_minutes_limit: 100,
      message_limit: 1000,
      companion_limit: 2,
    },
    {
      user_id: '00000000-0000-0000-0000-000000000003',
      stripe_customer_id: 'cus_test_charlie_001',
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
        user_id, stripe_customer_id, stripe_subscription_id,
        status, plan, voice_minutes_limit, message_limit, companion_limit,
        current_period_start, current_period_end
      )
      VALUES (
        ${sub.user_id}, ${sub.stripe_customer_id}, ${sub.stripe_subscription_id ?? null},
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
      stripe_price_id: 'price_tokens_starter_100',
      stripe_product_id: 'prod_tokens_starter',
      display_order: 1,
      bonus_tokens: 0,
    },
    {
      name: 'Popular Pack',
      description: 'Our most popular choice! Great value with bonus tokens.',
      tokens: 500,
      price_cents: 1999,
      currency: 'usd',
      stripe_price_id: 'price_tokens_popular_500',
      stripe_product_id: 'prod_tokens_popular',
      display_order: 2,
      bonus_tokens: 50,
    },
    {
      name: 'Best Value',
      description: 'The best value for dedicated gift-givers.',
      tokens: 1200,
      price_cents: 3999,
      currency: 'usd',
      stripe_price_id: 'price_tokens_value_1200',
      stripe_product_id: 'prod_tokens_value',
      display_order: 3,
      bonus_tokens: 200,
    },
    {
      name: 'Ultimate Pack',
      description: 'For the ultimate companion experience. Maximum savings!',
      tokens: 3000,
      price_cents: 7999,
      currency: 'usd',
      stripe_price_id: 'price_tokens_ultimate_3000',
      stripe_product_id: 'prod_tokens_ultimate',
      display_order: 4,
      bonus_tokens: 600,
    },
  ];

  for (const bundle of tokenBundles) {
    await sql`
      INSERT INTO token_bundles (
        name, description, tokens, price_cents, currency,
        stripe_price_id, stripe_product_id, display_order, bonus_tokens, is_active
      )
      VALUES (
        ${bundle.name}, ${bundle.description}, ${bundle.tokens}, ${bundle.price_cents}, ${bundle.currency},
        ${bundle.stripe_price_id}, ${bundle.stripe_product_id}, ${bundle.display_order}, ${bundle.bonus_tokens}, TRUE
      )
      ON CONFLICT (stripe_price_id) DO UPDATE SET
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
