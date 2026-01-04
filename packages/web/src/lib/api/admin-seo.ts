/**
 * Admin SEO API Client
 * API functions for SEO page management
 */

import { get, post, patch, del } from './client';

// Types
export type SeoPageStatus = 'draft' | 'generating' | 'published' | 'archived';

export interface SeoPage {
  id: string;
  companionId: string;
  companionName: string;
  companionAvatarUrl: string | null;
  slug: string;
  title: string;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageUrl: string | null;
  contentHtml: string;
  contentJson: {
    headline?: string;
    tagline?: string;
    personalitySummary?: string;
    keyTraits?: string[];
    conversationStarters?: string[];
  };
  status: SeoPageStatus;
  version: number;
  publishedAt: string | null;
  generatedByModel: string | null;
  generationError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeoPageListItem {
  id: string;
  companionId: string;
  companionName: string;
  companionAvatarUrl: string | null;
  slug: string;
  title: string;
  status: SeoPageStatus;
  version: number;
  publishedAt: string | null;
  generatedByModel: string | null;
  generationError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableCompanion {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface SeoPageListResponse {
  pages: SeoPageListItem[];
  hasMore: boolean;
  total: number;
  limit: number;
  offset: number;
}

export interface AvailableCompanionsResponse {
  companions: AvailableCompanion[];
  hasMore: boolean;
  total: number;
  limit: number;
  offset: number;
}

export interface ListSeoPageParams {
  status?: SeoPageStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

// API functions

export async function listSeoPages(params: ListSeoPageParams = {}): Promise<SeoPageListResponse> {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  if (params.search) searchParams.set('search', params.search);
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.offset) searchParams.set('offset', params.offset.toString());

  const response = await get<{ data: SeoPageListResponse }>(
    `/admin/seo/pages?${searchParams.toString()}`
  );
  return response.data;
}

export async function getSeoPage(pageId: string): Promise<SeoPage> {
  const response = await get<{ data: SeoPage }>(`/admin/seo/pages/${pageId}`);
  return response.data;
}

export async function createSeoPage(companionId: string, generateNow = true): Promise<{ id: string; slug: string; status: string; message: string }> {
  const response = await post<{ data: { id: string; slug: string; status: string; message: string } }>(
    '/admin/seo/pages',
    { companionId, generateNow }
  );
  return response.data;
}

export async function updateSeoPage(
  pageId: string,
  data: {
    title?: string;
    metaDescription?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImageUrl?: string | null;
  }
): Promise<{ id: string; slug: string; title: string; status: string; updatedAt: string }> {
  const response = await patch<{ data: { id: string; slug: string; title: string; status: string; updatedAt: string } }>(
    `/admin/seo/pages/${pageId}`,
    data
  );
  return response.data;
}

export async function deleteSeoPage(pageId: string): Promise<void> {
  await del(`/admin/seo/pages/${pageId}`);
}

export async function regenerateSeoPage(pageId: string): Promise<{ message: string; pageId: string }> {
  const response = await post<{ data: { message: string; pageId: string } }>(
    `/admin/seo/pages/${pageId}/regenerate`
  );
  return response.data;
}

export async function publishSeoPage(pageId: string): Promise<{ id: string; slug: string; status: string; publishedAt: string; version: number }> {
  const response = await post<{ data: { id: string; slug: string; status: string; publishedAt: string; version: number } }>(
    `/admin/seo/pages/${pageId}/publish`
  );
  return response.data;
}

export async function unpublishSeoPage(pageId: string): Promise<{ id: string; slug: string; status: string }> {
  const response = await post<{ data: { id: string; slug: string; status: string } }>(
    `/admin/seo/pages/${pageId}/unpublish`
  );
  return response.data;
}

export async function listAvailableCompanions(params: { limit?: number; offset?: number } = {}): Promise<AvailableCompanionsResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.offset) searchParams.set('offset', params.offset.toString());

  const response = await get<{ data: AvailableCompanionsResponse }>(
    `/admin/seo/companions/available?${searchParams.toString()}`
  );
  return response.data;
}
