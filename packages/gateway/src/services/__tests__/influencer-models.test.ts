/**
 * Influencer Models Service Tests
 *
 * Tests for the influencer models service layer including:
 * - Model CRUD operations
 * - Image upload flow
 * - Training workflow
 * - Sample generation
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock dependencies before imports
const mockRepository = {
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  count: vi.fn(),
  countByStatus: vi.fn(),
  createSample: vi.fn(),
  findSampleById: vi.fn(),
  updateSample: vi.fn(),
  listSamples: vi.fn(),
  deleteSample: vi.fn(),
  getPendingSamples: vi.fn(),
};

const mockS3Client = {
  send: vi.fn(),
};

const mockGetSignedUrl = vi.fn();

vi.mock('../../repositories/influencer-models.js', () => ({
  getInfluencerModelsRepository: () => mockRepository,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => mockS3Client),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

vi.mock('archiver', () => ({
  default: vi.fn(() => ({
    pipe: vi.fn(),
    append: vi.fn(),
    finalize: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'end') setTimeout(cb, 0);
    }),
  })),
}));

vi.mock('../../observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock('../../env.js', () => ({
  env: {
    S3_MEDIA_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    FAL_API_KEY: 'test-fal-key',
  },
}));

// Import after mocking
import { InfluencerModelsService, CreateModelSchema, GenerateSampleSchema } from '../influencer-models.js';
import type { InfluencerModel, InfluencerModelSample } from '../../repositories/influencer-models.js';

// Test fixtures
const mockModelId = '550e8400-e29b-41d4-a716-446655440001';
const mockSampleId = '550e8400-e29b-41d4-a716-446655440002';

const createMockModel = (overrides: Partial<InfluencerModel> = {}): InfluencerModel => ({
  id: mockModelId,
  name: 'Test Model',
  trigger_word: 'testmodel',
  training_steps: 1000,
  is_style: false,
  status: 'pending',
  status_message: null,
  training_images_s3_keys: [],
  training_zip_s3_key: null,
  lora_s3_key: null,
  fal_training_job_id: null,
  fal_result_url: null,
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z'),
  training_started_at: null,
  training_completed_at: null,
  ...overrides,
});

const createMockSample = (overrides: Partial<InfluencerModelSample> = {}): InfluencerModelSample => ({
  id: mockSampleId,
  model_id: mockModelId,
  prompt: 'A test prompt',
  negative_prompt: null,
  guidance_scale: 7.5,
  lora_scale: 1.0,
  num_inference_steps: 28,
  seed: null,
  width: 768,
  height: 1024,
  status: 'pending',
  error_message: null,
  fal_request_id: null,
  image_s3_key: null,
  image_url: null,
  created_at: new Date('2025-01-01T00:00:00Z'),
  completed_at: null,
  ...overrides,
});

describe('InfluencerModelsService', () => {
  let service: InfluencerModelsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InfluencerModelsService();
  });

  // ===========================================================================
  // Schema Validation Tests
  // ===========================================================================

  describe('CreateModelSchema', () => {
    it('should validate a correct model creation input', () => {
      const input = {
        name: 'Sarah Johnson',
        trigger_word: 'sarahj',
        training_steps: 1000,
        is_style: false,
      };

      const result = CreateModelSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid trigger word with spaces', () => {
      const input = {
        name: 'Test Model',
        trigger_word: 'invalid trigger',
      };

      const result = CreateModelSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid trigger word with uppercase', () => {
      const input = {
        name: 'Test Model',
        trigger_word: 'InvalidTrigger',
      };

      const result = CreateModelSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should allow underscores in trigger word', () => {
      const input = {
        name: 'Test Model',
        trigger_word: 'test_trigger_word',
      };

      const result = CreateModelSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should apply default values', () => {
      const input = {
        name: 'Test Model',
        trigger_word: 'testmodel',
      };

      const result = CreateModelSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.training_steps).toBe(1000);
        expect(result.data.is_style).toBe(false);
      }
    });

    it('should reject training steps outside valid range', () => {
      const input = {
        name: 'Test Model',
        trigger_word: 'testmodel',
        training_steps: 50, // Below 100
      };

      const result = CreateModelSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('GenerateSampleSchema', () => {
    it('should validate a correct sample generation input', () => {
      const input = {
        prompt: 'A portrait photo of a person',
        guidance_scale: 7.5,
        lora_scale: 1.0,
        num_inference_steps: 28,
        width: 768,
        height: 1024,
      };

      const result = GenerateSampleSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should require a prompt', () => {
      const input = {
        guidance_scale: 7.5,
      };

      const result = GenerateSampleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should apply default values for optional fields', () => {
      const input = {
        prompt: 'A test prompt',
      };

      const result = GenerateSampleSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.guidance_scale).toBe(7.5);
        expect(result.data.lora_scale).toBe(1.0);
        expect(result.data.num_inference_steps).toBe(28);
        expect(result.data.width).toBe(768);
        expect(result.data.height).toBe(1024);
      }
    });

    it('should reject invalid guidance scale', () => {
      const input = {
        prompt: 'Test',
        guidance_scale: 25, // Above 20
      };

      const result = GenerateSampleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid lora scale', () => {
      const input = {
        prompt: 'Test',
        lora_scale: 2.0, // Above 1.5
      };

      const result = GenerateSampleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // Model CRUD Tests
  // ===========================================================================

  describe('create', () => {
    it('should create a new model', async () => {
      const mockModel = createMockModel();
      mockRepository.create.mockResolvedValue(mockModel);

      const result = await service.create({
        name: 'Test Model',
        trigger_word: 'testmodel',
        training_steps: 1000,
        is_style: false,
      });

      expect(result).toEqual(mockModel);
      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Model',
          trigger_word: 'testmodel',
        }),
        undefined
      );
    });
  });

  describe('getById', () => {
    it('should return model when found', async () => {
      const mockModel = createMockModel();
      mockRepository.findById.mockResolvedValue(mockModel);

      const result = await service.getById(mockModelId);

      expect(result).toEqual(mockModel);
      expect(mockRepository.findById).toHaveBeenCalledWith(mockModelId, undefined);
    });

    it('should return null when not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await service.getById(mockModelId);

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update a model', async () => {
      const mockModel = createMockModel();
      const updatedModel = { ...mockModel, name: 'Updated Name' };
      mockRepository.findById.mockResolvedValue(mockModel);
      mockRepository.update.mockResolvedValue(updatedModel);

      const result = await service.update(mockModelId, { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(mockRepository.update).toHaveBeenCalled();
    });

    it('should throw error when model not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.update(mockModelId, { name: 'Test' })).rejects.toThrow(
        'Model not found'
      );
    });
  });

  describe('delete', () => {
    it('should delete a model', async () => {
      const mockModel = createMockModel();
      mockRepository.findById.mockResolvedValue(mockModel);
      mockRepository.delete.mockResolvedValue(undefined);

      await expect(service.delete(mockModelId)).resolves.not.toThrow();
      expect(mockRepository.delete).toHaveBeenCalledWith(mockModelId, undefined);
    });

    it('should throw error when model not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.delete(mockModelId)).rejects.toThrow('Model not found');
    });
  });

  describe('list', () => {
    it('should list models with pagination', async () => {
      const mockModels = [createMockModel({ id: '1' }), createMockModel({ id: '2' })];
      mockRepository.list.mockResolvedValue(mockModels);
      mockRepository.count.mockResolvedValue(2);

      const result = await service.list({ limit: 10, offset: 0 });

      expect(result.data).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('should indicate hasMore when more models exist', async () => {
      const mockModels = Array(10)
        .fill(null)
        .map((_, i) => createMockModel({ id: `${i}` }));
      mockRepository.list.mockResolvedValue(mockModels);
      mockRepository.count.mockResolvedValue(25);

      const result = await service.list({ limit: 10, offset: 0 });

      expect(result.hasMore).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return model statistics', async () => {
      mockRepository.count.mockResolvedValue(10);
      mockRepository.countByStatus.mockImplementation((status) => {
        const counts: Record<string, number> = {
          ready: 5,
          training: 2,
          failed: 1,
        };
        return Promise.resolve(counts[status] || 0);
      });

      const result = await service.getStats();

      expect(result).toEqual({
        total: 10,
        ready: 5,
        training: 2,
        failed: 1,
      });
    });
  });

  // ===========================================================================
  // Presigned URL Tests
  // ===========================================================================

  describe('getPresignedUploadUrl', () => {
    it('should generate presigned URL for valid model', async () => {
      const mockModel = createMockModel({ training_images_s3_keys: [] });
      mockRepository.findById.mockResolvedValue(mockModel);
      mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/presigned-url');

      const result = await service.getPresignedUploadUrl(
        mockModelId,
        'image.jpg',
        'image/jpeg'
      );

      expect(result.uploadUrl).toBe('https://s3.amazonaws.com/presigned-url');
      expect(result.s3Key).toContain(mockModelId);
      expect(result.s3Key).toContain('.jpg');
    });

    it('should throw when model not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(
        service.getPresignedUploadUrl(mockModelId, 'image.jpg', 'image/jpeg')
      ).rejects.toThrow('Model not found');
    });

    it('should throw when model is not in uploadable state', async () => {
      const mockModel = createMockModel({ status: 'training' });
      mockRepository.findById.mockResolvedValue(mockModel);

      await expect(
        service.getPresignedUploadUrl(mockModelId, 'image.jpg', 'image/jpeg')
      ).rejects.toThrow('Cannot add images');
    });

    it('should throw when max images reached', async () => {
      const mockModel = createMockModel({
        training_images_s3_keys: Array(25).fill('key'),
      });
      mockRepository.findById.mockResolvedValue(mockModel);

      await expect(
        service.getPresignedUploadUrl(mockModelId, 'image.jpg', 'image/jpeg')
      ).rejects.toThrow('Maximum');
    });
  });

  // ===========================================================================
  // Sample Generation Tests
  // ===========================================================================

  describe('generateSample', () => {
    it('should create sample and start generation', async () => {
      const mockModel = createMockModel({
        status: 'ready',
        fal_result_url: 'https://fal.ai/lora.safetensors',
      });
      const mockSample = createMockSample();
      mockRepository.findById.mockResolvedValue(mockModel);
      mockRepository.createSample.mockResolvedValue(mockSample);

      // Mock fetch for FAL API
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            images: [{ url: 'https://fal.ai/image.png' }],
          }),
      });

      const result = await service.generateSample(mockModelId, {
        prompt: 'A portrait photo',
        guidance_scale: 7.5,
        lora_scale: 1.0,
        num_inference_steps: 28,
        width: 768,
        height: 1024,
      });

      expect(result.id).toBe(mockSampleId);
      expect(mockRepository.createSample).toHaveBeenCalled();
    });

    it('should throw when model not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(
        service.generateSample(mockModelId, {
          prompt: 'Test',
          guidance_scale: 7.5,
          lora_scale: 1.0,
          num_inference_steps: 28,
          width: 768,
          height: 1024,
        })
      ).rejects.toThrow('Model not found');
    });

    it('should throw when model not ready', async () => {
      const mockModel = createMockModel({ status: 'training' });
      mockRepository.findById.mockResolvedValue(mockModel);

      await expect(
        service.generateSample(mockModelId, {
          prompt: 'Test',
          guidance_scale: 7.5,
          lora_scale: 1.0,
          num_inference_steps: 28,
          width: 768,
          height: 1024,
        })
      ).rejects.toThrow('not ready');
    });

    it('should throw when model has no LoRA URL', async () => {
      const mockModel = createMockModel({
        status: 'ready',
        fal_result_url: null,
      });
      mockRepository.findById.mockResolvedValue(mockModel);

      await expect(
        service.generateSample(mockModelId, {
          prompt: 'Test',
          guidance_scale: 7.5,
          lora_scale: 1.0,
          num_inference_steps: 28,
          width: 768,
          height: 1024,
        })
      ).rejects.toThrow('no LoRA URL');
    });
  });

  describe('getSample', () => {
    it('should return sample when found', async () => {
      const mockSample = createMockSample();
      mockRepository.findSampleById.mockResolvedValue(mockSample);

      const result = await service.getSample(mockSampleId);

      expect(result).toEqual(mockSample);
    });

    it('should return null when not found', async () => {
      mockRepository.findSampleById.mockResolvedValue(null);

      const result = await service.getSample(mockSampleId);

      expect(result).toBeNull();
    });
  });

  describe('listSamples', () => {
    it('should list samples for a model', async () => {
      const mockSamples = [
        createMockSample({ id: '1' }),
        createMockSample({ id: '2' }),
      ];
      mockRepository.listSamples.mockResolvedValue(mockSamples);

      const result = await service.listSamples(mockModelId);

      expect(result).toHaveLength(2);
      expect(mockRepository.listSamples).toHaveBeenCalledWith(
        mockModelId,
        50,
        undefined
      );
    });

    it('should respect limit parameter', async () => {
      mockRepository.listSamples.mockResolvedValue([]);

      await service.listSamples(mockModelId, 10);

      expect(mockRepository.listSamples).toHaveBeenCalledWith(mockModelId, 10, undefined);
    });
  });

  describe('deleteSample', () => {
    it('should delete sample and S3 object', async () => {
      const mockSample = createMockSample({
        image_s3_key: 'samples/test.png',
      });
      mockRepository.findSampleById.mockResolvedValue(mockSample);
      mockRepository.deleteSample.mockResolvedValue(undefined);
      mockS3Client.send.mockResolvedValue({});

      await expect(service.deleteSample(mockSampleId)).resolves.not.toThrow();
      expect(mockRepository.deleteSample).toHaveBeenCalledWith(mockSampleId, undefined);
      expect(mockS3Client.send).toHaveBeenCalled();
    });

    it('should throw when sample not found', async () => {
      mockRepository.findSampleById.mockResolvedValue(null);

      await expect(service.deleteSample(mockSampleId)).rejects.toThrow(
        'Sample not found'
      );
    });

    it('should delete sample even if S3 deletion fails', async () => {
      const mockSample = createMockSample({
        image_s3_key: 'samples/test.png',
      });
      mockRepository.findSampleById.mockResolvedValue(mockSample);
      mockRepository.deleteSample.mockResolvedValue(undefined);
      mockS3Client.send.mockRejectedValue(new Error('S3 error'));

      // Should not throw despite S3 error
      await expect(service.deleteSample(mockSampleId)).resolves.not.toThrow();
      expect(mockRepository.deleteSample).toHaveBeenCalled();
    });
  });

  describe('refreshSampleUrl', () => {
    it('should refresh and return presigned URL', async () => {
      const mockSample = createMockSample({
        image_s3_key: 'samples/test.png',
      });
      mockRepository.findSampleById.mockResolvedValue(mockSample);
      mockRepository.updateSample.mockResolvedValue(undefined);
      mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/new-presigned-url');

      const result = await service.refreshSampleUrl(mockSampleId);

      expect(result).toBe('https://s3.amazonaws.com/new-presigned-url');
      expect(mockRepository.updateSample).toHaveBeenCalledWith(
        mockSampleId,
        { image_url: 'https://s3.amazonaws.com/new-presigned-url' },
        undefined
      );
    });

    it('should return null when sample not found', async () => {
      mockRepository.findSampleById.mockResolvedValue(null);

      const result = await service.refreshSampleUrl(mockSampleId);

      expect(result).toBeNull();
    });

    it('should return null when sample has no S3 key', async () => {
      const mockSample = createMockSample({ image_s3_key: null });
      mockRepository.findSampleById.mockResolvedValue(mockSample);

      const result = await service.refreshSampleUrl(mockSampleId);

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Image URL Retrieval Tests
  // ===========================================================================

  describe('getImageUrls', () => {
    it('should return presigned URLs for training images', async () => {
      const mockModel = createMockModel({
        training_images_s3_keys: ['img1.jpg', 'img2.jpg'],
      });
      mockRepository.findById.mockResolvedValue(mockModel);
      mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/presigned');

      const result = await service.getImageUrls(mockModelId);

      expect(result).toHaveLength(2);
      expect(result[0].s3Key).toBe('img1.jpg');
      expect(result[0].url).toBe('https://s3.amazonaws.com/presigned');
    });

    it('should return empty array when model has no images', async () => {
      const mockModel = createMockModel({ training_images_s3_keys: [] });
      mockRepository.findById.mockResolvedValue(mockModel);

      const result = await service.getImageUrls(mockModelId);

      expect(result).toEqual([]);
    });

    it('should return empty array when model not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await service.getImageUrls(mockModelId);

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // LoRA Download Tests
  // ===========================================================================

  describe('getLoraDownloadUrl', () => {
    it('should return presigned URL for LoRA file', async () => {
      const mockModel = createMockModel({
        status: 'ready',
        lora_s3_key: 'lora/model.safetensors',
      });
      mockRepository.findById.mockResolvedValue(mockModel);
      mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/lora-presigned');

      const result = await service.getLoraDownloadUrl(mockModelId);

      expect(result).toBe('https://s3.amazonaws.com/lora-presigned');
    });

    it('should return null when model has no LoRA', async () => {
      const mockModel = createMockModel({ lora_s3_key: null });
      mockRepository.findById.mockResolvedValue(mockModel);

      const result = await service.getLoraDownloadUrl(mockModelId);

      expect(result).toBeNull();
    });

    it('should return null when model not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await service.getLoraDownloadUrl(mockModelId);

      expect(result).toBeNull();
    });
  });
});
