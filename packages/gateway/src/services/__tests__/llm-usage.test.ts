/**
 * LLMUsageService Unit Tests
 *
 * Tests for LLM usage tracking service including:
 * - Recording text generation usage
 * - Recording image generation usage
 * - Cost calculation for different models
 * - Budget tracking and limits
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

// Test UUIDs
const TEST_USER_ID = randomUUID();
const TEST_SESSION_ID = randomUUID();
const TEST_COMPANION_ID = randomUUID();
const TEST_TURN_ID = randomUUID();

// Create mock repository functions
const mockRecordUsage = vi.fn();
const mockGetUserBudget = vi.fn();
const mockUpdateUserBudget = vi.fn();
const mockSetUserBlocked = vi.fn();
const mockIsUserBlocked = vi.fn();
const mockCreateAlert = vi.fn();
const mockGetUnacknowledgedAlerts = vi.fn();

// Create mock LLM usage repository
const mockLLMUsageRepository = {
  recordUsage: mockRecordUsage,
  getUserBudget: mockGetUserBudget,
  updateUserBudget: mockUpdateUserBudget,
  setUserBlocked: mockSetUserBlocked,
  isUserBlocked: mockIsUserBlocked,
  getUserCostSummary: vi.fn(),
  getPlatformCostSummary: vi.fn(),
  getCostTrend: vi.fn(),
  getTopUsersByCost: vi.fn(),
  getCostByProvider: vi.fn(),
  getCostByModel: vi.fn(),
  listUsageEvents: vi.fn(),
  getDailyAggregates: vi.fn(),
  aggregateDailyCosts: vi.fn(),
  createAlert: mockCreateAlert,
  getUnacknowledgedAlerts: mockGetUnacknowledgedAlerts,
  acknowledgeAlert: vi.fn(),
};

// Create mock provider settings repository
const mockListModels = vi.fn();
const mockProviderSettingsRepository = {
  listModels: mockListModels,
  getModelByModelId: vi.fn(),
};

// Create mock events service
const mockEventsService = {
  emit: vi.fn(),
};

// Mock the repositories
vi.mock('../../repositories/index.js', () => ({
  getLLMUsageRepository: () => mockLLMUsageRepository,
  getProviderSettingsRepository: () => mockProviderSettingsRepository,
}));

// Mock the events service
vi.mock('../events.js', () => ({
  getEventsService: () => mockEventsService,
}));

// Mock the logger
vi.mock('../../observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    })),
  },
}));

// Import after mocking
import { LLMUsageService, getLLMUsageService } from '../llm-usage.js';

describe('LLMUsageService', () => {
  let service: LLMUsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LLMUsageService();

    // Default mock for recordUsage
    mockRecordUsage.mockResolvedValue({
      usage_id: 'test-usage-id',
      daily_usage: 0.50,
      monthly_usage: 5.00,
      daily_limit: 10.00,
      monthly_limit: 100.00,
      is_over_limit: false,
    });

    // Default mock for getUserBudget
    mockGetUserBudget.mockResolvedValue({
      user_id: 'test-user-id',
      daily_limit_usd: 10.00,
      monthly_limit_usd: 100.00,
      daily_usage_usd: 0.50,
      monthly_usage_usd: 5.00,
      alert_threshold_percent: 80,
      is_blocked: false,
    });

    // Default mock for alerts
    mockGetUnacknowledgedAlerts.mockResolvedValue([]);
    mockCreateAlert.mockResolvedValue({ id: 'test-alert-id', type: 'daily_warning', acknowledged: false });

    // Default mock for listModels (empty for text models)
    mockListModels.mockResolvedValue({ data: [], hasMore: false });
  });

  describe('calculateCost', () => {
    it('should calculate cost for Claude 3.5 Sonnet', () => {
      const cost = service.calculateCost(
        'anthropic.claude-3-5-sonnet-20241022-v2:0',
        1000, // 1000 input tokens
        500   // 500 output tokens
      );

      // Input: 1000 * $3.00/1M = $0.003
      // Output: 500 * $15.00/1M = $0.0075
      // Total: $0.0105
      expect(cost).toBeCloseTo(0.0105, 5);
    });

    it('should calculate cost for Claude 3 Haiku', () => {
      const cost = service.calculateCost(
        'anthropic.claude-3-haiku-20240307-v1:0',
        10000,
        5000
      );

      // Input: 10000 * $0.25/1M = $0.0025
      // Output: 5000 * $1.25/1M = $0.00625
      // Total: $0.00875
      expect(cost).toBeCloseTo(0.00875, 5);
    });

    it('should return 0 for Ollama (local)', () => {
      const cost = service.calculateCost('ollama', 10000, 5000);
      expect(cost).toBe(0);
    });

    it('should return 0 for unknown models', () => {
      const cost = service.calculateCost('unknown-model', 1000, 500);
      expect(cost).toBe(0);
    });
  });

  describe('recordUsage', () => {
    it('should record usage and return budget status', async () => {
      const input = {
        user_id: TEST_USER_ID,
        session_id: TEST_SESSION_ID,
        companion_id: TEST_COMPANION_ID,
        turn_id: TEST_TURN_ID,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0,
        latency_ms: 1500,
        request_type: 'chat' as const,
        stream_mode: true,
        request_started_at: new Date(),
        request_completed_at: new Date(),
      };

      const result = await service.recordUsage(input);

      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: TEST_USER_ID,
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          input_tokens: 1000,
          output_tokens: 500,
        }),
        undefined
      );

      expect(result.budget_status).toBeDefined();
      expect(result.budget_status.allowed).toBe(true);
    });

    it('should mark budget as over limit when exceeded', async () => {
      mockRecordUsage.mockResolvedValue({
        usage_id: 'test-usage-id',
        daily_usage: 11.00,
        monthly_usage: 50.00,
        daily_limit: 10.00,
        monthly_limit: 100.00,
        is_over_limit: true,
      });

      const input = {
        user_id: TEST_USER_ID,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        input_tokens: 100000,
        output_tokens: 50000,
        cost_usd: 0,
        request_started_at: new Date(),
        request_completed_at: new Date(),
      };

      const result = await service.recordUsage(input);

      expect(result.budget_status.allowed).toBe(false);
      expect(result.budget_status.reason).toContain('limit exceeded');
    });

    it('should emit usage event after recording', async () => {
      const input = {
        user_id: TEST_USER_ID,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0,
        request_started_at: new Date(),
        request_completed_at: new Date(),
      };

      await service.recordUsage(input);

      expect(mockEventsService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'llm.usage.recorded',
          payload: expect.objectContaining({
            provider: 'anthropic',
            model: 'claude-3-5-sonnet-20241022',
            inputTokens: 1000,
            outputTokens: 500,
          }),
        })
      );
    });
  });

  describe('getImageModelCost', () => {
    it('should return 0 for ComfyUI (local)', async () => {
      const cost = await service.getImageModelCost('comfyui/sdxl-base');
      expect(cost).toBe(0);
    });

    it('should return fallback cost for flux-schnell', async () => {
      const cost = await service.getImageModelCost('fal/flux-schnell');
      expect(cost).toBe(0.003);
    });

    it('should return fallback cost for flux-dev', async () => {
      const cost = await service.getImageModelCost('fal/flux-dev');
      expect(cost).toBe(0.025);
    });

    it('should return fallback cost for flux-pro', async () => {
      const cost = await service.getImageModelCost('fal/flux-1.1-pro');
      expect(cost).toBe(0.04);
    });

    it('should return cost from database if available', async () => {
      mockListModels.mockResolvedValue({
        data: [
          {
            model_id: 'fal/flux-custom',
            metadata: { cost_per_image: 0.05 },
          },
        ],
        hasMore: false,
      });

      const cost = await service.getImageModelCost('fal/flux-custom');
      expect(cost).toBe(0.05);
    });

    it('should return 0 for unknown models', async () => {
      const cost = await service.getImageModelCost('unknown/model');
      expect(cost).toBe(0);
    });
  });

  describe('recordImageUsage', () => {
    it('should record image usage with request_type=image', async () => {
      const input = {
        user_id: TEST_USER_ID,
        session_id: TEST_SESSION_ID,
        companion_id: TEST_COMPANION_ID,
        provider: 'fal',
        model: 'fal/flux-schnell',
        latency_ms: 2500,
        request_started_at: new Date(),
        request_completed_at: new Date(),
      };

      await service.recordImageUsage(input);

      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: TEST_USER_ID,
          provider: 'fal',
          model: 'fal/flux-schnell',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0.003, // flux-schnell fallback cost
          request_type: 'image',
        }),
        undefined
      );
    });

    it('should record ComfyUI images with zero cost', async () => {
      const input = {
        user_id: TEST_USER_ID,
        provider: 'comfyui',
        model: 'comfyui/sdxl-base',
        request_started_at: new Date(),
        request_completed_at: new Date(),
      };

      await service.recordImageUsage(input);

      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'comfyui',
          model: 'comfyui/sdxl-base',
          cost_usd: 0,
          request_type: 'image',
        }),
        undefined
      );
    });
  });

  describe('checkBudget', () => {
    it('should return allowed when within limits', async () => {
      const result = await service.checkBudget(TEST_USER_ID);

      expect(result.allowed).toBe(true);
      expect(result.daily_usage_usd).toBe(0.50);
      expect(result.monthly_usage_usd).toBe(5.00);
    });

    it('should return not allowed when blocked', async () => {
      mockGetUserBudget.mockResolvedValue({
        user_id: TEST_USER_ID,
        is_blocked: true,
        blocked_reason: 'Exceeded monthly limit',
      });

      const result = await service.checkBudget(TEST_USER_ID);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Exceeded monthly limit');
    });

    it('should return allowed when no budget is set', async () => {
      mockGetUserBudget.mockResolvedValue(null);

      const result = await service.checkBudget(TEST_USER_ID);

      expect(result.allowed).toBe(true);
    });
  });

  describe('singleton', () => {
    it('should return the same instance', () => {
      const instance1 = getLLMUsageService();
      const instance2 = getLLMUsageService();
      expect(instance1).toBe(instance2);
    });
  });
});
