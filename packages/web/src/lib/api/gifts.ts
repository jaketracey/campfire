/**
 * Gifts API
 * Gift generation, retrieval, and sending for AI companions.
 */

import { get, post } from './client';

/**
 * Gift status type
 */
export type GiftStatus = 'generating' | 'ready' | 'given' | 'failed';

/**
 * Gift type
 */
export interface Gift {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  tokenCost: number;
  emotionalMeaning: string;
  status: GiftStatus;
  givenAt: string | null;
  createdAt: string;
}

/**
 * Gift history item with companion reaction
 */
export interface GiftHistoryItem {
  gift: Gift;
  companionReaction?: string;
}

/**
 * Standard API response wrapper
 */
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * Generate gift response data
 */
export interface GenerateGiftData {
  gift: Gift;
  message?: string;
}

/**
 * Give gift response data
 */
export interface GiveGiftData {
  gift: {
    id: string;
    name: string;
    status: GiftStatus;
    givenAt?: string;
  };
  memory: {
    id: string;
    content: string;
  };
  tokensDeducted: number;
  newBalance: number;
}

/**
 * Gift history response data
 */
export interface GiftHistoryData {
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    emotionalMeaning: string | null;
    imageUrl: string | null;
    tokenCost: number;
    givenAt: string | null;
  }>;
  hasMore: boolean;
}

/**
 * Preferred cost tier for gift generation
 */
export type GiftCostTier = 'low' | 'medium' | 'high';

/**
 * Generate a new gift for a companion
 */
export async function generateGift(
  companionId: string,
  preferredCost?: GiftCostTier
): Promise<Gift> {
  const response = await post<ApiResponse<GenerateGiftData>>(
    `/gifts/generate`,
    { companionId, preferredCost }
  );
  return response.data.gift;
}

/**
 * Get gift response data (gift fields are directly in data)
 */
interface GetGiftData {
  id: string;
  name: string;
  description: string | null;
  visualPrompt: string | null;
  emotionalMeaning: string | null;
  imageUrl: string | null;
  companionId: string;
  status: GiftStatus;
  tokenCost: number;
  generationError: string | null;
  givenAt: string | null;
  createdAt: string;
}

/**
 * Get a gift by ID
 */
export async function getGift(giftId: string): Promise<Gift> {
  const response = await get<ApiResponse<GetGiftData>>(`/gifts/${giftId}`);
  const data = response.data;
  return {
    id: data.id,
    name: data.name,
    description: data.description ?? '',
    imageUrl: data.imageUrl,
    tokenCost: data.tokenCost,
    emotionalMeaning: data.emotionalMeaning ?? '',
    status: data.status,
    givenAt: data.givenAt,
    createdAt: data.createdAt,
  };
}

/**
 * Give gift response
 */
export interface GiveGiftResponse {
  gift: Gift;
  newBalance: number;
}

/**
 * Give a gift to a companion (consumes tokens)
 */
export async function giveGift(giftId: string): Promise<GiveGiftResponse> {
  const response = await post<ApiResponse<GiveGiftData>>(`/gifts/${giftId}/give`);
  const data = response.data;
  return {
    gift: {
      id: data.gift.id,
      name: data.gift.name,
      description: '',
      imageUrl: null,
      tokenCost: 0,
      emotionalMeaning: '',
      status: data.gift.status,
      givenAt: data.gift.givenAt ?? null,
      createdAt: '',
    },
    newBalance: data.newBalance,
  };
}

/**
 * Get gift history for a companion
 */
export async function getGiftHistory(
  companionId: string,
  limit?: number
): Promise<GiftHistoryItem[]> {
  const response = await get<ApiResponse<GiftHistoryData>>(
    `/gifts/history/${companionId}`,
    { limit }
  );
  return response.data.items.map((item) => ({
    gift: {
      id: item.id,
      name: item.name,
      description: item.description ?? '',
      imageUrl: item.imageUrl,
      tokenCost: item.tokenCost,
      emotionalMeaning: item.emotionalMeaning ?? '',
      status: 'given' as GiftStatus,
      givenAt: item.givenAt,
      createdAt: '',
    },
  }));
}

// ============================================================================
// Gift Templates (Global Library)
// ============================================================================

/**
 * Gift template category
 */
export type GiftTemplateCategory =
  | 'romantic'
  | 'friendship'
  | 'celebration'
  | 'comfort'
  | 'gratitude'
  | 'playful'
  | 'thoughtful'
  | 'mystical'
  | 'nature'
  | 'artistic'
  | 'other';

/**
 * Gift template from the global library
 */
export interface GiftTemplate {
  id: string;
  name: string;
  description: string | null;
  emotionalMeaning: string | null;
  imageUrl: string;
  category: GiftTemplateCategory;
  tokenCost: number;
  tier: string;
  totalSends: number;
  sendsLast7Days: number;
}

/**
 * Template list response data
 */
interface TemplateListData {
  templates: GiftTemplate[];
  hasMore: boolean;
  total: number;
}

/**
 * Template list params
 */
export interface GetTemplatesParams {
  category?: GiftTemplateCategory;
  tier?: 'low' | 'medium' | 'high';
  sort?: 'popular' | 'trending' | 'recent';
  limit?: number;
  offset?: number;
}

/**
 * Get gift templates from the global library
 */
export async function getGiftTemplates(
  params: GetTemplatesParams = {}
): Promise<{ templates: GiftTemplate[]; hasMore: boolean; total: number }> {
  const response = await get<ApiResponse<TemplateListData>>(
    '/gifts/templates',
    params as Record<string, string | number | boolean | undefined>
  );
  return response.data;
}

/**
 * Get a single gift template by ID
 */
export async function getGiftTemplate(templateId: string): Promise<GiftTemplate> {
  const response = await get<ApiResponse<GiftTemplate>>(`/gifts/templates/${templateId}`);
  return response.data;
}

/**
 * Send a gift from template response
 */
export interface SendFromTemplateResponse {
  gift: {
    id: string;
    name: string;
    status: GiftStatus;
    givenAt: string | null;
  };
  tokensDeducted: number;
  newBalance: number;
}

/**
 * Send a gift from a template (instant, no generation wait)
 */
export async function sendGiftFromTemplate(
  templateId: string,
  companionId: string
): Promise<SendFromTemplateResponse> {
  const response = await post<ApiResponse<SendFromTemplateResponse>>(
    '/gifts/from-template',
    { templateId, companionId }
  );
  return response.data;
}

/**
 * Get template counts by category
 */
export async function getTemplateCategoryCounts(): Promise<Record<GiftTemplateCategory, number>> {
  const response = await get<ApiResponse<{ counts: Record<GiftTemplateCategory, number> }>>(
    '/gifts/templates/categories/counts'
  );
  return response.data.counts;
}
