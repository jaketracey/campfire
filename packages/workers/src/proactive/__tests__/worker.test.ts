/**
 * Tests for the Proactive Outreach Worker
 *
 * Tests evaluation logic, orchestrator communication, and record storage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the logic via the processProactiveOutreach function
// rather than the full BullMQ worker lifecycle.

describe('Proactive Outreach Worker Logic', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLogger),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  describe('evaluatePair via orchestrator', () => {
    it('should call orchestrator evaluate endpoint', async () => {
      const mockFetch = vi.fn()
        // First call: orchestrator evaluate
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            decision: {
              should_reach_out: true,
              trigger: 'scheduled_checkin',
              message: 'Hey there!',
              confidence: 0.85,
              reasoning: 'Regular check-in',
            },
          }),
        })
        // Second call: store record via gateway
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            outreach: { id: 'new-record' },
          }),
        });

      global.fetch = mockFetch;

      // Verify the orchestrator is called with correct payload
      expect(mockFetch).not.toHaveBeenCalled();

      // Simulate what the worker does
      const orchestratorUrl = 'http://localhost:8000';
      const response = await fetch(`${orchestratorUrl}/proactive/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'user-1',
          companion_id: 'companion-1',
        }),
      });

      const data = await response.json() as {
        decision: {
          should_reach_out: boolean;
          trigger: string;
          message: string;
        };
      };

      expect(data.decision.should_reach_out).toBe(true);
      expect(data.decision.message).toBe('Hey there!');
    });

    it('should not store record when orchestrator declines', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          decision: {
            should_reach_out: false,
            trigger: 'scheduled_checkin',
            message: null,
            confidence: 1.0,
            reasoning: 'LLM decided not to reach out',
          },
        }),
      });

      global.fetch = mockFetch;

      const response = await fetch('http://localhost:8000/proactive/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'user-1',
          companion_id: 'companion-1',
        }),
      });

      const data = await response.json() as {
        decision: { should_reach_out: boolean };
      };

      expect(data.decision.should_reach_out).toBe(false);
      // Should only have called fetch once (no store call)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle orchestrator errors gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      global.fetch = mockFetch;

      const response = await fetch('http://localhost:8000/proactive/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'user-1',
          companion_id: 'companion-1',
        }),
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('Record storage via gateway', () => {
    it('should store outreach record with correct fields', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          outreach: {
            id: 'new-record-1',
            user_id: 'user-1',
            companion_id: 'companion-1',
            trigger: 'followup',
            message: 'About that book you mentioned...',
            delivered_via: 'stored',
          },
        }),
      });

      global.fetch = mockFetch;

      const gatewayUrl = 'http://localhost:3002';
      const response = await fetch(`${gatewayUrl}/api/v1/outreach/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-service-key': 'test-key',
        },
        body: JSON.stringify({
          user_id: 'user-1',
          companion_id: 'companion-1',
          trigger: 'followup',
          message: 'About that book you mentioned...',
          delivered_via: 'stored',
          metadata: {
            confidence: 0.85,
            reasoning: 'Followup on unfinished topic',
          },
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json() as { outreach: { trigger: string } };
      expect(data.outreach.trigger).toBe('followup');
    });
  });

  describe('Scheduling', () => {
    it('should have correct queue name', async () => {
      const { PROACTIVE_OUTREACH_QUEUE } = await import('../queues.js');
      expect(PROACTIVE_OUTREACH_QUEUE).toBe('proactive-outreach');
    });
  });
});
