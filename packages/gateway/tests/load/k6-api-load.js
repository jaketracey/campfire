/**
 * K6 Load Test - API Endpoints
 * 
 * Tests API performance under various load conditions
 * 
 * Run with:
 *   k6 run --vus 10 --duration 30s packages/gateway/tests/load/k6-api-load.js
 *   k6 run --vus 50 --duration 2m packages/gateway/tests/load/k6-api-load.js
 *   k6 run packages/gateway/tests/load/k6-api-load.js (uses stages defined below)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const loginDuration = new Trend('login_duration');
const sessionCreateDuration = new Trend('session_create_duration');
const messagePostDuration = new Trend('message_post_duration');
const errorRate = new Rate('error_rate');
const successfulLogins = new Counter('successful_logins');

// Test configuration
export const options = {
  // Staged load test
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users
    { duration: '1m', target: 10 },   // Stay at 10 users
    { duration: '30s', target: 50 },  // Ramp up to 50 users
    { duration: '2m', target: 50 },   // Stay at 50 users
    { duration: '30s', target: 100 }, // Spike to 100 users
    { duration: '1m', target: 100 },  // Stay at 100 users
    { duration: '30s', target: 0 },   // Ramp down
  ],

  // Thresholds - test fails if these are exceeded
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% under 500ms, 99% under 1s
    http_req_failed: ['rate<0.05'], // Less than 5% errors
    login_duration: ['p(95)<300'],
    session_create_duration: ['p(95)<600'],
    message_post_duration: ['p(95)<400'],
    error_rate: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Setup function runs once per VU
export function setup() {
  // Create a test user that all VUs can use for auth
  const registerRes = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({
    email: `loadtest-${Date.now()}@example.com`,
    password: 'LoadTest123!',
    displayName: 'Load Test User',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (registerRes.status === 200 || registerRes.status === 201) {
    const data = JSON.parse(registerRes.body);
    return {
      token: data.token,
      userId: data.user.id,
    };
  }

  console.error('Failed to create test user:', registerRes.status, registerRes.body);
  return null;
}

export default function (data) {
  if (!data || !data.token) {
    console.error('No auth token available');
    errorRate.add(1);
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`,
  };

  // Scenario 1: Check health endpoint (10% of requests)
  if (Math.random() < 0.1) {
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      'health check status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  }

  // Scenario 2: Login (20% of requests)
  if (Math.random() < 0.2) {
    const loginStart = Date.now();
    const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
      email: `loadtest-${Date.now()}@example.com`,
      password: 'LoadTest123!',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

    const duration = Date.now() - loginStart;
    loginDuration.add(duration);

    const success = check(res, {
      'login status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    });

    if (!success) {
      errorRate.add(1);
    } else if (res.status === 200) {
      successfulLogins.add(1);
    }
  }

  // Scenario 3: Get user profile (30% of requests)
  if (Math.random() < 0.3) {
    const res = http.get(`${BASE_URL}/api/users/me`, { headers });
    check(res, {
      'profile status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  }

  // Scenario 4: List companions (20% of requests)
  if (Math.random() < 0.2) {
    const res = http.get(`${BASE_URL}/api/companions`, { headers });
    check(res, {
      'companions list status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    }) || errorRate.add(1);
  }

  // Scenario 5: Create session (10% of requests)
  if (Math.random() < 0.1) {
    // First create a companion
    const companionRes = http.post(`${BASE_URL}/api/companions`, JSON.stringify({
      name: `Test Companion ${Date.now()}`,
      personality: 'friendly',
    }), { headers });

    if (companionRes.status === 200 || companionRes.status === 201) {
      const companion = JSON.parse(companionRes.body);
      
      const sessionStart = Date.now();
      const sessionRes = http.post(`${BASE_URL}/api/sessions`, JSON.stringify({
        companionId: companion.id,
      }), { headers });

      const duration = Date.now() - sessionStart;
      sessionCreateDuration.add(duration);

      check(sessionRes, {
        'session create status is 201': (r) => r.status === 201,
      }) || errorRate.add(1);
    }
  }

  // Scenario 6: Post message (10% of requests)
  if (Math.random() < 0.1) {
    // Get or create a session first
    const sessionsRes = http.get(`${BASE_URL}/api/sessions?limit=1`, { headers });
    
    if (sessionsRes.status === 200) {
      const sessions = JSON.parse(sessionsRes.body);
      
      if (sessions.length > 0) {
        const messageStart = Date.now();
        const messageRes = http.post(
          `${BASE_URL}/api/sessions/${sessions[0].id}/messages`,
          JSON.stringify({
            content: `Load test message ${Date.now()}`,
          }),
          { headers }
        );

        const duration = Date.now() - messageStart;
        messagePostDuration.add(duration);

        check(messageRes, {
          'message post status is 201': (r) => r.status === 201,
        }) || errorRate.add(1);
      }
    }
  }

  // Think time - simulate user pausing between actions
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}

// Teardown runs once at the end
export function teardown(data) {
  console.log('Load test completed');
}
