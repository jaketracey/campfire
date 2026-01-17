/**
 * End-to-End Conversation Flow Tests
 * 
 * Tests complete user flows with performance metrics
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../../src/index';
import {
  measure,
  calculateMetrics,
  formatDuration,
  sleep,
} from '../performance/setup';

// Performance thresholds for E2E flows
const THRESHOLDS = {
  userRegistration: { max: 500 },
  companionCreation: { max: 300 },
  sessionSetup: { max: 400 },
  messageExchange: { max: 2000 },
  fullConversationFlow: { max: 5000 },
} as const;

describe('E2E Conversation Flow Performance', () => {
  let app: FastifyInstance;
  let wsPort: number;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.listen({ port: 0 });

    const address = app.server.address();
    wsPort = typeof address === 'string' ? 3000 : (address?.port || 3000);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should complete full user registration flow', async () => {
    const userEmail = `e2e-${Date.now()}@example.com`;

    const { duration, result } = await measure(async () => {
      // Step 1: Register
      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: userEmail,
          password: 'TestPassword123!',
          displayName: 'E2E Test User',
        },
      });

      expect(registerRes.statusCode).toBe(201);
      const registerData = JSON.parse(registerRes.payload);

      // Step 2: Verify can access profile
      const profileRes = await app.inject({
        method: 'GET',
        url: '/api/users/me',
        headers: {
          authorization: `Bearer ${registerData.token}`,
        },
      });

      expect(profileRes.statusCode).toBe(200);
      const profileData = JSON.parse(profileRes.payload);

      return {
        user: profileData,
        token: registerData.token,
      };
    });

    console.log(`\nUser Registration Flow:`);
    console.log(`  Duration: ${formatDuration(duration)}`);
    console.log(`  User ID: ${result.user.id}`);

    expect(duration).toBeLessThan(THRESHOLDS.userRegistration.max);
    expect(result.user.email).toBe(userEmail);
  });

  it('should complete full conversation setup flow', async () => {
    // Setup user
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `e2e-conversation-${Date.now()}@example.com`,
        password: 'TestPassword123!',
        displayName: 'Conversation Test User',
      },
    });

    const { token } = JSON.parse(authRes.payload);
    const headers = { authorization: `Bearer ${token}` };

    const { duration, result } = await measure(async () => {
      // Step 1: Create companion
      const companionStart = performance.now();
      const companionRes = await app.inject({
        method: 'POST',
        url: '/api/companions',
        headers,
        payload: {
          name: 'Test Companion',
          personality: 'friendly and helpful',
          description: 'A test companion for E2E testing',
        },
      });

      expect(companionRes.statusCode).toBe(201);
      const companion = JSON.parse(companionRes.payload);
      const companionDuration = performance.now() - companionStart;

      // Step 2: Create session
      const sessionStart = performance.now();
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers,
        payload: {
          companionId: companion.id,
        },
      });

      expect(sessionRes.statusCode).toBe(201);
      const session = JSON.parse(sessionRes.payload);
      const sessionDuration = performance.now() - sessionStart;

      return {
        companion,
        session,
        timings: {
          companion: companionDuration,
          session: sessionDuration,
        },
      };
    });

    console.log(`\nConversation Setup Flow:`);
    console.log(`  Total Duration: ${formatDuration(duration)}`);
    console.log(`  Companion Creation: ${formatDuration(result.timings.companion)}`);
    console.log(`  Session Creation: ${formatDuration(result.timings.session)}`);

    expect(duration).toBeLessThan(THRESHOLDS.sessionSetup.max + THRESHOLDS.companionCreation.max);
    expect(result.session.companionId).toBe(result.companion.id);
  });

  it('should complete message exchange flow with timing', async () => {
    // Setup
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `e2e-message-${Date.now()}@example.com`,
        password: 'TestPassword123!',
        displayName: 'Message Test User',
      },
    });

    const { token } = JSON.parse(authRes.payload);
    const headers = { authorization: `Bearer ${token}` };

    // Create companion and session
    const companionRes = await app.inject({
      method: 'POST',
      url: '/api/companions',
      headers,
      payload: { name: 'Test Companion', personality: 'friendly' },
    });
    const companion = JSON.parse(companionRes.payload);

    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers,
      payload: { companionId: companion.id },
    });
    const session = JSON.parse(sessionRes.payload);

    // Test message exchange
    const messageCount = 5;
    const messageDurations: number[] = [];

    for (let i = 0; i < messageCount; i++) {
      const { duration } = await measure(async () => {
        const messageRes = await app.inject({
          method: 'POST',
          url: `/api/sessions/${session.id}/messages`,
          headers,
          payload: {
            content: `Test message ${i + 1}`,
          },
        });

        expect(messageRes.statusCode).toBe(201);
        return JSON.parse(messageRes.payload);
      });

      messageDurations.push(duration);
    }

    const metrics = calculateMetrics(messageDurations);

    console.log(`\nMessage Exchange Flow (${messageCount} messages):`);
    console.log(`  p50: ${formatDuration(metrics.p50)}`);
    console.log(`  p95: ${formatDuration(metrics.p95)}`);
    console.log(`  Mean: ${formatDuration(metrics.mean)}`);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.messageExchange.max);
  });

  it('should complete full conversation flow end-to-end', async () => {
    const { duration, result } = await measure(async () => {
      // Complete flow: Register -> Create Companion -> Create Session -> Send Messages
      const timings: Record<string, number> = {};

      // Step 1: Register
      const registerStart = performance.now();
      const authRes = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: `e2e-full-${Date.now()}@example.com`,
          password: 'TestPassword123!',
          displayName: 'Full Flow Test User',
        },
      });
      timings.register = performance.now() - registerStart;

      const { token } = JSON.parse(authRes.payload);
      const headers = { authorization: `Bearer ${token}` };

      // Step 2: Create Companion
      const companionStart = performance.now();
      const companionRes = await app.inject({
        method: 'POST',
        url: '/api/companions',
        headers,
        payload: {
          name: 'Full Test Companion',
          personality: 'conversational',
        },
      });
      timings.companion = performance.now() - companionStart;

      const companion = JSON.parse(companionRes.payload);

      // Step 3: Create Session
      const sessionStart = performance.now();
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers,
        payload: { companionId: companion.id },
      });
      timings.session = performance.now() - sessionStart;

      const session = JSON.parse(sessionRes.payload);

      // Step 4: Send initial message
      const messageStart = performance.now();
      const messageRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages`,
        headers,
        payload: {
          content: 'Hello! This is a test message.',
        },
      });
      timings.message = performance.now() - messageStart;

      const message = JSON.parse(messageRes.payload);

      // Step 5: Retrieve conversation history
      const historyStart = performance.now();
      const historyRes = await app.inject({
        method: 'GET',
        url: `/api/sessions/${session.id}/messages`,
        headers,
      });
      timings.history = performance.now() - historyStart;

      const messages = JSON.parse(historyRes.payload);

      return {
        session,
        message,
        messageCount: messages.length,
        timings,
      };
    });

    console.log(`\nFull Conversation Flow:`);
    console.log(`  Total Duration: ${formatDuration(duration)}`);
    console.log(`  Breakdown:`);
    console.log(`    Registration: ${formatDuration(result.timings.register)}`);
    console.log(`    Companion: ${formatDuration(result.timings.companion)}`);
    console.log(`    Session: ${formatDuration(result.timings.session)}`);
    console.log(`    Message: ${formatDuration(result.timings.message)}`);
    console.log(`    History: ${formatDuration(result.timings.history)}`);

    expect(duration).toBeLessThan(THRESHOLDS.fullConversationFlow.max);
    expect(result.messageCount).toBeGreaterThan(0);
  });

  it('should handle WebSocket conversation flow', async () => {
    // Setup
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `e2e-ws-${Date.now()}@example.com`,
        password: 'TestPassword123!',
        displayName: 'WebSocket Test User',
      },
    });

    const { token } = JSON.parse(authRes.payload);

    const { duration, result } = await measure(async () => {
      const wsUrl = `ws://localhost:${wsPort}/ws`;
      const timings: Record<string, number> = {};

      // Connect to WebSocket
      const connectStart = performance.now();
      const ws = new WebSocket(wsUrl, {
        headers: { authorization: `Bearer ${token}` },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          timings.connect = performance.now() - connectStart;
          resolve();
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      // Send message and measure round-trip
      const messageStart = performance.now();
      let responseReceived = false;

      const responsePromise = new Promise<void>((resolve) => {
        ws.on('message', (data) => {
          if (!responseReceived) {
            timings.messageRoundTrip = performance.now() - messageStart;
            responseReceived = true;
            resolve();
          }
        });
      });

      ws.send(JSON.stringify({
        type: 'message',
        content: 'WebSocket test message',
      }));

      await Promise.race([
        responsePromise,
        sleep(5000).then(() => {
          throw new Error('Message response timeout');
        }),
      ]);

      ws.close();

      return { timings };
    });

    console.log(`\nWebSocket Conversation Flow:`);
    console.log(`  Total Duration: ${formatDuration(duration)}`);
    console.log(`  Connection Time: ${formatDuration(result.timings.connect)}`);
    console.log(`  Message Round-Trip: ${formatDuration(result.timings.messageRoundTrip)}`);

    expect(result.timings.connect).toBeLessThan(300);
    expect(result.timings.messageRoundTrip).toBeLessThan(1000);
  });

  it('should handle group chat with multiple companions', async () => {
    // Setup
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `e2e-group-${Date.now()}@example.com`,
        password: 'TestPassword123!',
        displayName: 'Group Chat Test User',
      },
    });

    const { token } = JSON.parse(authRes.payload);
    const headers = { authorization: `Bearer ${token}` };

    const { duration, result } = await measure(async () => {
      const companionCount = 3;
      const companions = [];

      // Create multiple companions
      const companionStart = performance.now();
      for (let i = 0; i < companionCount; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/companions',
          headers,
          payload: {
            name: `Group Companion ${i + 1}`,
            personality: `personality-${i}`,
          },
        });
        companions.push(JSON.parse(res.payload));
      }
      const companionsDuration = performance.now() - companionStart;

      // Create sessions for each
      const sessionStart = performance.now();
      const sessions = [];
      for (const companion of companions) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers,
          payload: { companionId: companion.id },
        });
        sessions.push(JSON.parse(res.payload));
      }
      const sessionsDuration = performance.now() - sessionStart;

      // Send message to each session
      const messagingStart = performance.now();
      for (const session of sessions) {
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${session.id}/messages`,
          headers,
          payload: { content: 'Group message test' },
        });
      }
      const messagingDuration = performance.now() - messagingStart;

      return {
        companionCount,
        sessionCount: sessions.length,
        timings: {
          companions: companionsDuration,
          sessions: sessionsDuration,
          messaging: messagingDuration,
        },
      };
    });

    console.log(`\nGroup Chat Flow (${result.companionCount} companions):`);
    console.log(`  Total Duration: ${formatDuration(duration)}`);
    console.log(`  Create Companions: ${formatDuration(result.timings.companions)}`);
    console.log(`  Create Sessions: ${formatDuration(result.timings.sessions)}`);
    console.log(`  Send Messages: ${formatDuration(result.timings.messaging)}`);

    expect(result.sessionCount).toBe(result.companionCount);
    expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
  });
});
