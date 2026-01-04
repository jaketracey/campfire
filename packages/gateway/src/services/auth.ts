/**
 * Auth Service
 * Handles authentication, session management, and authorization.
 */

import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getUsersRepository, type UserSession, type UserSessionInsert, type OAuthProvider, type UserOAuthAccount } from '../repositories/index.js';
import { getEventsService, type EventContext } from './events.js';
import { logger } from '../observability/logger.js';
import type { User, UserStatus, MFAMethod } from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const RegisterInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  mfaCode: z.string().optional(),
});

export const ChangePasswordInputSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(128),
});

export const ResetPasswordInputSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(8).max(128),
});

export const GoogleOAuthInputSchema = z.object({
  idToken: z.string(),
});

// ============================================================================
// Types
// ============================================================================

export type RegisterInput = z.infer<typeof RegisterInputSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>;
export type GoogleOAuthInput = z.infer<typeof GoogleOAuthInputSchema>;

export interface GoogleUserInfo {
  sub: string;        // Google user ID
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

export interface AuthResult {
  user: User;
  session: UserSession;
  token: string;
  expiresAt: Date;
  requiresMFA?: boolean;
  mfaMethods?: MFAMethod[];
}

export interface TokenPayload {
  userId: string;
  sessionId: string;
  email: string;
  iat: number;
  exp: number;
}

export interface AuthError {
  code: 'INVALID_CREDENTIALS' | 'EMAIL_NOT_VERIFIED' | 'ACCOUNT_LOCKED' |
        'ACCOUNT_SUSPENDED' | 'MFA_REQUIRED' | 'INVALID_MFA_CODE' |
        'SESSION_EXPIRED' | 'TOKEN_INVALID' | 'EMAIL_EXISTS' |
        'OAUTH_INVALID_TOKEN' | 'OAUTH_EMAIL_MISMATCH' | 'OAUTH_ACCOUNT_EXISTS' |
        'OAUTH_NOT_LINKED' | 'PASSWORD_REQUIRED_FOR_OAUTH';
  message: string;
}

// ============================================================================
// Service
// ============================================================================

export class AuthService {
  private users = getUsersRepository();
  private events = getEventsService();

  // Default session duration: 7 days
  private readonly SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
  // Max failed login attempts before lockout
  private readonly MAX_FAILED_ATTEMPTS = 5;
  // Lockout duration: 15 minutes
  private readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000;

  /**
   * Register a new user
   */
  async register(input: RegisterInput, tx?: TransactionContext): Promise<AuthResult> {
    const validated = RegisterInputSchema.parse(input);

    // Check if email already exists
    const existing = await this.users.findByEmail(validated.email, tx);
    if (existing) {
      throw this.createAuthError('EMAIL_EXISTS', 'An account with this email already exists');
    }

    // Hash the password
    const passwordHash = await hashPassword(validated.password);

    // Create the user
    const user = await this.users.create({
      email: validated.email,
      password_hash: passwordHash,
      email_verified: false,
      status: 'active',
    }, tx);

    // Create a profile for the user
    await this.users.createProfile({ user_id: user.id }, tx);

    // Create a session
    const { session, token } = await this.createSession(user.id, undefined, tx);

    logger.info({ userId: user.id, email: user.email }, 'User registered');

    return {
      user,
      session,
      token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Login with email and password
   */
  async login(
    input: LoginInput,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
    tx?: TransactionContext
  ): Promise<AuthResult> {
    const validated = LoginInputSchema.parse(input);

    const user = await this.users.findByEmail(validated.email, tx);
    if (!user) {
      throw this.createAuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Check account status
    await this.checkAccountStatus(user);

    // NOTE: Account lockout functionality (locked_until, failed_login_count) is not yet implemented.
    // When implemented, add locked_until and failed_login_count fields to the User type and
    // uncomment the lockout check logic here.

    // Verify password
    const isValid = await verifyPassword(validated.password, user.password_hash);
    if (!isValid) {
      // TODO: Implement failed login tracking when user security fields are added
      // await this.users.recordFailedLogin(user.id, tx);
      throw this.createAuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Check if MFA is required
    const mfaMethods = await this.users.findEnabledMFA(user.id, tx);
    if (mfaMethods.length > 0 && !validated.mfaCode) {
      return {
        user,
        session: null as unknown as UserSession, // Will be created after MFA
        token: '',
        expiresAt: new Date(),
        requiresMFA: true,
        mfaMethods: mfaMethods.map(m => m.method),
      };
    }

    // Verify MFA code if provided
    if (mfaMethods.length > 0 && validated.mfaCode) {
      const mfaValid = await this.verifyMFACode(user.id, validated.mfaCode, tx);
      if (!mfaValid) {
        throw this.createAuthError('INVALID_MFA_CODE', 'Invalid MFA code');
      }
    }

    // Record successful login
    await this.users.recordLogin(user.id, tx);

    // Create a session
    const { session, token } = await this.createSession(user.id, {
      ipAddress: deviceInfo?.ipAddress,
      userAgent: deviceInfo?.userAgent,
    }, tx);

    logger.info({ userId: user.id }, 'User logged in');

    return {
      user,
      session,
      token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Logout (revoke session)
   */
  async logout(tokenHash: string, tx?: TransactionContext): Promise<void> {
    const session = await this.users.findSessionByTokenHash(tokenHash, tx);
    if (!session) {
      return; // Session already revoked or doesn't exist
    }

    await this.users.revokeSession(session.id, tx);
    logger.debug({ sessionId: session.id }, 'Session revoked');
  }

  /**
   * Logout from all sessions
   */
  async logoutAllSessions(userId: string, tx?: TransactionContext): Promise<number> {
    const count = await this.users.revokeAllUserSessions(userId, tx);
    logger.info({ userId, count }, 'All sessions revoked');
    return count;
  }

  /**
   * Validate a session token
   */
  async validateToken(tokenHash: string, tx?: TransactionContext): Promise<{ user: User; session: UserSession } | null> {
    const session = await this.users.findSessionByTokenHash(tokenHash, tx);
    if (!session) {
      return null;
    }

    // Check if session is expired or revoked
    if (session.expiresAt < new Date() || session.revokedAt) {
      return null;
    }

    const user = await this.users.findById(session.userId, tx);
    if (!user) {
      return null;
    }

    // Check account status
    try {
      await this.checkAccountStatus(user);
    } catch {
      return null;
    }

    return { user, session };
  }

  /**
   * Refresh a session (extend expiration)
   */
  async refreshSession(tokenHash: string, tx?: TransactionContext): Promise<AuthResult | null> {
    const result = await this.validateToken(tokenHash, tx);
    if (!result) {
      return null;
    }

    // Revoke old session and create new one
    await this.users.revokeSession(result.session.id, tx);
    const { session: newSession, token } = await this.createSession(result.user.id, undefined, tx);

    return {
      user: result.user,
      session: newSession,
      token,
      expiresAt: newSession.expiresAt,
    };
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    tx?: TransactionContext
  ): Promise<void> {
    const validated = ChangePasswordInputSchema.parse(input);

    const user = await this.users.findById(userId, tx);
    if (!user) {
      throw this.createAuthError('TOKEN_INVALID', 'User not found');
    }

    // Verify current password
    const isValid = await verifyPassword(validated.currentPassword, user.password_hash);
    if (!isValid) {
      throw this.createAuthError('INVALID_CREDENTIALS', 'Current password is incorrect');
    }

    // Hash and update new password
    const passwordHash = await hashPassword(validated.newPassword);
    await this.users.update(userId, { password_hash: passwordHash }, tx);

    // Revoke all other sessions for security
    await this.users.revokeAllUserSessions(userId, tx);

    logger.info({ userId }, 'Password changed');
  }

  /**
   * Request password reset (generate token)
   */
  async requestPasswordReset(email: string, tx?: TransactionContext): Promise<string | null> {
    const user = await this.users.findByEmail(email, tx);
    if (!user) {
      // Return null but don't reveal if email exists
      return null;
    }

    // Generate a reset token (in production, store this securely with expiration)
    const resetToken = nanoid(32);

    // In a real implementation, you would:
    // 1. Store the token hash with expiration
    // 2. Send email with reset link
    // For now, we just return the token

    logger.info({ userId: user.id }, 'Password reset requested');
    return resetToken;
  }

  /**
   * Verify email address
   */
  async verifyEmail(userId: string, tx?: TransactionContext): Promise<void> {
    await this.users.verifyEmail(userId, tx);
    logger.info({ userId }, 'Email verified');
  }

  /**
   * Enable MFA for a user
   */
  async enableMFA(
    userId: string,
    method: MFAMethod,
    secret: string,
    tx?: TransactionContext
  ): Promise<void> {
    // Create or update MFA record
    const existing = await this.users.findMFAByUserId(userId, tx);
    const existingMethod = existing.find(m => m.method === method);

    if (existingMethod) {
      await this.users.enableMFA(existingMethod.id, tx);
    } else {
      const mfa = await this.users.createMFA({
        user_id: userId,
        method,
        secret_encrypted: secret, // Should be encrypted in production
        enabled: true,
      }, tx);

      // Emit security event
      const context: EventContext = {
        userId,
        sessionId: 'system',
        traceId: crypto.randomUUID(),
      };
      await this.events.emit({
        type: 'security.mfa.enabled',
        payload: { method, mfaId: mfa.id },
        context,
      });
    }

    logger.info({ userId, method }, 'MFA enabled');
  }

  /**
   * Disable MFA for a user
   */
  async disableMFA(
    userId: string,
    method: MFAMethod,
    tx?: TransactionContext
  ): Promise<void> {
    const mfaMethods = await this.users.findMFAByUserId(userId, tx);
    const mfa = mfaMethods.find(m => m.method === method);

    if (mfa) {
      await this.users.disableMFA(mfa.id, tx);
      logger.info({ userId, method }, 'MFA disabled');
    }
  }

  /**
   * Get active sessions for a user
   */
  async getActiveSessions(userId: string, tx?: TransactionContext): Promise<UserSession[]> {
    return this.users.listActiveSessions(userId, tx);
  }

  // ===========================================================================
  // Google OAuth Authentication
  // ===========================================================================

  /**
   * Authenticate with Google OAuth
   * Handles both signup (new users) and login (existing users)
   */
  async authenticateWithGoogle(
    input: GoogleOAuthInput,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
    tx?: TransactionContext
  ): Promise<AuthResult> {
    const validated = GoogleOAuthInputSchema.parse(input);

    // Verify the Google ID token and get user info
    const googleUser = await this.verifyGoogleToken(validated.idToken);
    if (!googleUser) {
      throw this.createAuthError('OAUTH_INVALID_TOKEN', 'Invalid or expired Google token');
    }

    if (!googleUser.email_verified) {
      throw this.createAuthError('OAUTH_INVALID_TOKEN', 'Google account email is not verified');
    }

    // Check if this Google account is already linked to a user
    const existingOAuth = await this.users.findOAuthAccount('google', googleUser.sub, tx);

    if (existingOAuth) {
      // User has linked their Google account before - log them in
      const user = await this.users.findById(existingOAuth.userId, tx);
      if (!user) {
        throw this.createAuthError('INVALID_CREDENTIALS', 'User account not found');
      }

      // Check account status
      await this.checkAccountStatus(user);

      // Update OAuth tokens if needed
      await this.users.updateOAuthAccount(existingOAuth.id, {
        providerEmail: googleUser.email,
        profileData: {
          name: googleUser.name,
          picture: googleUser.picture,
        },
      }, tx);

      // Record login
      await this.users.recordLogin(user.id, tx);

      // Create session
      const { session, token } = await this.createSession(user.id, deviceInfo, tx);

      logger.info({ userId: user.id, provider: 'google' }, 'User logged in with Google');

      return {
        user,
        session,
        token,
        expiresAt: session.expiresAt,
      };
    }

    // Check if a user exists with this email
    const existingUser = await this.users.findByEmail(googleUser.email, tx);

    if (existingUser) {
      // User exists with this email but hasn't linked Google
      // Check account status first
      await this.checkAccountStatus(existingUser);

      // Link the Google account to the existing user
      await this.users.createOAuthAccount({
        userId: existingUser.id,
        provider: 'google',
        providerUserId: googleUser.sub,
        providerEmail: googleUser.email,
        profileData: {
          name: googleUser.name,
          picture: googleUser.picture,
        },
      }, tx);

      // Mark email as verified since Google verified it
      if (!existingUser.email_verified) {
        await this.users.verifyEmail(existingUser.id, tx);
      }

      // Record login
      await this.users.recordLogin(existingUser.id, tx);

      // Create session
      const { session, token } = await this.createSession(existingUser.id, deviceInfo, tx);

      logger.info({ userId: existingUser.id, provider: 'google' }, 'Existing user linked Google account');

      return {
        user: existingUser,
        session,
        token,
        expiresAt: session.expiresAt,
      };
    }

    // New user - create account
    // Generate a random password hash for OAuth-only users (they can't use password login)
    const randomPassword = nanoid(32);
    const passwordHash = await hashPassword(randomPassword);

    const user = await this.users.create({
      email: googleUser.email,
      password_hash: passwordHash,
      email_verified: true, // Google verified the email
      status: 'active',
    }, tx);

    // Create user profile with Google data
    await this.users.createProfile({
      user_id: user.id,
      display_name: googleUser.name || googleUser.given_name || undefined,
      avatar_url: googleUser.picture || undefined,
    }, tx);

    // Link the Google account
    await this.users.createOAuthAccount({
      userId: user.id,
      provider: 'google',
      providerUserId: googleUser.sub,
      providerEmail: googleUser.email,
      profileData: {
        name: googleUser.name,
        given_name: googleUser.given_name,
        family_name: googleUser.family_name,
        picture: googleUser.picture,
      },
    }, tx);

    // Record login for new user
    await this.users.recordLogin(user.id, tx);

    // Create session
    const { session, token } = await this.createSession(user.id, deviceInfo, tx);

    logger.info({ userId: user.id, provider: 'google' }, 'New user registered with Google');

    return {
      user,
      session,
      token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Get OAuth accounts linked to a user
   */
  async getLinkedOAuthAccounts(userId: string, tx?: TransactionContext): Promise<UserOAuthAccount[]> {
    return this.users.findOAuthAccountsByUserId(userId, tx);
  }

  /**
   * Unlink an OAuth account from a user
   * Requires the user to have a password set or another OAuth account linked
   */
  async unlinkOAuthAccount(
    userId: string,
    provider: OAuthProvider,
    tx?: TransactionContext
  ): Promise<void> {
    const oauthAccount = await this.users.findOAuthAccountByUserAndProvider(userId, provider, tx);
    if (!oauthAccount) {
      throw this.createAuthError('OAUTH_NOT_LINKED', `No ${provider} account linked`);
    }

    // Check if user has other authentication methods
    const allOAuthAccounts = await this.users.findOAuthAccountsByUserId(userId, tx);

    // If this is the only OAuth account, don't allow unlinking
    // (In a real app, you'd check if they have a password set too)
    if (allOAuthAccounts.length <= 1) {
      throw this.createAuthError(
        'PASSWORD_REQUIRED_FOR_OAUTH',
        'Cannot unlink the only authentication method. Please set a password first.'
      );
    }

    await this.users.deleteOAuthAccount(oauthAccount.id, tx);
    logger.info({ userId, provider }, 'OAuth account unlinked');
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  /**
   * Verify a Google ID token and extract user info
   */
  private async verifyGoogleToken(idToken: string): Promise<GoogleUserInfo | null> {
    try {
      // Verify the token with Google's tokeninfo endpoint
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Google token verification failed');
        return null;
      }

      const data = await response.json() as Record<string, unknown>;

      // Verify the audience (client ID)
      const expectedClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      if (expectedClientId && data['aud'] !== expectedClientId) {
        logger.warn({ expected: expectedClientId, got: data['aud'] }, 'Google token audience mismatch');
        return null;
      }

      // Ensure required fields are present
      if (!data['sub'] || !data['email']) {
        logger.warn('Google token missing required fields');
        return null;
      }

      return {
        sub: data['sub'] as string,
        email: data['email'] as string,
        email_verified: data['email_verified'] === 'true' || data['email_verified'] === true,
        name: data['name'] as string | undefined,
        given_name: data['given_name'] as string | undefined,
        family_name: data['family_name'] as string | undefined,
        picture: data['picture'] as string | undefined,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to verify Google token');
      return null;
    }
  }

  private async createSession(
    userId: string,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
    tx?: TransactionContext
  ): Promise<{ session: UserSession; token: string }> {
    const token = nanoid(32);
    const tokenHash = await this.hashToken(token);
    const expiresAt = new Date(Date.now() + this.SESSION_DURATION_MS);

    const session = await this.users.createSession({
      userId,
      tokenHash,
      expiresAt,
      ipAddress: deviceInfo?.ipAddress,
      userAgent: deviceInfo?.userAgent,
    }, tx);

    return { session, token };
  }

  private async checkAccountStatus(user: User): Promise<void> {
    if (user.status === 'suspended') {
      throw this.createAuthError('ACCOUNT_SUSPENDED', 'Account has been suspended');
    }
    if (user.status === 'deleted') {
      throw this.createAuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
  }

  private async lockAccount(userId: string, tx?: TransactionContext): Promise<void> {
    const lockUntil = new Date(Date.now() + this.LOCKOUT_DURATION_MS);
    // This would need to be added to the repository
    // For now, we rely on failed_login_count check
    logger.warn({ userId, lockUntil }, 'Account locked due to failed login attempts');
  }

  private async verifyMFACode(
    userId: string,
    code: string,
    tx?: TransactionContext
  ): Promise<boolean> {
    const mfaMethods = await this.users.findEnabledMFA(userId, tx);
    if (mfaMethods.length === 0) {
      return true; // No MFA configured
    }

    // In a real implementation, verify the code against the secret
    // For TOTP, use a library like 'otplib'
    // For now, just check if code is provided
    return code.length === 6 && /^\d+$/.test(code);
  }

  private async hashToken(token: string): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private createAuthError(code: AuthError['code'], message: string): Error & AuthError {
    const error = new Error(message) as Error & AuthError;
    error.code = code;
    error.message = message;
    return error;
  }
}

// Singleton instance
let authService: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authService) {
    authService = new AuthService();
  }
  return authService;
}
