/**
 * Mock Influencer Model Data for E2E Tests
 */

export const mockModelId = '550e8400-e29b-41d4-a716-446655440001';
export const mockSampleId = '550e8400-e29b-41d4-a716-446655440002';

// Model responses
export const mockModelReady = {
  success: true,
  data: {
    id: mockModelId,
    name: 'Test Model',
    triggerWord: 'testmodel',
    trainingSteps: 1000,
    isStyle: false,
    status: 'ready',
    statusMessage: null,
    imageCount: 20,
    hasLora: true,
    falJobId: 'fal-job-123',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    trainingStartedAt: '2025-01-01T00:30:00.000Z',
    trainingCompletedAt: '2025-01-01T01:00:00.000Z',
    imageUrls: [],
  },
};

export const mockModelTraining = {
  success: true,
  data: {
    ...mockModelReady.data,
    status: 'training',
    hasLora: false,
    trainingCompletedAt: null,
  },
};

export const mockModelPending = {
  success: true,
  data: {
    ...mockModelReady.data,
    status: 'pending',
    hasLora: false,
    imageCount: 0,
    trainingStartedAt: null,
    trainingCompletedAt: null,
  },
};

// Sample responses
export const mockSamplePending = {
  success: true,
  data: {
    id: mockSampleId,
    modelId: mockModelId,
    prompt: 'A portrait photo of a person',
    negativePrompt: null,
    guidanceScale: 7.5,
    loraScale: 1.0,
    numInferenceSteps: 28,
    seed: null,
    width: 768,
    height: 1024,
    status: 'pending',
    errorMessage: null,
    imageUrl: null,
    createdAt: '2025-01-01T02:00:00.000Z',
    completedAt: null,
  },
};

export const mockSampleGenerating = {
  success: true,
  data: {
    ...mockSamplePending.data,
    status: 'generating',
  },
};

export const mockSampleCompleted = {
  success: true,
  data: {
    ...mockSamplePending.data,
    status: 'completed',
    imageUrl: 'https://test-bucket.s3.amazonaws.com/samples/test.png',
    completedAt: '2025-01-01T02:01:00.000Z',
  },
};

export const mockSampleFailed = {
  success: true,
  data: {
    ...mockSamplePending.data,
    status: 'failed',
    errorMessage: 'Generation failed due to an error',
  },
};

// List responses
export const mockModelList = {
  success: true,
  data: {
    models: [
      mockModelReady.data,
      {
        ...mockModelReady.data,
        id: '550e8400-e29b-41d4-a716-446655440003',
        name: 'Another Model',
        triggerWord: 'anothermodel',
        status: 'training',
        hasLora: false,
      },
    ],
    hasMore: false,
  },
};

export const mockSampleList = {
  success: true,
  data: {
    samples: [
      mockSampleCompleted.data,
      {
        ...mockSamplePending.data,
        id: '550e8400-e29b-41d4-a716-446655440004',
        prompt: 'A different prompt',
        status: 'generating',
      },
    ],
  },
};

export const mockEmptySampleList = {
  success: true,
  data: {
    samples: [],
  },
};

export const mockModelStats = {
  success: true,
  data: {
    total: 5,
    ready: 3,
    training: 1,
    failed: 1,
  },
};

// Error responses
export const mockModelNotFound = {
  success: false,
  error: {
    code: 'NOT_FOUND',
    message: 'Model not found',
  },
};

export const mockModelNotReady = {
  success: false,
  error: {
    code: 'BAD_REQUEST',
    message: 'Model is not ready for sample generation',
  },
};

export const mockValidationError = {
  success: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid request body',
    details: {
      fieldErrors: {
        prompt: ['Prompt is required'],
      },
    },
  },
};

// Test prompts
export const testPrompts = {
  valid: 'A professional portrait photo of a person in natural lighting',
  withNegative: {
    prompt: 'A beautiful portrait photo',
    negativePrompt: 'blurry, distorted, low quality',
  },
  withSettings: {
    prompt: 'An artistic photo with specific settings',
    guidanceScale: 5.0,
    loraScale: 0.8,
    numInferenceSteps: 35,
    seed: 12345,
    width: 1024,
    height: 768,
  },
};
