/**
 * K6 Load Test - WebSocket Connections
 * 
 * Tests WebSocket performance under load
 * 
 * Run with:
 *   k6 run --vus 20 --duration 1m packages/gateway/tests/load/k6-websocket-load.js
 */

import ws from 'k6/ws';
import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const wsConnectionDuration = new Trend('ws_connection_duration');
const wsMessageRoundTrip = new Trend('ws_message_roundtrip');
const wsErrorRate = new Rate('ws_error_rate');
const wsMessagesReceived = new Counter('ws_messages_received');
const wsMessagesSent = new Counter('ws_messages_sent');

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp up to 20 concurrent connections
    { duration: '1m', target: 20 },   // Hold at 20
    { duration: '30s', target: 50 },  // Spike to 50
    { duration: '1m', target: 50 },   // Hold at 50
    { duration: '30s', target: 100 }, // Spike to 100
    { duration: '30s', target: 100 }, // Hold at 100
    { duration: '30s', target: 0 },   // Ramp down
  ],

  thresholds: {
    ws_connection_duration: ['p(95)<300', 'p(99)<500'],
    ws_message_roundtrip: ['p(95)<100', 'p(99)<200'],
    ws_error_rate: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.WS_URL || 'ws://localhost:3000';

export function setup() {
  // Create test user and get token
  const http = require('k6/http');
  const registerRes = http.post(`http://localhost:3000/api/auth/register`, JSON.stringify({
    email: `ws-loadtest-${Date.now()}@example.com`,
    password: 'LoadTest123!',
    displayName: 'WS Load Test User',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (registerRes.status === 200 || registerRes.status === 201) {
    const data = JSON.parse(registerRes.body);
    return {
      token: data.token,
    };
  }

  return null;
}

export default function (data) {
  if (!data || !data.token) {
    console.error('No auth token available');
    wsErrorRate.add(1);
    return;
  }

  const url = `${BASE_URL}/ws`;
  const params = {
    headers: {
      'Authorization': `Bearer ${data.token}`,
    },
  };

  const connectStart = Date.now();

  const res = ws.connect(url, params, function (socket) {
    const connectDuration = Date.now() - connectStart;
    wsConnectionDuration.add(connectDuration);

    socket.on('open', () => {
      console.log('WebSocket connection established');

      // Send periodic messages
      socket.setInterval(() => {
        const sendTime = Date.now();
        const messageId = `msg-${sendTime}`;

        socket.send(JSON.stringify({
          id: messageId,
          type: 'ping',
          timestamp: sendTime,
        }));

        wsMessagesSent.add(1);
      }, 1000); // Send message every second
    });

    socket.on('message', (data) => {
      wsMessagesReceived.add(1);

      try {
        const message = JSON.parse(data);
        
        if (message.type === 'pong' && message.timestamp) {
          const roundTrip = Date.now() - message.timestamp;
          wsMessageRoundTrip.add(roundTrip);
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    });

    socket.on('error', (e) => {
      console.error('WebSocket error:', e);
      wsErrorRate.add(1);
    });

    socket.on('close', () => {
      console.log('WebSocket connection closed');
    });

    // Keep connection open for test duration
    socket.setTimeout(() => {
      socket.close();
    }, 30000); // 30 seconds per connection
  });

  check(res, {
    'WebSocket connection established': (r) => r && r.status === 101,
  }) || wsErrorRate.add(1);
}
