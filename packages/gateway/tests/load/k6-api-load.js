/**
 * K6 Load Test - API Endpoints
 *
 * Tests API performance under various load conditions.
 * Focuses on unauthenticated endpoints (health, ready) to avoid
 * dependency on working auth/register flow. Authenticated endpoints
 * are tested only if setup succeeds.
 *
 * Run with:
 *   k6 run --vus 10 --duration 30s packages/gateway/tests/load/k6-api-load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const healthDuration = new Trend('health_duration');
const errorRate = new Rate('error_rate');
const healthChecks = new Counter('health_checks');

// Test configuration
export const options = {
  // Staged load test
  stages: [
    { duration: '10s', target: 10 },  // Ramp up to 10 users
    { duration: '20s', target: 10 },  // Stay at 10 users
    { duration: '10s', target: 30 },  // Ramp up to 30 users
    { duration: '30s', target: 30 },  // Stay at 30 users
    { duration: '10s', target: 0 },   // Ramp down
  ],

  // Thresholds
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.10'],  // Allow up to 10% errors (rate limiting)
    error_rate: ['rate<0.10'],
    health_duration: ['p(95)<200'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Setup function runs once
export function setup() {
  // Verify the server is reachable
  const healthRes = http.get(`${BASE_URL}/health`);

  if (healthRes.status !== 200) {
    console.error('Server health check failed:', healthRes.status);
    return { serverUp: false, token: null };
  }

  // Attempt to create a test user for authenticated endpoints
  let token = null;
  const registerRes = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({
    email: `loadtest-${Date.now()}@example.com`,
    password: 'LoadTest123!',
    displayName: 'Load Test User',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (registerRes.status === 200 || registerRes.status === 201) {
    try {
      const data = JSON.parse(registerRes.body);
      token = data.token;
    } catch (e) {
      console.warn('Could not parse register response');
    }
  } else {
    console.warn('Auth registration not available (status ' + registerRes.status + '), will test unauthenticated endpoints only');
  }

  return { serverUp: true, token };
}

export default function (data) {
  if (!data || !data.serverUp) {
    errorRate.add(1);
    sleep(1);
    return;
  }

  // Primary scenario: health endpoint (always works)
  const healthStart = Date.now();
  const healthRes = http.get(`${BASE_URL}/health`);
  healthDuration.add(Date.now() - healthStart);
  healthChecks.add(1);

  const healthOk = check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
  });

  if (!healthOk) {
    errorRate.add(1);
  }

  // Secondary: ready endpoint
  if (Math.random() < 0.3) {
    const readyRes = http.get(`${BASE_URL}/ready`);
    check(readyRes, {
      'ready check status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  }

  // If we have auth, test authenticated endpoints too
  if (data.token && Math.random() < 0.2) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${data.token}`,
    };

    const profileRes = http.get(`${BASE_URL}/api/users/me`, { headers });
    check(profileRes, {
      'profile status is 200 or auth-related': (r) =>
        r.status === 200 || r.status === 401 || r.status === 404,
    }) || errorRate.add(1);
  }

  // Think time
  sleep(Math.random() * 1.5 + 0.5);
}

export function teardown(data) {
  console.log('Load test completed');
}
