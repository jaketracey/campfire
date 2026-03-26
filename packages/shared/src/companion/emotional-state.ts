import { z } from 'zod';

/**
 * Primary emotions (Plutchik's model)
 */
export const PrimaryEmotionSchema = z.enum([
  'joy',
  'sadness',
  'anger',
  'fear',
  'surprise',
  'disgust',
  'trust',
  'anticipation',
]);

export type PrimaryEmotion = z.infer<typeof PrimaryEmotionSchema>;

/**
 * PAD (Pleasure-Arousal-Dominance) emotional dimensions.
 * Each dimension ranges from -1.0 to 1.0.
 */
export const EmotionalDimensionSchema = z.object({
  /** Negative (-1) to positive (+1). Sad to happy. */
  valence: z.number().min(-1).max(1),
  /** Calm (-1) to excited (+1). */
  arousal: z.number().min(-1).max(1),
  /** Submissive (-1) to dominant (+1). */
  dominance: z.number().min(-1).max(1),
});

export type EmotionalDimension = z.infer<typeof EmotionalDimensionSchema>;

/**
 * Transition type for emotional state changes.
 */
export const EmotionalTransitionTypeSchema = z.enum([
  'conversation',
  'time_decay',
  'event',
  'reset',
]);

export type EmotionalTransitionType = z.infer<typeof EmotionalTransitionTypeSchema>;

/**
 * A single entry in the transition history.
 */
export const EmotionalTransitionEntrySchema = z.object({
  from: PrimaryEmotionSchema,
  to: PrimaryEmotionSchema,
  from_v: z.number(),
  to_v: z.number(),
  trigger: z.string(),
  type: EmotionalTransitionTypeSchema,
  ts: z.string(), // ISO timestamp
});

export type EmotionalTransitionEntry = z.infer<typeof EmotionalTransitionEntrySchema>;

/**
 * Persistent emotional state for a companion-user pair.
 */
export const EmotionalStateSchema = z.object({
  companionId: z.string().uuid(),
  userId: z.string().uuid(),
  primaryEmotion: PrimaryEmotionSchema,
  secondaryEmotion: PrimaryEmotionSchema.nullable().optional(),
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(-1).max(1),
  dominance: z.number().min(-1).max(1),
  intensity: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  triggers: z.array(z.string()),
  moodDescription: z.string(),
  transitionHistory: z.array(EmotionalTransitionEntrySchema).default([]),
  updatedAt: z.string().optional(), // ISO timestamp
});

export type EmotionalState = z.infer<typeof EmotionalStateSchema>;
