/**
 * Users Repository
 * Data access for users, user_profiles, user_mfa, and user_sessions tables
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  User,
  UserInsert,
  UserProfile,
  UserProfileInsert,
  UserMFA,
  UserMFAInsert,
  UserStatus,
  MFAMethod,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError } from './errors.js';

/**
 * User with profile joined
 */
export interface UserWithProfile extends User {
  profile: UserProfile | null;
}

/**
 * User session record
 */
export interface UserSession {
  id: string;
  userId: string;
  tokenHash: string;
  deviceInfo: JSONObject | null;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * User session insert
 */
export interface UserSessionInsert {
  userId: string;
  tokenHash: string;
  deviceInfo?: JSONObject | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt: Date;
}

/**
 * User list filters
 */
export interface UserListFilters extends PaginationOptions {
  status?: UserStatus;
  emailVerified?: boolean;
  search?: string;
}

export class UsersRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Users
  // ===========================================================================

  async findById(id: string, tx?: TransactionContext): Promise<User | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, email, email_normalized, password_hash, email_verified,
        email_verified_at, status, last_login_at, login_count,
        failed_login_count, locked_until, created_at, updated_at
      FROM users
      WHERE id = ${id}
    `;

    return result[0] ? this.mapUser(result[0]) : null;
  }

  async findByEmail(email: string, tx?: TransactionContext): Promise<User | null> {
    const db = this.getSql(tx);
    const normalizedEmail = email.toLowerCase().trim();

    const result = await db`
      SELECT
        id, email, email_normalized, password_hash, email_verified,
        email_verified_at, status, last_login_at, login_count,
        failed_login_count, locked_until, created_at, updated_at
      FROM users
      WHERE email_normalized = ${normalizedEmail}
    `;

    return result[0] ? this.mapUser(result[0]) : null;
  }

  async create(data: UserInsert, tx?: TransactionContext): Promise<User> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO users (
          email, password_hash, email_verified, status
        ) VALUES (
          ${data.email},
          ${data.password_hash},
          ${data.email_verified ?? false},
          ${data.status ?? 'active'}
        )
        RETURNING
          id, email, email_normalized, password_hash, email_verified,
          email_verified_at, status, last_login_at, login_count,
          failed_login_count, locked_until, created_at, updated_at
      `;

      const user = this.mapUser(result[0]!);
      logger.debug({ userId: user.id }, 'User created');
      return user;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('User', 'email', data.email);
      }
      throw wrapDatabaseError(error, 'users.create');
    }
  }

  async update(
    id: string,
    data: Partial<Omit<UserInsert, 'email'>>,
    tx?: TransactionContext
  ): Promise<User> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE users
      SET
        password_hash = COALESCE(${data.password_hash ?? null}, password_hash),
        email_verified = COALESCE(${data.email_verified ?? null}, email_verified),
        status = COALESCE(${data.status ?? null}, status)
      WHERE id = ${id}
      RETURNING
        id, email, email_normalized, password_hash, email_verified,
        email_verified_at, status, last_login_at, login_count,
        failed_login_count, locked_until, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('User', id);
    }

    return this.mapUser(result[0]);
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE users
      SET status = 'deleted'
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('User', id);
    }
  }

  async verifyEmail(id: string, tx?: TransactionContext): Promise<User> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE users
      SET
        email_verified = TRUE,
        email_verified_at = NOW()
      WHERE id = ${id}
      RETURNING
        id, email, email_normalized, password_hash, email_verified,
        email_verified_at, status, last_login_at, login_count,
        failed_login_count, locked_until, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('User', id);
    }

    return this.mapUser(result[0]);
  }

  async recordLogin(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE users
      SET
        last_login_at = NOW(),
        login_count = login_count + 1,
        failed_login_count = 0,
        locked_until = NULL
      WHERE id = ${id}
    `;
  }

  async recordFailedLogin(id: string, tx?: TransactionContext): Promise<{ failedCount: number; lockedUntil: Date | null }> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE users
      SET
        failed_login_count = failed_login_count + 1,
        locked_until = CASE
          WHEN failed_login_count >= 4 THEN NOW() + INTERVAL '15 minutes'
          ELSE locked_until
        END
      WHERE id = ${id}
      RETURNING failed_login_count, locked_until
    `;

    if (!result[0]) {
      throw new NotFoundError('User', id);
    }

    return {
      failedCount: result[0]['failed_login_count'] as number,
      lockedUntil: result[0]['locked_until'] as Date | null,
    };
  }

  async list(filters: UserListFilters = {}, tx?: TransactionContext): Promise<PaginatedResult<User>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const conditions: ReturnType<typeof db>[] = [];

    if (filters.status) {
      conditions.push(db`status = ${filters.status}`);
    }
    if (filters.emailVerified !== undefined) {
      conditions.push(db`email_verified = ${filters.emailVerified}`);
    }
    if (filters.search) {
      conditions.push(db`email ILIKE ${'%' + filters.search + '%'}`);
    }

    const whereClause = conditions.length > 0
      ? db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`
      : db``;

    const result = await db`
      SELECT
        id, email, email_normalized, password_hash, email_verified,
        email_verified_at, status, last_login_at, login_count,
        failed_login_count, locked_until, created_at, updated_at
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapUser(row));

    return { data, hasMore };
  }

  // ===========================================================================
  // User Profiles
  // ===========================================================================

  async findProfileByUserId(userId: string, tx?: TransactionContext): Promise<UserProfile | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, display_name, avatar_url, bio,
        timezone, locale, preferences, onboarding_completed_at,
        created_at, updated_at
      FROM user_profiles
      WHERE user_id = ${userId}
    `;

    return result[0] ? this.mapUserProfile(result[0]) : null;
  }

  async createProfile(data: UserProfileInsert, tx?: TransactionContext): Promise<UserProfile> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO user_profiles (
          user_id, display_name, avatar_url, bio, timezone, locale, preferences
        ) VALUES (
          ${data.user_id},
          ${data.display_name ?? null},
          ${data.avatar_url ?? null},
          ${data.bio ?? null},
          ${data.timezone ?? 'UTC'},
          ${data.locale ?? 'en-US'},
          ${JSON.stringify(data.preferences ?? {})}
        )
        RETURNING
          id, user_id, display_name, avatar_url, bio,
          timezone, locale, preferences, onboarding_completed_at,
          created_at, updated_at
      `;

      return this.mapUserProfile(result[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('UserProfile', 'user_id', data.user_id);
      }
      throw wrapDatabaseError(error, 'userProfiles.create');
    }
  }

  async updateProfile(
    userId: string,
    data: Partial<Omit<UserProfileInsert, 'user_id'>>,
    tx?: TransactionContext
  ): Promise<UserProfile> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE user_profiles
      SET
        display_name = COALESCE(${data.display_name ?? null}, display_name),
        avatar_url = COALESCE(${data.avatar_url ?? null}, avatar_url),
        bio = COALESCE(${data.bio ?? null}, bio),
        timezone = COALESCE(${data.timezone ?? null}, timezone),
        locale = COALESCE(${data.locale ?? null}, locale),
        preferences = COALESCE(${data.preferences ? JSON.stringify(data.preferences) : null}, preferences)
      WHERE user_id = ${userId}
      RETURNING
        id, user_id, display_name, avatar_url, bio,
        timezone, locale, preferences, onboarding_completed_at,
        created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('UserProfile', userId);
    }

    return this.mapUserProfile(result[0]);
  }

  async completeOnboarding(userId: string, tx?: TransactionContext): Promise<UserProfile> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE user_profiles
      SET onboarding_completed_at = NOW()
      WHERE user_id = ${userId}
      RETURNING
        id, user_id, display_name, avatar_url, bio,
        timezone, locale, preferences, onboarding_completed_at,
        created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('UserProfile', userId);
    }

    return this.mapUserProfile(result[0]);
  }

  // ===========================================================================
  // User MFA
  // ===========================================================================

  async findMFAByUserId(userId: string, tx?: TransactionContext): Promise<UserMFA[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, method, secret_encrypted, enabled,
        verified_at, backup_codes_hash, last_used_at, created_at, updated_at
      FROM user_mfa
      WHERE user_id = ${userId}
    `;

    return result.map(row => this.mapUserMFA(row));
  }

  async findEnabledMFA(userId: string, tx?: TransactionContext): Promise<UserMFA[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, method, secret_encrypted, enabled,
        verified_at, backup_codes_hash, last_used_at, created_at, updated_at
      FROM user_mfa
      WHERE user_id = ${userId} AND enabled = TRUE
    `;

    return result.map(row => this.mapUserMFA(row));
  }

  async createMFA(data: UserMFAInsert, tx?: TransactionContext): Promise<UserMFA> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO user_mfa (
          user_id, method, secret_encrypted, enabled, backup_codes_hash
        ) VALUES (
          ${data.user_id},
          ${data.method},
          ${data.secret_encrypted},
          ${data.enabled ?? false},
          ${data.backup_codes_hash ?? null}
        )
        RETURNING
          id, user_id, method, secret_encrypted, enabled,
          verified_at, backup_codes_hash, last_used_at, created_at, updated_at
      `;

      return this.mapUserMFA(result[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('UserMFA', 'method', data.method);
      }
      throw wrapDatabaseError(error, 'userMFA.create');
    }
  }

  async enableMFA(id: string, tx?: TransactionContext): Promise<UserMFA> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE user_mfa
      SET
        enabled = TRUE,
        verified_at = NOW()
      WHERE id = ${id}
      RETURNING
        id, user_id, method, secret_encrypted, enabled,
        verified_at, backup_codes_hash, last_used_at, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('UserMFA', id);
    }

    return this.mapUserMFA(result[0]);
  }

  async disableMFA(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM user_mfa
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('UserMFA', id);
    }
  }

  // ===========================================================================
  // User Sessions
  // ===========================================================================

  async createSession(data: UserSessionInsert, tx?: TransactionContext): Promise<UserSession> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO user_sessions (
        user_id, token_hash, device_info, ip_address, user_agent, expires_at
      ) VALUES (
        ${data.userId},
        ${data.tokenHash},
        ${data.deviceInfo ? JSON.stringify(data.deviceInfo) : null},
        ${data.ipAddress ?? null},
        ${data.userAgent ?? null},
        ${data.expiresAt}
      )
      RETURNING
        id, user_id, token_hash, device_info, ip_address,
        user_agent, expires_at, revoked_at, created_at
    `;

    return this.mapUserSession(result[0]!);
  }

  async findSessionByTokenHash(tokenHash: string, tx?: TransactionContext): Promise<UserSession | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, token_hash, device_info, ip_address,
        user_agent, expires_at, revoked_at, created_at
      FROM user_sessions
      WHERE token_hash = ${tokenHash}
        AND revoked_at IS NULL
        AND expires_at > NOW()
    `;

    return result[0] ? this.mapUserSession(result[0]) : null;
  }

  async revokeSession(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE user_sessions
      SET revoked_at = NOW()
      WHERE id = ${id}
    `;
  }

  async revokeAllUserSessions(userId: string, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE user_sessions
      SET revoked_at = NOW()
      WHERE user_id = ${userId}
        AND revoked_at IS NULL
      RETURNING id
    `;

    return result.length;
  }

  async listActiveSessions(userId: string, tx?: TransactionContext): Promise<UserSession[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, token_hash, device_info, ip_address,
        user_agent, expires_at, revoked_at, created_at
      FROM user_sessions
      WHERE user_id = ${userId}
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `;

    return result.map(row => this.mapUserSession(row));
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapUser(row: Record<string, unknown>): User {
    return {
      id: row['id'] as string,
      email: row['email'] as string,
      password_hash: row['password_hash'] as string,
      email_verified: row['email_verified'] as boolean,
      email_verified_at: row['email_verified_at'] as Date | null,
      status: row['status'] as UserStatus,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapUserProfile(row: Record<string, unknown>): UserProfile {
    return {
      id: row['id'] as string,
      user_id: row['user_id'] as string,
      display_name: row['display_name'] as string | null,
      avatar_url: row['avatar_url'] as string | null,
      bio: row['bio'] as string | null,
      timezone: row['timezone'] as string | null,
      locale: row['locale'] as string | null,
      preferences: row['preferences'] as JSONObject,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapUserMFA(row: Record<string, unknown>): UserMFA {
    return {
      id: row['id'] as string,
      user_id: row['user_id'] as string,
      method: row['method'] as MFAMethod,
      secret_encrypted: row['secret_encrypted'] as string,
      enabled: row['enabled'] as boolean,
      verified_at: row['verified_at'] as Date | null,
      backup_codes_hash: row['backup_codes_hash'] as string[] | null,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapUserSession(row: Record<string, unknown>): UserSession {
    return {
      id: row['id'] as string,
      userId: row['user_id'] as string,
      tokenHash: row['token_hash'] as string,
      deviceInfo: row['device_info'] as JSONObject | null,
      ipAddress: row['ip_address'] as string | null,
      userAgent: row['user_agent'] as string | null,
      expiresAt: row['expires_at'] as Date,
      revokedAt: row['revoked_at'] as Date | null,
      createdAt: row['created_at'] as Date,
    };
  }
}

// Singleton instance
let usersRepositoryInstance: UsersRepository | null = null;

export function getUsersRepository(): UsersRepository {
  if (!usersRepositoryInstance) {
    usersRepositoryInstance = new UsersRepository();
  }
  return usersRepositoryInstance;
}
