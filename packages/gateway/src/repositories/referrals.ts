/**
 * Referrals Repository
 * Data access for invite_codes, user_referrals, and pending_invites tables
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  InviteCode,
  InviteCodeInsert,
  UserReferral,
  UserReferralInsert,
  PendingInvite,
  PendingInviteInsert,
  InviteStatus,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError } from './errors.js';

/**
 * Referral stats for a user's invite code
 */
export interface ReferralStats {
  code: string;
  totalReferrals: number;
  isActive: boolean;
}

/**
 * Referral with the referred user info
 */
export interface ReferralWithUser {
  referral: UserReferral;
  referredUser: {
    id: string;
    email: string;
    createdAt: Date;
  };
}

export class ReferralsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Invite Codes
  // ===========================================================================

  async findInviteCodeById(id: string, tx?: TransactionContext): Promise<InviteCode | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, user_id, code, uses_count, max_uses, is_active,
             created_at, updated_at, expires_at
      FROM invite_codes
      WHERE id = ${id}
    `;

    return result[0] ? this.mapInviteCode(result[0]) : null;
  }

  async findInviteCodeByUserId(userId: string, tx?: TransactionContext): Promise<InviteCode | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, user_id, code, uses_count, max_uses, is_active,
             created_at, updated_at, expires_at
      FROM invite_codes
      WHERE user_id = ${userId}
    `;

    return result[0] ? this.mapInviteCode(result[0]) : null;
  }

  async findInviteCodeByCode(code: string, tx?: TransactionContext): Promise<InviteCode | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, user_id, code, uses_count, max_uses, is_active,
             created_at, updated_at, expires_at
      FROM invite_codes
      WHERE UPPER(code) = UPPER(${code})
    `;

    return result[0] ? this.mapInviteCode(result[0]) : null;
  }

  async createInviteCode(data: InviteCodeInsert, tx?: TransactionContext): Promise<InviteCode> {
    const db = this.getSql(tx);

    try {
      // Generate code using DB function if not provided
      const code = data.code ?? (await db`SELECT generate_invite_code() as code`)[0]?.['code'] as string;

      const result = await db`
        INSERT INTO invite_codes (user_id, code, max_uses, expires_at)
        VALUES (${data.user_id}, ${code}, ${data.max_uses ?? null}, ${data.expires_at ?? null})
        RETURNING id, user_id, code, uses_count, max_uses, is_active,
                  created_at, updated_at, expires_at
      `;

      const inviteCode = this.mapInviteCode(result[0]!);
      logger.debug({ userId: data.user_id, code: inviteCode.code }, 'Invite code created');
      return inviteCode;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('InviteCode', 'code', data.code ?? 'generated');
      }
      throw wrapDatabaseError(error, 'inviteCodes.create');
    }
  }

  async getOrCreateInviteCode(userId: string, tx?: TransactionContext): Promise<InviteCode> {
    // First try to find existing
    const existing = await this.findInviteCodeByUserId(userId, tx);
    if (existing) {
      return existing;
    }

    // Create new one
    return this.createInviteCode({ user_id: userId }, tx);
  }

  async updateInviteCode(
    id: string,
    data: Partial<Pick<InviteCode, 'is_active' | 'max_uses' | 'expires_at'>>,
    tx?: TransactionContext
  ): Promise<InviteCode> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE invite_codes
      SET
        is_active = COALESCE(${data.is_active ?? null}, is_active),
        max_uses = COALESCE(${data.max_uses ?? null}, max_uses),
        expires_at = COALESCE(${data.expires_at ?? null}, expires_at)
      WHERE id = ${id}
      RETURNING id, user_id, code, uses_count, max_uses, is_active,
                created_at, updated_at, expires_at
    `;

    if (!result[0]) {
      throw new NotFoundError('InviteCode', id);
    }

    return this.mapInviteCode(result[0]);
  }

  // ===========================================================================
  // User Referrals
  // ===========================================================================

  async createReferral(data: UserReferralInsert, tx?: TransactionContext): Promise<UserReferral> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO user_referrals (referred_user_id, referrer_user_id, invite_code_id, code_used)
        VALUES (${data.referred_user_id}, ${data.referrer_user_id}, ${data.invite_code_id}, ${data.code_used})
        RETURNING id, referred_user_id, referrer_user_id, invite_code_id, code_used, converted_at, created_at
      `;

      const referral = this.mapUserReferral(result[0]!);
      logger.info(
        { referredUserId: data.referred_user_id, referrerUserId: data.referrer_user_id, code: data.code_used },
        'User referral recorded'
      );
      return referral;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('UserReferral', 'referred_user_id', data.referred_user_id);
      }
      throw wrapDatabaseError(error, 'userReferrals.create');
    }
  }

  async findReferralByReferredUser(userId: string, tx?: TransactionContext): Promise<UserReferral | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, referred_user_id, referrer_user_id, invite_code_id, code_used, converted_at, created_at
      FROM user_referrals
      WHERE referred_user_id = ${userId}
    `;

    return result[0] ? this.mapUserReferral(result[0]) : null;
  }

  async listReferralsByReferrer(
    referrerUserId: string,
    options: PaginationOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<ReferralWithUser>> {
    const db = this.getSql(tx);
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const result = await db`
      SELECT
        ur.id, ur.referred_user_id, ur.referrer_user_id, ur.invite_code_id,
        ur.code_used, ur.converted_at, ur.created_at,
        u.email as referred_email, u.created_at as referred_created_at
      FROM user_referrals ur
      JOIN users u ON u.id = ur.referred_user_id
      WHERE ur.referrer_user_id = ${referrerUserId}
      ORDER BY ur.created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapReferralWithUser(row));

    return { data, hasMore };
  }

  async getReferralStats(userId: string, tx?: TransactionContext): Promise<ReferralStats | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        ic.code,
        ic.uses_count as total_referrals,
        ic.is_active
      FROM invite_codes ic
      WHERE ic.user_id = ${userId}
    `;

    if (!result[0]) {
      return null;
    }

    return {
      code: result[0]['code'] as string,
      totalReferrals: result[0]['total_referrals'] as number,
      isActive: result[0]['is_active'] as boolean,
    };
  }

  async markReferralConverted(referredUserId: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE user_referrals
      SET converted_at = NOW()
      WHERE referred_user_id = ${referredUserId}
        AND converted_at IS NULL
    `;
  }

  // ===========================================================================
  // Pending Invites (Admin Invitations)
  // ===========================================================================

  async createPendingInvite(data: PendingInviteInsert, tx?: TransactionContext): Promise<PendingInvite> {
    const db = this.getSql(tx);

    // Default to 7 days from now if expires_at not provided
    const expiresAt = data.expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    try {
      const result = await db`
        INSERT INTO pending_invites (email, token, invited_by_user_id, message, expires_at)
        VALUES (
          ${data.email},
          ${data.token},
          ${data.invited_by_user_id ?? null},
          ${data.message ?? null},
          ${expiresAt}
        )
        RETURNING id, email, email_normalized, token, invited_by_user_id, status,
                  message, created_at, expires_at, accepted_at, accepted_by_user_id
      `;

      const invite = this.mapPendingInvite(result[0]!);
      logger.info({ email: data.email, invitedBy: data.invited_by_user_id }, 'Pending invite created');
      return invite;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('PendingInvite', 'token', data.token);
      }
      throw wrapDatabaseError(error, 'pendingInvites.create');
    }
  }

  async findPendingInviteByToken(token: string, tx?: TransactionContext): Promise<PendingInvite | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, email, email_normalized, token, invited_by_user_id, status,
             message, created_at, expires_at, accepted_at, accepted_by_user_id
      FROM pending_invites
      WHERE token = ${token}
    `;

    return result[0] ? this.mapPendingInvite(result[0]) : null;
  }

  async findPendingInviteByEmail(email: string, tx?: TransactionContext): Promise<PendingInvite | null> {
    const db = this.getSql(tx);
    const normalizedEmail = email.toLowerCase().trim();

    const result = await db`
      SELECT id, email, email_normalized, token, invited_by_user_id, status,
             message, created_at, expires_at, accepted_at, accepted_by_user_id
      FROM pending_invites
      WHERE email_normalized = ${normalizedEmail}
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    return result[0] ? this.mapPendingInvite(result[0]) : null;
  }

  async acceptPendingInvite(
    token: string,
    acceptedByUserId: string,
    tx?: TransactionContext
  ): Promise<PendingInvite> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE pending_invites
      SET
        status = 'accepted',
        accepted_at = NOW(),
        accepted_by_user_id = ${acceptedByUserId}
      WHERE token = ${token}
        AND status = 'pending'
      RETURNING id, email, email_normalized, token, invited_by_user_id, status,
                message, created_at, expires_at, accepted_at, accepted_by_user_id
    `;

    if (!result[0]) {
      throw new NotFoundError('PendingInvite', token);
    }

    return this.mapPendingInvite(result[0]);
  }

  async expirePendingInvites(tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE pending_invites
      SET status = 'expired'
      WHERE status = 'pending'
        AND expires_at < NOW()
      RETURNING id
    `;

    return result.length;
  }

  async listPendingInvites(
    options: PaginationOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<PendingInvite>> {
    const db = this.getSql(tx);
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const result = await db`
      SELECT id, email, email_normalized, token, invited_by_user_id, status,
             message, created_at, expires_at, accepted_at, accepted_by_user_id
      FROM pending_invites
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapPendingInvite(row));

    return { data, hasMore };
  }

  async revokePendingInvite(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE pending_invites
      SET status = 'revoked'
      WHERE id = ${id}
        AND status = 'pending'
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('PendingInvite', id);
    }
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapInviteCode(row: Record<string, unknown>): InviteCode {
    return {
      id: row['id'] as string,
      user_id: row['user_id'] as string,
      code: row['code'] as string,
      uses_count: row['uses_count'] as number,
      max_uses: row['max_uses'] as number | null,
      is_active: row['is_active'] as boolean,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
      expires_at: row['expires_at'] as Date | null,
    };
  }

  private mapUserReferral(row: Record<string, unknown>): UserReferral {
    return {
      id: row['id'] as string,
      referred_user_id: row['referred_user_id'] as string,
      referrer_user_id: row['referrer_user_id'] as string,
      invite_code_id: row['invite_code_id'] as string,
      code_used: row['code_used'] as string,
      converted_at: row['converted_at'] as Date | null,
      created_at: row['created_at'] as Date,
    };
  }

  private mapReferralWithUser(row: Record<string, unknown>): ReferralWithUser {
    return {
      referral: this.mapUserReferral(row),
      referredUser: {
        id: row['referred_user_id'] as string,
        email: row['referred_email'] as string,
        createdAt: row['referred_created_at'] as Date,
      },
    };
  }

  private mapPendingInvite(row: Record<string, unknown>): PendingInvite {
    return {
      id: row['id'] as string,
      email: row['email'] as string,
      email_normalized: row['email_normalized'] as string,
      token: row['token'] as string,
      invited_by_user_id: row['invited_by_user_id'] as string | null,
      status: row['status'] as InviteStatus,
      message: row['message'] as string | null,
      created_at: row['created_at'] as Date,
      expires_at: row['expires_at'] as Date,
      accepted_at: row['accepted_at'] as Date | null,
      accepted_by_user_id: row['accepted_by_user_id'] as string | null,
    };
  }
}

// Singleton instance
let referralsRepositoryInstance: ReferralsRepository | null = null;

export function getReferralsRepository(): ReferralsRepository {
  if (!referralsRepositoryInstance) {
    referralsRepositoryInstance = new ReferralsRepository();
  }
  return referralsRepositoryInstance;
}
