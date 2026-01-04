/**
 * Users API
 * User profile management.
 */

import { patch } from './client';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  preferences: Record<string, unknown>;
}

export interface UpdateProfileRequest {
  displayName?: string;
  preferences?: Record<string, unknown>;
}

/**
 * Update user profile
 */
export async function updateProfile(
  userId: string,
  data: UpdateProfileRequest
): Promise<UserProfile> {
  return patch<UserProfile>(`/users/${userId}`, data);
}
