/**
 * Tests for emotional state gateway endpoints.
 *
 * These are schema/contract tests verifying the route definitions
 * and request/response shapes. Full integration tests require
 * a running database.
 */

import { describe, it, expect } from 'vitest';
import {
  EmotionalStateSchema,
  PrimaryEmotionSchema,
  EmotionalDimensionSchema,
  EmotionalTransitionTypeSchema,
} from '@campfire/shared/companion/emotional-state.js';

describe('EmotionalState shared types', () => {
  it('validates a complete emotional state', () => {
    const state = {
      companionId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000002',
      primaryEmotion: 'joy',
      secondaryEmotion: 'trust',
      valence: 0.6,
      arousal: 0.3,
      dominance: 0.0,
      intensity: 0.7,
      stability: 0.8,
      triggers: ['user shared good news'],
      moodDescription: 'feeling happy and content',
      transitionHistory: [
        {
          from: 'trust',
          to: 'joy',
          from_v: 0.2,
          to_v: 0.6,
          trigger: 'user shared good news',
          type: 'conversation',
          ts: '2026-03-26T12:00:00.000Z',
        },
      ],
    };

    const result = EmotionalStateSchema.safeParse(state);
    expect(result.success).toBe(true);
  });

  it('rejects invalid primary emotion', () => {
    const result = PrimaryEmotionSchema.safeParse('love');
    expect(result.success).toBe(false);
  });

  it('validates all primary emotions', () => {
    const emotions = [
      'joy', 'sadness', 'anger', 'fear',
      'surprise', 'disgust', 'trust', 'anticipation',
    ];
    for (const e of emotions) {
      expect(PrimaryEmotionSchema.safeParse(e).success).toBe(true);
    }
  });

  it('rejects out-of-range dimension values', () => {
    const tooHigh = EmotionalDimensionSchema.safeParse({
      valence: 1.5, arousal: 0, dominance: 0,
    });
    expect(tooHigh.success).toBe(false);

    const tooLow = EmotionalDimensionSchema.safeParse({
      valence: 0, arousal: -1.5, dominance: 0,
    });
    expect(tooLow.success).toBe(false);
  });

  it('validates transition types', () => {
    expect(EmotionalTransitionTypeSchema.safeParse('conversation').success).toBe(true);
    expect(EmotionalTransitionTypeSchema.safeParse('time_decay').success).toBe(true);
    expect(EmotionalTransitionTypeSchema.safeParse('event').success).toBe(true);
    expect(EmotionalTransitionTypeSchema.safeParse('reset').success).toBe(true);
    expect(EmotionalTransitionTypeSchema.safeParse('invalid').success).toBe(false);
  });

  it('accepts null secondary emotion', () => {
    const state = {
      companionId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000002',
      primaryEmotion: 'trust',
      secondaryEmotion: null,
      valence: 0.2,
      arousal: 0.0,
      dominance: 0.0,
      intensity: 0.5,
      stability: 0.7,
      triggers: [],
      moodDescription: 'feeling balanced',
    };

    const result = EmotionalStateSchema.safeParse(state);
    expect(result.success).toBe(true);
  });

  it('rejects intensity outside 0-1 range', () => {
    const state = {
      companionId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000002',
      primaryEmotion: 'trust',
      valence: 0.0,
      arousal: 0.0,
      dominance: 0.0,
      intensity: 1.5,
      stability: 0.5,
      triggers: [],
      moodDescription: 'test',
    };

    const result = EmotionalStateSchema.safeParse(state);
    expect(result.success).toBe(false);
  });
});
