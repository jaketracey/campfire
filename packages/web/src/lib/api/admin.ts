/**
 * Admin API
 * Administrative operations for user management.
 */

import { get, post, patch, del } from './client';

// ============================================================================
// Types
// ============================================================================

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  lastLoginAt: string | null;
  loginCount: number;
  companionCount: number;
  imageCount: number;
  totalTokens: number;
  createdAt: string;
}

export interface AdminUserListResponse {
  success: boolean;
  data: {
    users: AdminUser[];
    hasMore: boolean;
    limit: number;
    offset: number;
  };
}

export type UserSortField = 'email' | 'status' | 'role' | 'companionCount' | 'imageCount' | 'totalTokens' | 'lastLoginAt' | 'createdAt';

export interface AdminUserListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  status?: UserStatus;
  role?: UserRole;
  sortBy?: UserSortField;
  sortOrder?: 'asc' | 'desc';
}

export interface AdminInvite {
  id: string;
  email: string;
  status: string;
  invitedBy: string | null;
  message: string | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
}

export interface AdminInviteListResponse {
  success: boolean;
  data: {
    invites: AdminInvite[];
    hasMore: boolean;
  };
}

export interface InviteUserResponse {
  success: boolean;
  data: {
    invite: {
      id: string;
      email: string;
      status: string;
      expiresAt: string;
      createdAt: string;
    };
    inviteUrl: string;
  };
}

export interface UpdateRoleResponse {
  success: boolean;
  data: {
    id: string;
    email: string;
    role: UserRole;
  };
}

export interface UpdateStatusResponse {
  success: boolean;
  data: {
    id: string;
    email: string;
    status: UserStatus;
  };
}

export interface ResetPasswordResponse {
  success: boolean;
  data: {
    message: string;
    resetToken?: string; // Only in development
  };
}

export interface GrantTokensResponse {
  success: boolean;
  data: {
    transactionId: string;
    newBalance: number;
    amount: number;
  };
}

// ============================================================================
// API Methods
// ============================================================================

/**
 * List all users with stats (admin only)
 */
export function listAdminUsers(
  options?: AdminUserListOptions
): Promise<AdminUserListResponse> {
  return get<AdminUserListResponse>('/admin/users', options as Record<string, string | number | boolean | undefined>);
}

/**
 * Get single user details (admin only)
 */
export function getAdminUser(userId: string): Promise<{ success: boolean; data: AdminUser }> {
  return get<{ success: boolean; data: AdminUser }>(`/admin/users/${userId}`);
}

/**
 * Send password reset email (admin only)
 */
export function resetUserPassword(userId: string): Promise<ResetPasswordResponse> {
  return post<ResetPasswordResponse>(`/admin/users/${userId}/reset-password`);
}

/**
 * Grant tokens to a user (admin only)
 */
export function grantUserTokens(
  userId: string,
  data: { amount: number; reason?: string }
): Promise<GrantTokensResponse> {
  return post<GrantTokensResponse>(`/admin/users/${userId}/grant-tokens`, data);
}

/**
 * Update user role (admin only)
 */
export function setUserRole(userId: string, role: UserRole): Promise<UpdateRoleResponse> {
  return patch<UpdateRoleResponse>(`/admin/users/${userId}/role`, { role });
}

/**
 * Update user status - suspend or unsuspend (admin only)
 */
export function setUserStatus(userId: string, status: 'active' | 'suspended'): Promise<UpdateStatusResponse> {
  return patch<UpdateStatusResponse>(`/admin/users/${userId}/status`, { status });
}

/**
 * Suspend a user (admin only)
 */
export function suspendUser(userId: string): Promise<UpdateStatusResponse> {
  return setUserStatus(userId, 'suspended');
}

/**
 * Unsuspend a user (admin only)
 */
export function unsuspendUser(userId: string): Promise<UpdateStatusResponse> {
  return setUserStatus(userId, 'active');
}

/**
 * Invite a user by email (admin only)
 */
export function inviteUser(data: { email: string; message?: string }): Promise<InviteUserResponse> {
  return post<InviteUserResponse>('/admin/invites', data);
}

/**
 * List pending invitations (admin only)
 */
export function listPendingInvites(options?: {
  limit?: number;
  offset?: number;
}): Promise<AdminInviteListResponse> {
  return get<AdminInviteListResponse>('/admin/invites', options);
}

/**
 * Revoke a pending invitation (admin only)
 */
export function revokePendingInvite(inviteId: string): Promise<void> {
  return del<void>(`/admin/invites/${inviteId}`);
}

// ============================================================================
// Impersonation
// ============================================================================

export interface ImpersonateUserResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      email: string;
      role: UserRole;
      emailVerified: boolean;
      createdAt: string;
    };
    tokens: {
      accessToken: string;
      refreshToken: string;
      tokenType: string;
      expiresIn: number;
    };
  };
}

/**
 * Get tokens to impersonate a user (admin only)
 *
 * Returns access and refresh tokens for the target user.
 * The admin can use these tokens to act as that user.
 */
export function impersonateUser(userId: string): Promise<ImpersonateUserResponse> {
  return post<ImpersonateUserResponse>(`/admin/users/${userId}/impersonate`);
}
