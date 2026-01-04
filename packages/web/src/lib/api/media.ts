/**
 * Media API
 * Combined images and videos for Media Gallery.
 */

import { get } from './client';

/**
 * Media item type
 */
export type MediaType = 'image' | 'video';

/**
 * Media item status
 */
export type MediaStatus = 'pending' | 'generating' | 'encoding' | 'ready' | 'failed';

/**
 * User media item (unified type for images and videos)
 */
export interface UserMediaItem {
  id: string;
  type: MediaType;
  url: string | null;
  thumbnailUrl: string | null;
  status: MediaStatus;
  companionId: string;
  companionName: string;
  companionAvatarUrl: string | null;
  createdAt: string;
}

/**
 * Media list response
 */
export interface MediaListResponse {
  data: UserMediaItem[];
  hasMore: boolean;
  limit: number;
  offset: number;
}

/**
 * Media list options
 */
export interface MediaListOptions {
  limit?: number;
  offset?: number;
}

/**
 * Get all user media (images + videos)
 */
export async function getUserMedia(options: MediaListOptions = {}): Promise<MediaListResponse> {
  const params: Record<string, string> = {};

  if (options.limit !== undefined) {
    params.limit = String(options.limit);
  }
  if (options.offset !== undefined) {
    params.offset = String(options.offset);
  }

  return get<MediaListResponse>('/media', params);
}
