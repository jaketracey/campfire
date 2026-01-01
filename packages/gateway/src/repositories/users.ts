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
  UserRole,
  MFAMethod,
  JSONObject,
} from '../db/types.js';

/**
 * OAuth provider type
 */
export type OAuthProvider = 'google' | 'github' | 'apple';

/**
 * User OAuth account record
 */
export interface UserOAuthAccount {
  id: string;
  userId: string;
  provider: OAuthProvider;
  providerUserId: string;
  providerEmail: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  profileData: JSONObject | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User OAuth account insert
 */
export interface UserOAuthAccountInsert {
  userId: string;
  provider: OAuthProvider;
  providerUserId: string;
  providerEmail?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  profileData?: JSONObject | null;
}
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
  role?: UserRole;
}

/**
 * User with companion stats for admin listing
 */
export interface UserWithStats {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  loginCount: number;
  companionCount: number;
  imageCount: number;
  totalTokens: number;
  createdAt: Date;
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
        email_verified_at, status, role, last_login_at, login_count,
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
        email_verified_at, status, role, last_login_at, login_count,
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
          email, password_hash, email_verified, status, role
        ) VALUES (
          ${data.email},
          ${data.password_hash},
          ${data.email_verified ?? false},
          ${data.status ?? 'active'},
          ${data.role ?? 'user'}
        )
        RETURNING
          id, email, email_normalized, password_hash, email_verified,
          email_verified_at, status, role, last_login_at, login_count,
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
        status = COALESCE(${data.status ?? null}, status),
        role = COALESCE(${data.role ?? null}, role)
      WHERE id = ${id}
      RETURNING
        id, email, email_normalized, password_hash, email_verified,
        email_verified_at, status, role, last_login_at, login_count,
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
        email_verified_at, status, role, last_login_at, login_count,
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
        email_verified_at, status, role, last_login_at, login_count,
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

  /**
   * List users with companion count stats (for admin panel)
   */
  async listWithStats(
    filters: UserListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<UserWithStats>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const conditions: ReturnType<typeof db>[] = [db`u.status != 'deleted'`];

    if (filters.status) {
      conditions.push(db`u.status = ${filters.status}`);
    }
    if (filters.role) {
      conditions.push(db`u.role = ${filters.role}`);
    }
    if (filters.emailVerified !== undefined) {
      conditions.push(db`u.email_verified = ${filters.emailVerified}`);
    }
    if (filters.search) {
      conditions.push(db`u.email ILIKE ${'%' + filters.search + '%'}`);
    }

    const whereClause = db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`;

    const result = await db`
      SELECT
        u.id,
        u.email,
        u.role,
        u.status,
        u.email_verified,
        u.last_login_at,
        u.login_count,
        u.created_at,
        COALESCE(c.companion_count, 0)::int as companion_count,
        COALESCE(i.image_count, 0)::int as image_count,
        COALESCE(s.total_tokens, 0)::bigint as total_tokens
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int as companion_count
        FROM companions
        WHERE status != 'archived'
        GROUP BY user_id
      ) c ON c.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int as image_count
        FROM companion_images
        GROUP BY user_id
      ) i ON i.user_id = u.id::text
      LEFT JOIN (
        SELECT user_id, SUM(total_tokens_input + total_tokens_output)::bigint as total_tokens
        FROM sessions
        GROUP BY user_id
      ) s ON s.user_id = u.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapUserWithStats(row));

    return { data, hasMore };
  }

  /**
   * Update user role
   */
  async updateRole(
    id: string,
    role: UserRole,
    tx?: TransactionContext
  ): Promise<User> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE users
      SET role = ${role}
      WHERE id = ${id}
      RETURNING
        id, email, email_normalized, password_hash, email_verified,
        email_verified_at, status, role, last_login_at, login_count,
        failed_login_count, locked_until, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('User', id);
    }

    logger.info({ userId: id, role }, 'User role updated');
    return this.mapUser(result[0]);
  }

  /**
   * Update user status (for suspend/unsuspend)
   */
  async updateStatus(
    id: string,
    status: UserStatus,
    tx?: TransactionContext
  ): Promise<User> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE users
      SET status = ${status}
      WHERE id = ${id}
      RETURNING
        id, email, email_normalized, password_hash, email_verified,
        email_verified_at, status, role, last_login_at, login_count,
        failed_login_count, locked_until, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('User', id);
    }

    logger.info({ userId: id, status }, 'User status updated');
    return this.mapUser(result[0]);
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
  // User OAuth Accounts
  // ===========================================================================

  async findOAuthAccount(
    provider: OAuthProvider,
    providerUserId: string,
    tx?: TransactionContext
  ): Promise<UserOAuthAccount | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, provider, provider_user_id, provider_email,
        access_token, refresh_token, token_expires_at, profile_data,
        created_at, updated_at
      FROM user_oauth_accounts
      WHERE provider = ${provider} AND provider_user_id = ${providerUserId}
    `;

    return result[0] ? this.mapUserOAuthAccount(result[0]) : null;
  }

  async findOAuthAccountByUserAndProvider(
    userId: string,
    provider: OAuthProvider,
    tx?: TransactionContext
  ): Promise<UserOAuthAccount | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, provider, provider_user_id, provider_email,
        access_token, refresh_token, token_expires_at, profile_data,
        created_at, updated_at
      FROM user_oauth_accounts
      WHERE user_id = ${userId} AND provider = ${provider}
    `;

    return result[0] ? this.mapUserOAuthAccount(result[0]) : null;
  }

  async findOAuthAccountsByUserId(userId: string, tx?: TransactionContext): Promise<UserOAuthAccount[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, provider, provider_user_id, provider_email,
        access_token, refresh_token, token_expires_at, profile_data,
        created_at, updated_at
      FROM user_oauth_accounts
      WHERE user_id = ${userId}
    `;

    return result.map(row => this.mapUserOAuthAccount(row));
  }

  async createOAuthAccount(data: UserOAuthAccountInsert, tx?: TransactionContext): Promise<UserOAuthAccount> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO user_oauth_accounts (
          user_id, provider, provider_user_id, provider_email,
          access_token, refresh_token, token_expires_at, profile_data
        ) VALUES (
          ${data.userId},
          ${data.provider},
          ${data.providerUserId},
          ${data.providerEmail ?? null},
          ${data.accessToken ?? null},
          ${data.refreshToken ?? null},
          ${data.tokenExpiresAt ?? null},
          ${data.profileData ? JSON.stringify(data.profileData) : null}
        )
        RETURNING
          id, user_id, provider, provider_user_id, provider_email,
          access_token, refresh_token, token_expires_at, profile_data,
          created_at, updated_at
      `;

      const account = this.mapUserOAuthAccount(result[0]!);
      logger.debug({ userId: data.userId, provider: data.provider }, 'OAuth account created');
      return account;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('UserOAuthAccount', 'provider', `${data.provider}:${data.providerUserId}`);
      }
      throw wrapDatabaseError(error, 'userOAuthAccounts.create');
    }
  }

  async updateOAuthAccount(
    id: string,
    data: Partial<Omit<UserOAuthAccountInsert, 'userId' | 'provider' | 'providerUserId'>>,
    tx?: TransactionContext
  ): Promise<UserOAuthAccount> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE user_oauth_accounts
      SET
        provider_email = COALESCE(${data.providerEmail ?? null}, provider_email),
        access_token = COALESCE(${data.accessToken ?? null}, access_token),
        refresh_token = COALESCE(${data.refreshToken ?? null}, refresh_token),
        token_expires_at = COALESCE(${data.tokenExpiresAt ?? null}, token_expires_at),
        profile_data = COALESCE(${data.profileData ? JSON.stringify(data.profileData) : null}, profile_data)
      WHERE id = ${id}
      RETURNING
        id, user_id, provider, provider_user_id, provider_email,
        access_token, refresh_token, token_expires_at, profile_data,
        created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('UserOAuthAccount', id);
    }

    return this.mapUserOAuthAccount(result[0]);
  }

  async deleteOAuthAccount(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM user_oauth_accounts
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('UserOAuthAccount', id);
    }
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
      role: row['role'] as UserRole,
      last_login_at: row['last_login_at'] as Date | null,
      login_count: row['login_count'] as number,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapUserWithStats(row: Record<string, unknown>): UserWithStats {
    return {
      id: row['id'] as string,
      email: row['email'] as string,
      role: row['role'] as UserRole,
      status: row['status'] as UserStatus,
      emailVerified: row['email_verified'] as boolean,
      lastLoginAt: row['last_login_at'] as Date | null,
      loginCount: row['login_count'] as number,
      companionCount: row['companion_count'] as number,
      imageCount: row['image_count'] as number,
      totalTokens: Number(row['total_tokens']),
      createdAt: row['created_at'] as Date,
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

  private mapUserOAuthAccount(row: Record<string, unknown>): UserOAuthAccount {
    return {
      id: row['id'] as string,
      userId: row['user_id'] as string,
      provider: row['provider'] as OAuthProvider,
      providerUserId: row['provider_user_id'] as string,
      providerEmail: row['provider_email'] as string | null,
      accessToken: row['access_token'] as string | null,
      refreshToken: row['refresh_token'] as string | null,
      tokenExpiresAt: row['token_expires_at'] as Date | null,
      profileData: row['profile_data'] as JSONObject | null,
      createdAt: row['created_at'] as Date,
      updatedAt: row['updated_at'] as Date,
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
