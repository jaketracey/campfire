/**
 * Personality Profiles Repository
 * Data access for user_personality_profiles table
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, wrapDatabaseError } from './errors.js';

/**
 * Greeting style for welcome messages
 */
export type GreetingStyle = 'warm' | 'playful' | 'formal' | 'friendly';

/**
 * Preferred communication tone
 */
export type PreferredTone = 'casual' | 'formal' | 'playful' | 'direct';

/**
 * Verbosity level
 */
export type VerbosityLevel = 'concise' | 'moderate' | 'detailed';

/**
 * User personality traits (0-100 scale)
 */
export interface PersonalityTraits {
  warmth: number | null;
  energy: number | null;
  humor: number | null;
  formality: number | null;
  curiosity: number | null;
  openness: number | null;
}

/**
 * User personality profile record
 */
export interface UserPersonalityProfile {
  id: string;
  userId: string;
  analysisVersion: string;
  turnsAnalyzed: number;
  lastAnalysisAt: Date;
  nextAnalysisThreshold: number;
  warmth: number | null;
  energy: number | null;
  humor: number | null;
  formality: number | null;
  curiosity: number | null;
  openness: number | null;
  preferredTone: PreferredTone | null;
  verbosity: VerbosityLevel | null;
  personalityInsights: string[];
  detectedInterests: string[];
  conversationThemes: string[];
  greetingStyle: GreetingStyle;
  customInsight: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User personality profile insert
 */
export interface UserPersonalityProfileInsert {
  userId: string;
  analysisVersion?: string;
  turnsAnalyzed: number;
  nextAnalysisThreshold?: number;
  warmth?: number | null;
  energy?: number | null;
  humor?: number | null;
  formality?: number | null;
  curiosity?: number | null;
  openness?: number | null;
  preferredTone?: PreferredTone | null;
  verbosity?: VerbosityLevel | null;
  personalityInsights?: string[];
  detectedInterests?: string[];
  conversationThemes?: string[];
  greetingStyle?: GreetingStyle;
  customInsight?: string | null;
}

/**
 * User personality profile update
 */
export type UserPersonalityProfileUpdate = Partial<Omit<UserPersonalityProfileInsert, 'userId'>>;

/**
 * Profile list filters for admin
 */
export interface ProfileListFilters extends PaginationOptions {
  hasProfile?: boolean;
}

/**
 * User needing analysis
 */
export interface UserNeedingAnalysis {
  userId: string;
  totalTurns: number;
  currentThreshold: number;
}

export class PersonalityProfilesRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  /**
   * Map database row to UserPersonalityProfile
   */
  private mapProfile(row: Record<string, unknown>): UserPersonalityProfile {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      analysisVersion: row.analysis_version as string,
      turnsAnalyzed: row.turns_analyzed as number,
      lastAnalysisAt: row.last_analysis_at as Date,
      nextAnalysisThreshold: row.next_analysis_threshold as number,
      warmth: row.warmth as number | null,
      energy: row.energy as number | null,
      humor: row.humor as number | null,
      formality: row.formality as number | null,
      curiosity: row.curiosity as number | null,
      openness: row.openness as number | null,
      preferredTone: row.preferred_tone as PreferredTone | null,
      verbosity: row.verbosity as VerbosityLevel | null,
      personalityInsights: (row.personality_insights as string[]) || [],
      detectedInterests: (row.detected_interests as string[]) || [],
      conversationThemes: (row.conversation_themes as string[]) || [],
      greetingStyle: row.greeting_style as GreetingStyle,
      customInsight: row.custom_insight as string | null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  /**
   * Find profile by ID
   */
  async findById(id: string, tx?: TransactionContext): Promise<UserPersonalityProfile | null> {
    const db = this.getSql(tx);
    try {
      const result = await db`
        SELECT *
        FROM user_personality_profiles
        WHERE id = ${id}
      `;
      return result[0] ? this.mapProfile(result[0]) : null;
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  /**
   * Find profile by user ID
   */
  async findByUserId(userId: string, tx?: TransactionContext): Promise<UserPersonalityProfile | null> {
    const db = this.getSql(tx);
    try {
      const result = await db`
        SELECT *
        FROM user_personality_profiles
        WHERE user_id = ${userId}
      `;
      return result[0] ? this.mapProfile(result[0]) : null;
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  /**
   * Create a new profile
   */
  async create(data: UserPersonalityProfileInsert, tx?: TransactionContext): Promise<UserPersonalityProfile> {
    const db = this.getSql(tx);
    try {
      const result = await db`
        INSERT INTO user_personality_profiles (
          user_id,
          analysis_version,
          turns_analyzed,
          next_analysis_threshold,
          warmth,
          energy,
          humor,
          formality,
          curiosity,
          openness,
          preferred_tone,
          verbosity,
          personality_insights,
          detected_interests,
          conversation_themes,
          greeting_style,
          custom_insight
        ) VALUES (
          ${data.userId},
          ${data.analysisVersion ?? '1.0.0'},
          ${data.turnsAnalyzed},
          ${data.nextAnalysisThreshold ?? data.turnsAnalyzed + 50},
          ${data.warmth ?? null},
          ${data.energy ?? null},
          ${data.humor ?? null},
          ${data.formality ?? null},
          ${data.curiosity ?? null},
          ${data.openness ?? null},
          ${data.preferredTone ?? null},
          ${data.verbosity ?? null},
          ${data.personalityInsights ?? []},
          ${data.detectedInterests ?? []},
          ${data.conversationThemes ?? []},
          ${data.greetingStyle ?? 'friendly'},
          ${data.customInsight ?? null}
        )
        RETURNING *
      `;

      logger.info('personality_profile_created', { userId: data.userId });
      return this.mapProfile(result[0]);
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  /**
   * Update a profile
   */
  async update(
    userId: string,
    data: UserPersonalityProfileUpdate,
    tx?: TransactionContext
  ): Promise<UserPersonalityProfile> {
    const db = this.getSql(tx);
    try {
      const result = await db`
        UPDATE user_personality_profiles
        SET
          analysis_version = COALESCE(${data.analysisVersion ?? null}, analysis_version),
          turns_analyzed = COALESCE(${data.turnsAnalyzed ?? null}, turns_analyzed),
          next_analysis_threshold = COALESCE(${data.nextAnalysisThreshold ?? null}, next_analysis_threshold),
          last_analysis_at = NOW(),
          warmth = ${data.warmth !== undefined ? data.warmth : null},
          energy = ${data.energy !== undefined ? data.energy : null},
          humor = ${data.humor !== undefined ? data.humor : null},
          formality = ${data.formality !== undefined ? data.formality : null},
          curiosity = ${data.curiosity !== undefined ? data.curiosity : null},
          openness = ${data.openness !== undefined ? data.openness : null},
          preferred_tone = COALESCE(${data.preferredTone ?? null}, preferred_tone),
          verbosity = COALESCE(${data.verbosity ?? null}, verbosity),
          personality_insights = COALESCE(${data.personalityInsights ?? null}, personality_insights),
          detected_interests = COALESCE(${data.detectedInterests ?? null}, detected_interests),
          conversation_themes = COALESCE(${data.conversationThemes ?? null}, conversation_themes),
          greeting_style = COALESCE(${data.greetingStyle ?? null}, greeting_style),
          custom_insight = COALESCE(${data.customInsight ?? null}, custom_insight)
        WHERE user_id = ${userId}
        RETURNING *
      `;

      if (!result[0]) {
        throw new NotFoundError(`Personality profile for user ${userId} not found`);
      }

      logger.info('personality_profile_updated', { userId });
      return this.mapProfile(result[0]);
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw wrapDatabaseError(error);
    }
  }

  /**
   * Upsert a profile (create or update)
   */
  async upsert(
    userId: string,
    data: UserPersonalityProfileInsert,
    tx?: TransactionContext
  ): Promise<UserPersonalityProfile> {
    const db = this.getSql(tx);
    try {
      const result = await db`
        INSERT INTO user_personality_profiles (
          user_id,
          analysis_version,
          turns_analyzed,
          next_analysis_threshold,
          warmth,
          energy,
          humor,
          formality,
          curiosity,
          openness,
          preferred_tone,
          verbosity,
          personality_insights,
          detected_interests,
          conversation_themes,
          greeting_style,
          custom_insight
        ) VALUES (
          ${userId},
          ${data.analysisVersion ?? '1.0.0'},
          ${data.turnsAnalyzed},
          ${data.nextAnalysisThreshold ?? data.turnsAnalyzed + 50},
          ${data.warmth ?? null},
          ${data.energy ?? null},
          ${data.humor ?? null},
          ${data.formality ?? null},
          ${data.curiosity ?? null},
          ${data.openness ?? null},
          ${data.preferredTone ?? null},
          ${data.verbosity ?? null},
          ${data.personalityInsights ?? []},
          ${data.detectedInterests ?? []},
          ${data.conversationThemes ?? []},
          ${data.greetingStyle ?? 'friendly'},
          ${data.customInsight ?? null}
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
          analysis_version = ${data.analysisVersion ?? '1.0.0'},
          turns_analyzed = ${data.turnsAnalyzed},
          next_analysis_threshold = ${data.nextAnalysisThreshold ?? data.turnsAnalyzed + 50},
          last_analysis_at = NOW(),
          warmth = ${data.warmth ?? null},
          energy = ${data.energy ?? null},
          humor = ${data.humor ?? null},
          formality = ${data.formality ?? null},
          curiosity = ${data.curiosity ?? null},
          openness = ${data.openness ?? null},
          preferred_tone = ${data.preferredTone ?? null},
          verbosity = ${data.verbosity ?? null},
          personality_insights = ${data.personalityInsights ?? []},
          detected_interests = ${data.detectedInterests ?? []},
          conversation_themes = ${data.conversationThemes ?? []},
          greeting_style = ${data.greetingStyle ?? 'friendly'},
          custom_insight = ${data.customInsight ?? null}
        RETURNING *
      `;

      logger.info('personality_profile_upserted', { userId });
      return this.mapProfile(result[0]);
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  /**
   * Delete a profile
   */
  async delete(userId: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    try {
      await db`
        DELETE FROM user_personality_profiles
        WHERE user_id = ${userId}
      `;
      logger.info('personality_profile_deleted', { userId });
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  /**
   * List all profiles (admin)
   */
  async listAll(filters: ProfileListFilters = {}, tx?: TransactionContext): Promise<PaginatedResult<UserPersonalityProfile>> {
    const db = this.getSql(tx);
    const { limit = 50, offset = 0 } = filters;

    try {
      const result = await db`
        SELECT *
        FROM user_personality_profiles
        ORDER BY last_analysis_at DESC
        LIMIT ${limit + 1}
        OFFSET ${offset}
      `;

      const hasMore = result.length > limit;
      const data = result.slice(0, limit).map((row) => this.mapProfile(row));

      return {
        data,
        hasMore,
        limit,
        offset,
      };
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  /**
   * Get users who need personality analysis based on turn count
   */
  async getUsersNeedingAnalysis(tx?: TransactionContext): Promise<UserNeedingAnalysis[]> {
    const db = this.getSql(tx);
    try {
      // Get users whose total turn count exceeds their next_analysis_threshold
      // or who don't have a profile yet but have at least 50 turns
      const result = await db`
        WITH user_turn_counts AS (
          SELECT
            s.user_id,
            SUM(s.turn_count) as total_turns
          FROM sessions s
          WHERE s.status IN ('active', 'ended')
          GROUP BY s.user_id
        )
        SELECT
          utc.user_id,
          utc.total_turns,
          COALESCE(upp.next_analysis_threshold, 50) as current_threshold
        FROM user_turn_counts utc
        LEFT JOIN user_personality_profiles upp ON utc.user_id = upp.user_id
        WHERE utc.total_turns >= COALESCE(upp.next_analysis_threshold, 50)
        ORDER BY utc.total_turns DESC
        LIMIT 100
      `;

      return result.map((row) => ({
        userId: row.user_id as string,
        totalTurns: Number(row.total_turns),
        currentThreshold: Number(row.current_threshold),
      }));
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }
}

// Singleton instance
let personalityProfilesRepository: PersonalityProfilesRepository | null = null;

export function getPersonalityProfilesRepository(): PersonalityProfilesRepository {
  if (!personalityProfilesRepository) {
    personalityProfilesRepository = new PersonalityProfilesRepository();
  }
  return personalityProfilesRepository;
}
