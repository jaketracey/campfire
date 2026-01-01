/**
 * Users Service
 * Business logic for user management, profiles, and preferences.
 */

import { z } from 'zod';
import {
  getUsersRepository,
  type UserWithProfile,
  type UserListFilters,
  type PaginatedResult,
} from '../repositories/index.js';
import { getEventsService, type EventContext } from './events.js';
import { logger } from '../observability/logger.js';
import type { User, UserProfile, UserStatus, JSONObject } from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const UpdateProfileInputSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  timezone: z.string().optional().nullable(),
  locale: z.string().optional().nullable(),
});

export const UpdatePreferencesInputSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  notificationsEnabled: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  voiceSpeed: z.number().min(0.5).max(2.0).optional(),
  autoplayAudio: z.boolean().optional(),
});

export const OnboardingInputSchema = z.object({
  displayName: z.string().min(1).max(100),
  timezone: z.string().optional(),
  goals: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
});

// ============================================================================
// Types
// ============================================================================

export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesInputSchema>;
export type OnboardingInput = z.infer<typeof OnboardingInputSchema>;

export interface UserPublicProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: Date;
}

export interface UserSettings {
  profile: UserProfile;
  preferences: UserPreferences;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  soundEnabled: boolean;
  voiceSpeed: number;
  autoplayAudio: boolean;
}

export interface UserStats {
  totalSessions: number;
  totalTurns: number;
  totalVoiceMinutes: number;
  companionCount: number;
  memoryCount: number;
  accountAge: number; // days
}

// ============================================================================
// Default Preferences
// ============================================================================

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  notificationsEnabled: true,
  emailNotifications: true,
  soundEnabled: true,
  voiceSpeed: 1.0,
  autoplayAudio: true,
};

// ============================================================================
// Service
// ============================================================================

export class UsersService {
  private users = getUsersRepository();
  private events = getEventsService();

  /**
   * Get a user by ID
   */
  async getById(userId: string, tx?: TransactionContext): Promise<User | null> {
    return this.users.findById(userId, tx);
  }

  /**
   * Get a user with profile
   */
  async getWithProfile(userId: string, tx?: TransactionContext): Promise<UserWithProfile | null> {
    const user = await this.users.findById(userId, tx);
    if (!user) return null;

    const profile = await this.users.findProfileByUserId(userId, tx);

    return {
      ...user,
      profile,
    };
  }

  /**
   * Get user's profile
   */
  async getProfile(userId: string, tx?: TransactionContext): Promise<UserProfile | null> {
    return this.users.findProfileByUserId(userId, tx);
  }

  /**
   * Get user's public profile (safe for external viewing)
   */
  async getPublicProfile(userId: string, tx?: TransactionContext): Promise<UserPublicProfile | null> {
    const profile = await this.users.findProfileByUserId(userId, tx);
    if (!profile) return null;

    return {
      id: profile.user_id,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      bio: profile.bio,
      createdAt: profile.created_at,
    };
  }

  /**
   * Update user's profile
   */
  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
    tx?: TransactionContext
  ): Promise<UserProfile> {
    const validated = UpdateProfileInputSchema.parse(input);

    let profile = await this.users.findProfileByUserId(userId, tx);

    if (!profile) {
      // Create profile if it doesn't exist
      profile = await this.users.createProfile({
        user_id: userId,
        display_name: validated.displayName,
        avatar_url: validated.avatarUrl,
        bio: validated.bio,
        timezone: validated.timezone,
        locale: validated.locale,
      }, tx);
    } else {
      // Update existing profile
      profile = await this.users.updateProfile(profile.id, {
        display_name: validated.displayName,
        avatar_url: validated.avatarUrl,
        bio: validated.bio,
        timezone: validated.timezone,
        locale: validated.locale,
      }, tx);
    }

    logger.debug({ userId }, 'User profile updated');
    return profile;
  }

  /**
   * Get user's preferences
   */
  async getPreferences(userId: string, tx?: TransactionContext): Promise<UserPreferences> {
    const profile = await this.users.findProfileByUserId(userId, tx);
    if (!profile) {
      return { ...DEFAULT_PREFERENCES };
    }

    const prefs = profile.preferences as Record<string, unknown>;
    return {
      theme: (prefs.theme as UserPreferences['theme']) ?? DEFAULT_PREFERENCES.theme,
      notificationsEnabled: (prefs.notificationsEnabled as boolean) ?? DEFAULT_PREFERENCES.notificationsEnabled,
      emailNotifications: (prefs.emailNotifications as boolean) ?? DEFAULT_PREFERENCES.emailNotifications,
      soundEnabled: (prefs.soundEnabled as boolean) ?? DEFAULT_PREFERENCES.soundEnabled,
      voiceSpeed: (prefs.voiceSpeed as number) ?? DEFAULT_PREFERENCES.voiceSpeed,
      autoplayAudio: (prefs.autoplayAudio as boolean) ?? DEFAULT_PREFERENCES.autoplayAudio,
    };
  }

  /**
   * Update user's preferences
   */
  async updatePreferences(
    userId: string,
    input: UpdatePreferencesInput,
    tx?: TransactionContext
  ): Promise<UserPreferences> {
    const validated = UpdatePreferencesInputSchema.parse(input);

    let profile = await this.users.findProfileByUserId(userId, tx);
    const currentPrefs = profile?.preferences ?? {};

    const newPrefs = {
      ...currentPrefs,
      ...validated,
    };

    if (!profile) {
      profile = await this.users.createProfile({
        user_id: userId,
        preferences: newPrefs,
      }, tx);
    } else {
      profile = await this.users.updateProfile(profile.id, {
        preferences: newPrefs as JSONObject,
      }, tx);
    }

    logger.debug({ userId }, 'User preferences updated');
    return this.getPreferences(userId, tx);
  }

  /**
   * Get all user settings (profile + preferences)
   */
  async getSettings(userId: string, tx?: TransactionContext): Promise<UserSettings | null> {
    const profile = await this.users.findProfileByUserId(userId, tx);
    if (!profile) return null;

    const preferences = await this.getPreferences(userId, tx);

    return {
      profile,
      preferences,
    };
  }

  /**
   * Complete user onboarding
   */
  async completeOnboarding(
    userId: string,
    input: OnboardingInput,
    tx?: TransactionContext
  ): Promise<UserProfile> {
    const validated = OnboardingInputSchema.parse(input);

    let profile = await this.users.findProfileByUserId(userId, tx);

    const onboardingData: JSONObject = {
      completedAt: new Date().toISOString(),
      goals: validated.goals ?? [],
      interests: validated.interests ?? [],
    };

    if (!profile) {
      profile = await this.users.createProfile({
        user_id: userId,
        display_name: validated.displayName,
        timezone: validated.timezone,
        preferences: {
          ...DEFAULT_PREFERENCES,
          onboarding: onboardingData,
        },
      }, tx);
    } else {
      const currentPrefs = profile.preferences as Record<string, unknown>;
      profile = await this.users.updateProfile(profile.id, {
        display_name: validated.displayName,
        timezone: validated.timezone,
        preferences: {
          ...currentPrefs,
          onboarding: onboardingData,
        } as JSONObject,
      }, tx);

      await this.users.completeOnboarding(profile.id, tx);
    }

    logger.info({ userId }, 'User onboarding completed');
    return profile;
  }

  /**
   * Check if user has completed onboarding
   */
  async hasCompletedOnboarding(userId: string, tx?: TransactionContext): Promise<boolean> {
    const profile = await this.users.findProfileByUserId(userId, tx);
    if (!profile) return false;

    const prefs = profile.preferences as Record<string, unknown>;
    return !!prefs.onboarding;
  }

  /**
   * Update user status (admin action)
   */
  async updateStatus(
    userId: string,
    status: UserStatus,
    reason?: string,
    tx?: TransactionContext
  ): Promise<User> {
    const user = await this.users.update(userId, { status }, tx);

    // Log admin action
    logger.info({ userId, status, reason }, 'User status updated');

    return user;
  }

  /**
   * Suspend a user
   */
  async suspend(userId: string, reason: string, tx?: TransactionContext): Promise<User> {
    return this.updateStatus(userId, 'suspended', reason, tx);
  }

  /**
   * Reactivate a suspended user
   */
  async reactivate(userId: string, tx?: TransactionContext): Promise<User> {
    return this.updateStatus(userId, 'active', 'Account reactivated', tx);
  }

  /**
   * Delete a user (soft delete)
   */
  async delete(userId: string, tx?: TransactionContext): Promise<void> {
    await this.users.delete(userId, tx);
    logger.info({ userId }, 'User deleted');
  }

  /**
   * List users (admin)
   */
  async list(
    filters: UserListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<User>> {
    return this.users.list(filters, tx);
  }

  /**
   * Search users by email or display name
   */
  async search(
    query: string,
    options: { limit?: number } = {},
    tx?: TransactionContext
  ): Promise<User[]> {
    const result = await this.users.list({
      search: query,
      limit: options.limit ?? 20,
    }, tx);

    return result.data;
  }

  /**
   * Get user statistics
   */
  async getStats(userId: string, tx?: TransactionContext): Promise<UserStats | null> {
    const user = await this.users.findById(userId, tx);
    if (!user) return null;

    // These would need to be implemented with proper repository queries
    // For now, returning placeholder data
    const accountAgeDays = Math.floor(
      (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      totalSessions: 0, // Would query sessions repository
      totalTurns: 0, // Would query turns from sessions
      totalVoiceMinutes: 0, // Would query billing/usage
      companionCount: 0, // Would query companions repository
      memoryCount: 0, // Would query memories repository
      accountAge: accountAgeDays,
    };
  }

  /**
   * Export user data (GDPR compliance)
   */
  async exportUserData(userId: string, tx?: TransactionContext): Promise<Record<string, unknown>> {
    const user = await this.users.findById(userId, tx);
    if (!user) {
      throw new Error('User not found');
    }

    const profile = await this.users.findProfileByUserId(userId, tx);
    const mfa = await this.users.findMFAByUserId(userId, tx);
    const sessions = await this.users.listActiveSessions(userId, tx);

    // Note: In a real implementation, you would also export:
    // - All companions
    // - All sessions and turns
    // - All memories
    // - Billing history
    // - Event history

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.email_verified,
        status: user.status,
        createdAt: user.created_at,
      },
      profile: profile ? {
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
        bio: profile.bio,
        timezone: profile.timezone,
        locale: profile.locale,
        preferences: profile.preferences,
      } : null,
      mfaMethods: mfa.map(m => ({
        method: m.method,
        enabled: m.enabled,
        createdAt: m.created_at,
      })),
      activeSessions: sessions.length,
    };
  }

  /**
   * Get event context for user operations
   */
  getEventContext(userId: string): EventContext {
    return this.events.createContextFromRequest(userId, 'user-management');
  }
}

// Singleton instance
let usersService: UsersService | null = null;

export function getUsersService(): UsersService {
  if (!usersService) {
    usersService = new UsersService();
  }
  return usersService;
}
