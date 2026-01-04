/**
 * Admin Service
 * Handles admin-specific operations like user management and invitations.
 */

import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getUsersRepository, getReferralsRepository, getGiftsRepository, type UserWithStats, type UserListFilters } from '../repositories/index.js';
import { logger } from '../observability/logger.js';
import { enqueueEmailJob } from '../utils/queue.js';
import type { User, UserRole, UserStatus, PendingInvite } from '../db/types.js';
import type { TransactionContext, PaginatedResult } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const AdminUserListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  role: z.enum(['user', 'admin']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['email', 'status', 'role', 'companionCount', 'imageCount', 'totalTokens', 'lastLoginAt', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const AdminInviteUserSchema = z.object({
  email: z.string().email(),
  message: z.string().max(500).optional(),
});

export const AdminUpdateRoleSchema = z.object({
  role: z.enum(['user', 'admin']),
});

export const AdminUpdateStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

export const AdminGrantTokensSchema = z.object({
  amount: z.number().int().min(1).max(1000000),
  reason: z.string().min(1).max(500).optional(),
});

// ============================================================================
// Types
// ============================================================================

export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;
export type AdminInviteUserInput = z.infer<typeof AdminInviteUserSchema>;
export type AdminGrantTokensInput = z.infer<typeof AdminGrantTokensSchema>;

export interface AdminInviteResult {
  invite: PendingInvite;
  inviteUrl: string;
}

export interface AdminGrantTokensResult {
  transactionId: string;
  newBalance: number;
  amount: number;
}

// ============================================================================
// Service
// ============================================================================

export class AdminService {
  private users = getUsersRepository();
  private referrals = getReferralsRepository();
  private gifts = getGiftsRepository();

  /**
   * List users with enriched stats (companion count, last login, etc.)
   */
  async listUsers(
    query: AdminUserListQuery,
    tx?: TransactionContext
  ): Promise<PaginatedResult<UserWithStats>> {
    const validated = AdminUserListQuerySchema.parse(query);
    return this.users.listWithStats(validated, tx);
  }

  /**
   * Get a single user by ID
   */
  async getUser(userId: string, tx?: TransactionContext): Promise<User | null> {
    return this.users.findById(userId, tx);
  }

  /**
   * Trigger password reset for any user (admin action)
   * Generates reset token and would queue email in production
   */
  async triggerPasswordReset(
    userId: string,
    adminUserId: string,
    tx?: TransactionContext
  ): Promise<{ resetToken: string }> {
    const user = await this.users.findById(userId, tx);
    if (!user) {
      throw new Error('User not found');
    }

    // Generate reset token
    const resetToken = nanoid(32);

    // TODO: In production, store the token hash with expiration and queue email
    // await this.passwordResets.create({ userId, tokenHash, expiresAt });
    // await emailService.sendPasswordResetEmail(user.email, resetToken);

    logger.info(
      { userId, adminUserId },
      'Admin triggered password reset for user'
    );

    return { resetToken };
  }

  /**
   * Send email invitation to new user
   */
  async inviteUser(
    input: AdminInviteUserInput,
    invitedByUserId: string,
    tx?: TransactionContext
  ): Promise<AdminInviteResult> {
    const validated = AdminInviteUserSchema.parse(input);

    // Check if email already exists as a user
    const existingUser = await this.users.findByEmail(validated.email, tx);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Check if pending invite exists for this email
    const existingInvite = await this.referrals.findPendingInviteByEmail(validated.email, tx);
    if (existingInvite) {
      throw new Error('Pending invite already exists for this email');
    }

    // Generate invite token
    const token = nanoid(32);

    // Create pending invite
    const invite = await this.referrals.createPendingInvite({
      email: validated.email,
      token,
      invited_by_user_id: invitedByUserId,
      message: validated.message,
    }, tx);

    // Build invite URL
    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    const inviteUrl = `${webUrl}/signup?invite=${token}`;

    // Get inviter name for the email
    const inviter = await this.users.findById(invitedByUserId, tx);
    const invitedByName = inviter?.email?.split('@')[0] || undefined;

    // Queue invite email
    const emailJobId = await enqueueEmailJob({
      type: 'transactional',
      templateName: 'invite',
      recipientEmail: validated.email,
      context: {
        inviteUrl,
        message: validated.message,
        invitedByName,
      },
      metadata: {
        traceId: nanoid(),
      },
      priority: 'high',
    });

    if (emailJobId) {
      logger.info(
        { email: validated.email, invitedBy: invitedByUserId, emailJobId },
        'Invite email queued'
      );
    } else {
      logger.warn(
        { email: validated.email, invitedBy: invitedByUserId },
        'Failed to queue invite email - Redis may not be available'
      );
    }

    logger.info(
      { email: validated.email, invitedBy: invitedByUserId },
      'Admin sent user invitation'
    );

    return { invite, inviteUrl };
  }

  /**
   * Update user role
   */
  async updateUserRole(
    userId: string,
    role: UserRole,
    adminUserId: string,
    tx?: TransactionContext
  ): Promise<User> {
    // Prevent admin from removing their own admin role
    if (userId === adminUserId && role !== 'admin') {
      throw new Error('Cannot remove your own admin role');
    }

    const user = await this.users.updateRole(userId, role, tx);

    logger.info(
      { userId, role, adminUserId },
      'Admin updated user role'
    );

    return user;
  }

  /**
   * Update user status (suspend/unsuspend)
   */
  async updateUserStatus(
    userId: string,
    status: UserStatus,
    adminUserId: string,
    tx?: TransactionContext
  ): Promise<User> {
    // Prevent admin from suspending themselves
    if (userId === adminUserId && status === 'suspended') {
      throw new Error('Cannot suspend your own account');
    }

    const user = await this.users.updateStatus(userId, status, tx);

    logger.info(
      { userId, status, adminUserId },
      'Admin updated user status'
    );

    return user;
  }

  /**
   * Get pending invites list
   */
  async listPendingInvites(
    options: { limit?: number; offset?: number } = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<PendingInvite>> {
    return this.referrals.listPendingInvites(options, tx);
  }

  /**
   * Revoke a pending invite
   */
  async revokePendingInvite(
    inviteId: string,
    adminUserId: string,
    tx?: TransactionContext
  ): Promise<void> {
    await this.referrals.revokePendingInvite(inviteId, tx);

    logger.info(
      { inviteId, adminUserId },
      'Admin revoked pending invite'
    );
  }

  /**
   * Grant tokens to a user (admin action)
   */
  async grantTokens(
    userId: string,
    input: AdminGrantTokensInput,
    adminUserId: string,
    tx?: TransactionContext
  ): Promise<AdminGrantTokensResult> {
    const validated = AdminGrantTokensSchema.parse(input);

    // Verify user exists
    const user = await this.users.findById(userId, tx);
    if (!user) {
      throw new Error('User not found');
    }

    // Credit tokens using admin_grant type
    const result = await this.gifts.creditTokens(
      userId,
      validated.amount,
      'admin_grant',
      {
        description: validated.reason ?? `Admin grant by ${adminUserId}`,
        metadata: {
          grantedBy: adminUserId,
          reason: validated.reason ?? null,
        },
      },
      tx
    );

    logger.info(
      { userId, amount: validated.amount, adminUserId, transactionId: result.transactionId },
      'Admin granted tokens to user'
    );

    return {
      transactionId: result.transactionId,
      newBalance: result.newBalance,
      amount: validated.amount,
    };
  }
}

// Singleton
let adminService: AdminService | null = null;

export function getAdminService(): AdminService {
  if (!adminService) {
    adminService = new AdminService();
  }
  return adminService;
}
