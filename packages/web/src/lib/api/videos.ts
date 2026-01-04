/**
 * Videos API
 * Video request management for companion video messages.
 */

import { get, post } from './client';

/**
 * Video request status type
 */
export type VideoRequestStatus = 'pending' | 'generating' | 'encoding' | 'ready' | 'failed';

/**
 * Video request params
 */
export interface VideoRequestParams {
  companionId: string;
  prompt: string;
  sessionId?: string;
}

/**
 * Video request response
 */
export interface VideoRequestResponse {
  videoRequestId: string;
  status: VideoRequestStatus;
  tokensCost: number;
  newBalance: number;
}

/**
 * Video request details
 */
export interface VideoRequest {
  id: string;
  companionId: string;
  companionName: string;
  companionAvatarUrl: string | null;
  prompt: string;
  status: VideoRequestStatus;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  tokenCost: number;
  durationSeconds: number;
  processingTimeMs: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Video list response
 */
export interface VideoListResponse {
  data: VideoRequest[];
  hasMore: boolean;
  limit: number;
  offset: number;
}

/**
 * Video list options
 */
export interface VideoListOptions {
  status?: VideoRequestStatus | VideoRequestStatus[];
  companionId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Create a new video request
 */
export async function requestVideo(params: VideoRequestParams): Promise<VideoRequestResponse> {
  return post<VideoRequestResponse>('/videos/request', params);
}

/**
 * Get video request details
 */
export async function getVideoRequest(id: string): Promise<VideoRequest> {
  return get<VideoRequest>(`/videos/${id}`);
}

/**
 * List user's video requests
 */
export async function listVideoRequests(options: VideoListOptions = {}): Promise<VideoListResponse> {
  const params: Record<string, string> = {};

  if (options.status) {
    params.status = Array.isArray(options.status) ? options.status.join(',') : options.status;
  }
  if (options.companionId) {
    params.companionId = options.companionId;
  }
  if (options.limit !== undefined) {
    params.limit = String(options.limit);
  }
  if (options.offset !== undefined) {
    params.offset = String(options.offset);
  }

  return get<VideoListResponse>('/videos', params);
}

/**
 * Get count of actively generating videos
 */
export async function getActiveVideoCount(): Promise<{ count: number }> {
  return get<{ count: number }>('/videos/active-count');
}
