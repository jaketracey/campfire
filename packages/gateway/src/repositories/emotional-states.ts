/**
 * Emotional States Repository
 * Data access for companion_emotional_states table.
 */

import { sql } from '../db/pool.js';
import type { TransactionContext } from './types.js';
import { validateUuid, wrapDatabaseError } from './errors.js';

export interface EmotionalStateRow {
  id: string;
  companion_id: string;
  user_id: string;
  primary_emotion: string;
  secondary_emotion: string | null;
  valence: number;
  arousal: number;
  dominance: number;
  intensity: number;
  stability: number;
  triggers: string[];
  mood_description: string;
  transition_history: Record<string, unknown>[];
  updated_at: Date;
  created_at: Date;
}

export interface EmotionalStateUpsert {
  companionId: string;
  userId: string;
  primaryEmotion: string;
  secondaryEmotion?: string | null;
  valence: number;
  arousal: number;
  dominance: number;
  intensity: number;
  stability: number;
  triggers: string[];
  moodDescription: string;
  transitionHistory: Record<string, unknown>[];
}

export class EmotionalStatesRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  /**
   * Find emotional state by companion + user pair
   */
  async findByCompanionAndUser(
    companionId: string,
    userId: string,
    tx?: TransactionContext,
  ): Promise<EmotionalStateRow | null> {
    validateUuid(companionId, 'companionId');
    validateUuid(userId, 'userId');

    const db = this.getSql(tx);
    try {
      const rows = await db`
        SELECT * FROM companion_emotional_states
        WHERE companion_id = ${companionId}
          AND user_id = ${userId}
        LIMIT 1
      `;
      return (rows.length > 0 ? rows[0] : null) as EmotionalStateRow | null;
    } catch (err) {
      throw wrapDatabaseError(err);
    }
  }

  /**
   * Upsert emotional state for a companion-user pair
   */
  async upsert(data: EmotionalStateUpsert, tx?: TransactionContext): Promise<void> {
    validateUuid(data.companionId, 'companionId');
    validateUuid(data.userId, 'userId');

    const db = this.getSql(tx);
    try {
      await db`
        INSERT INTO companion_emotional_states (
          companion_id, user_id, primary_emotion, secondary_emotion,
          valence, arousal, dominance, intensity, stability,
          triggers, mood_description, transition_history, updated_at
        ) VALUES (
          ${data.companionId}, ${data.userId}, ${data.primaryEmotion},
          ${data.secondaryEmotion ?? null},
          ${data.valence}, ${data.arousal}, ${data.dominance},
          ${data.intensity}, ${data.stability},
          ${data.triggers}, ${data.moodDescription},
          ${JSON.stringify(data.transitionHistory)}::jsonb, NOW()
        )
        ON CONFLICT (companion_id, user_id) DO UPDATE SET
          primary_emotion = EXCLUDED.primary_emotion,
          secondary_emotion = EXCLUDED.secondary_emotion,
          valence = EXCLUDED.valence,
          arousal = EXCLUDED.arousal,
          dominance = EXCLUDED.dominance,
          intensity = EXCLUDED.intensity,
          stability = EXCLUDED.stability,
          triggers = EXCLUDED.triggers,
          mood_description = EXCLUDED.mood_description,
          transition_history = EXCLUDED.transition_history,
          updated_at = NOW()
      `;
    } catch (err) {
      throw wrapDatabaseError(err);
    }
  }
}

// Singleton
let instance: EmotionalStatesRepository | null = null;

export function getEmotionalStatesRepository(): EmotionalStatesRepository {
  if (!instance) {
    instance = new EmotionalStatesRepository();
  }
  return instance;
}
