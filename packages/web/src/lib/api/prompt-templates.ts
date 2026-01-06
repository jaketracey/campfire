/**
 * Prompt Templates API
 * Administrative operations for prompt templates and versioning.
 */

import { get, post, put, patch } from './client';

export type PromptAdminArea = 'routing' | 'image_routing' | 'video_routing' | 'other';

export interface PromptDefinition {
  key: string;
  display_name: string;
  description: string;
  admin_area: PromptAdminArea;
  is_required: boolean;
  allowed_variables: string[];
  created_at: string;
  updated_at: string;
}

export interface EffectivePromptTemplate extends PromptDefinition {
  version: string;
  companion_id: string | null;
  template: string | null;
  template_source: 'companion' | 'global' | 'missing';
  variables: string[];
}

export interface PromptValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export async function listPromptTemplates(options?: {
  adminArea?: PromptAdminArea;
  version?: string;
  companionId?: string;
}): Promise<{ version: string; prompts: EffectivePromptTemplate[] }> {
  const res = await get<ApiResponse<{ version: string; prompts: EffectivePromptTemplate[] }>>(
    '/admin/prompts',
    options
  );
  return res.data;
}

export async function validatePromptTemplates(input: {
  adminArea?: PromptAdminArea;
  version?: string;
  companionId?: string;
}): Promise<{ version: string; result: PromptValidationResult }> {
  const res = await post<ApiResponse<{ version: string; result: PromptValidationResult }>>(
    '/admin/prompts/validate',
    input
  );
  return res.data;
}

export async function listPromptVersions(options?: {
  adminArea?: PromptAdminArea;
}): Promise<{ versions: string[]; defaultVersion: string }> {
  const res = await get<ApiResponse<{ versions: string[]; defaultVersion: string }>>(
    '/admin/prompts/versions',
    options
  );
  return res.data;
}

export async function createPromptVersion(input: {
  fromVersion: string;
  toVersion: string;
}): Promise<{ copied: number }> {
  const res = await post<ApiResponse<{ copied: number }>>('/admin/prompts/versions', input);
  return res.data;
}

export async function setDefaultPromptVersion(input: {
  defaultVersion: string;
}): Promise<{ defaultVersion: string }> {
  const res = await patch<ApiResponse<{ defaultVersion: string }>>('/admin/prompts/settings', input);
  return res.data;
}

export async function updatePromptTemplate(
  key: string,
  input: { template: string; version?: string; companionId?: string }
): Promise<{ version: string; prompt: EffectivePromptTemplate }> {
  const res = await put<ApiResponse<{ version: string; prompt: EffectivePromptTemplate }>>(
    `/admin/prompts/${encodeURIComponent(key)}`,
    input
  );
  return res.data;
}

