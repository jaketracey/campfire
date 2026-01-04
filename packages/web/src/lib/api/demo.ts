/**
 * Demo API
 * API functions for anonymous/demo chat experience.
 */

import { get, post } from './client';

/**
 * Demo companion response (subset of Companion fields)
 */
export interface DemoCompanion {
  id: string;
  name: string;
  avatarUrl: string | null;
  archetype: string | null;
  description: string | null;
}

/**
 * Demo session from backend
 */
export interface DemoSession {
  id: string;
  companionId: string;
  status: string;
  startedAt: string;
}

/**
 * Demo usage info
 */
export interface DemoUsage {
  messagesUsed: number;
  fingerprint: string;
}

/**
 * Create demo session response
 */
interface CreateDemoSessionResponse {
  success: boolean;
  data: {
    session: DemoSession;
    usage: DemoUsage;
  };
}

/**
 * Get demo companion response
 */
interface GetDemoCompanionResponse {
  success: boolean;
  data: {
    companion: DemoCompanion;
  };
}

/**
 * Create demo session input
 */
export interface CreateDemoSessionInput {
  companionId: string;
  fingerprint: string;
}

/**
 * Fetch a random demo companion
 * GET /demo/companion
 */
export async function getDemoCompanion(): Promise<DemoCompanion> {
  const response = await get<GetDemoCompanionResponse>('/demo/companion');
  return response.data.companion;
}

/**
 * Create an anonymous demo session
 * POST /demo/session
 */
export async function createDemoSession(input: CreateDemoSessionInput): Promise<DemoSession & DemoUsage> {
  const response = await post<CreateDemoSessionResponse>('/demo/session', input);
  return {
    ...response.data.session,
    ...response.data.usage,
  };
}
