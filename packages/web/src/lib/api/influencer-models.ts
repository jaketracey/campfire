/**
 * Influencer Models API Client
 * API methods for LoRA training management
 */

import { get, post, patch, del, apiClient } from './client';

// =========================================================================
// Types
// =========================================================================

export type InfluencerModelStatus =
  | 'pending'
  | 'uploading'
  | 'training'
  | 'downloading'
  | 'ready'
  | 'failed';

export interface InfluencerModel {
  id: string;
  name: string;
  triggerWord: string;
  trainingSteps: number;
  isStyle: boolean;
  status: InfluencerModelStatus;
  statusMessage: string | null;
  imageCount: number;
  hasLora: boolean;
  falJobId: string | null;
  createdAt: string;
  updatedAt: string;
  trainingStartedAt: string | null;
  trainingCompletedAt: string | null;
}

export interface InfluencerModelWithImages extends InfluencerModel {
  imageUrls: { s3Key: string; url: string }[];
}

export interface InfluencerModelStats {
  total: number;
  ready: number;
  training: number;
  failed: number;
}

export interface CreateModelRequest {
  name: string;
  trigger_word: string;
  training_steps?: number;
  is_style?: boolean;
}

export interface UpdateModelRequest {
  name?: string;
  trigger_word?: string;
  training_steps?: number;
  is_style?: boolean;
}

export interface ListModelsParams {
  limit?: number;
  offset?: number;
  status?: InfluencerModelStatus;
  search?: string;
}

// =========================================================================
// Sample Types
// =========================================================================

export type InfluencerSampleStatus = 'pending' | 'generating' | 'completed' | 'failed';

export interface InfluencerModelSample {
  id: string;
  modelId: string;
  prompt: string;
  negativePrompt: string | null;
  guidanceScale: number;
  loraScale: number;
  numInferenceSteps: number;
  seed: number | null;
  width: number;
  height: number;
  status: InfluencerSampleStatus;
  errorMessage: string | null;
  imageUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface GenerateSampleRequest {
  prompt: string;
  negative_prompt?: string;
  guidance_scale?: number;
  lora_scale?: number;
  num_inference_steps?: number;
  seed?: number;
  width?: number;
  height?: number;
}

// =========================================================================
// API Methods
// =========================================================================

const BASE = '/admin/influencer-models';

/**
 * Get model statistics
 */
export async function getInfluencerModelStats(): Promise<InfluencerModelStats> {
  const response = await get<{ success: boolean; data: InfluencerModelStats }>(`${BASE}/stats`);
  return response.data;
}

/**
 * Create a new model
 */
export async function createInfluencerModel(
  data: CreateModelRequest
): Promise<InfluencerModel> {
  const response = await post<{ success: boolean; data: InfluencerModel }>(BASE, data);
  return response.data;
}

/**
 * List all models
 */
export async function listInfluencerModels(
  params?: ListModelsParams
): Promise<{ models: InfluencerModel[]; hasMore: boolean }> {
  const queryParams = params
    ? {
        limit: params.limit,
        offset: params.offset,
        status: params.status,
        search: params.search,
      }
    : {};
  const response = await get<{
    success: boolean;
    data: { models: InfluencerModel[]; hasMore: boolean };
  }>(BASE, queryParams);
  return response.data;
}

/**
 * Get a model by ID
 */
export async function getInfluencerModel(id: string): Promise<InfluencerModelWithImages> {
  const response = await get<{ success: boolean; data: InfluencerModelWithImages }>(`${BASE}/${id}`);
  return response.data;
}

/**
 * Update a model
 */
export async function updateInfluencerModel(
  id: string,
  data: UpdateModelRequest
): Promise<InfluencerModel> {
  const response = await patch<{ success: boolean; data: InfluencerModel }>(`${BASE}/${id}`, data);
  return response.data;
}

/**
 * Delete a model
 */
export async function deleteInfluencerModel(id: string): Promise<void> {
  await del<{ success: boolean }>(`${BASE}/${id}`);
}

/**
 * Get presigned URL for image upload
 */
export async function getPresignedUploadUrl(
  modelId: string,
  filename: string,
  contentType: string
): Promise<{ uploadUrl: string; s3Key: string }> {
  const response = await post<{
    success: boolean;
    data: { uploadUrl: string; s3Key: string };
  }>(`${BASE}/${modelId}/presign-upload`, { filename, contentType });
  return response.data;
}

/**
 * Confirm image upload after S3 upload completes
 */
export async function confirmImageUpload(
  modelId: string,
  s3Key: string
): Promise<InfluencerModel> {
  const response = await post<{ success: boolean; data: InfluencerModel }>(
    `${BASE}/${modelId}/confirm-upload`,
    { s3Key }
  );
  return response.data;
}

/**
 * Remove an image from a model
 */
export async function removeModelImage(
  modelId: string,
  s3Key: string
): Promise<InfluencerModel> {
  const response = await apiClient<{ success: boolean; data: InfluencerModel }>(
    `${BASE}/${modelId}/images`,
    {
      method: 'DELETE',
      body: JSON.stringify({ s3Key }),
    }
  );
  return response.data;
}

/**
 * Start training a model
 */
export async function startTraining(modelId: string): Promise<InfluencerModel> {
  const response = await post<{ success: boolean; data: InfluencerModel }>(
    `${BASE}/${modelId}/train`
  );
  return response.data;
}

/**
 * Check training status
 */
export async function checkTrainingStatus(modelId: string): Promise<InfluencerModel> {
  const response = await get<{ success: boolean; data: InfluencerModel }>(
    `${BASE}/${modelId}/training-status`
  );
  return response.data;
}

/**
 * Get LoRA download URL
 */
export async function getLoraDownloadUrl(modelId: string): Promise<string | null> {
  try {
    const response = await get<{ success: boolean; data: { downloadUrl: string } }>(
      `${BASE}/${modelId}/lora-download`
    );
    return response.data.downloadUrl;
  } catch {
    return null;
  }
}

/**
 * Upload an image file to S3 via presigned URL
 */
export async function uploadImageToS3(
  modelId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ s3Key: string }> {
  // Get presigned URL
  const { uploadUrl, s3Key } = await getPresignedUploadUrl(
    modelId,
    file.name,
    file.type
  );

  // Upload to S3
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed'));
    });

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });

  // Confirm upload
  await confirmImageUpload(modelId, s3Key);

  return { s3Key };
}

// =========================================================================
// Sample API Methods
// =========================================================================

/**
 * Generate a sample image using the trained LoRA
 */
export async function generateSample(
  modelId: string,
  data: GenerateSampleRequest
): Promise<InfluencerModelSample> {
  const response = await post<{ success: boolean; data: InfluencerModelSample }>(
    `${BASE}/${modelId}/samples`,
    data
  );
  return response.data;
}

/**
 * List samples for a model
 */
export async function listSamples(
  modelId: string,
  limit?: number
): Promise<{ samples: InfluencerModelSample[] }> {
  const queryParams = limit ? { limit } : {};
  const response = await get<{
    success: boolean;
    data: { samples: InfluencerModelSample[] };
  }>(`${BASE}/${modelId}/samples`, queryParams);
  return response.data;
}

/**
 * Get a sample by ID
 */
export async function getSample(
  modelId: string,
  sampleId: string
): Promise<InfluencerModelSample> {
  const response = await get<{ success: boolean; data: InfluencerModelSample }>(
    `${BASE}/${modelId}/samples/${sampleId}`
  );
  return response.data;
}

/**
 * Delete a sample
 */
export async function deleteSample(modelId: string, sampleId: string): Promise<void> {
  await del<{ success: boolean }>(`${BASE}/${modelId}/samples/${sampleId}`);
}

/**
 * Refresh presigned URL for a sample image
 */
export async function refreshSampleUrl(
  modelId: string,
  sampleId: string
): Promise<string> {
  const response = await post<{ success: boolean; data: { imageUrl: string } }>(
    `${BASE}/${modelId}/samples/${sampleId}/refresh-url`
  );
  return response.data.imageUrl;
}
