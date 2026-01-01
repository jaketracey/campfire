import { z } from 'zod';

/**
 * Voice provider
 */
export const VoiceProviderSchema = z.enum([
  'elevenlabs',
  'openai',
  'azure',
  'google',
  'aws_polly',
  'custom',
]);

export type VoiceProvider = z.infer<typeof VoiceProviderSchema>;

/**
 * Voice gender classification
 */
export const VoiceGenderSchema = z.enum(['feminine', 'masculine', 'androgynous']);
export type VoiceGender = z.infer<typeof VoiceGenderSchema>;

/**
 * Voice age classification
 */
export const VoiceAgeSchema = z.enum(['young', 'adult', 'mature', 'elderly']);
export type VoiceAge = z.infer<typeof VoiceAgeSchema>;

/**
 * Voice tuning parameters
 */
export const VoiceTuningSchema = z.object({
  /** Speaking rate (0.5-2.0, 1.0 is normal) */
  rate: z.number().min(0.5).max(2.0).default(1.0),
  /** Pitch adjustment (-1.0 to 1.0, 0 is normal) */
  pitch: z.number().min(-1).max(1).default(0),
  /** Volume level (0-1, 1 is max) */
  volume: z.number().min(0).max(1).default(1),
  /** Stability (ElevenLabs specific, 0-1) */
  stability: z.number().min(0).max(1).optional(),
  /** Similarity boost (ElevenLabs specific, 0-1) */
  similarityBoost: z.number().min(0).max(1).optional(),
  /** Style exaggeration (ElevenLabs specific, 0-1) */
  styleExaggeration: z.number().min(0).max(1).optional(),
  /** Use speaker boost (ElevenLabs specific) */
  useSpeakerBoost: z.boolean().optional(),
});

export type VoiceTuning = z.infer<typeof VoiceTuningSchema>;

/**
 * Voice characteristics metadata
 */
export const VoiceCharacteristicsSchema = z.object({
  /** Gender classification */
  gender: VoiceGenderSchema,
  /** Age classification */
  age: VoiceAgeSchema,
  /** Accent/dialect */
  accent: z.string().optional(),
  /** Language code (ISO 639-1) */
  language: z.string().length(2),
  /** Additional language codes supported */
  additionalLanguages: z.array(z.string().length(2)).optional(),
  /** Tone descriptors */
  toneDescriptors: z.array(z.string()).optional(),
});

export type VoiceCharacteristics = z.infer<typeof VoiceCharacteristicsSchema>;

/**
 * Complete voice profile configuration
 * Section 7.1 of plan.md: voice profile (provider voice id + tuning)
 */
export const CompanionVoiceProfileSchema = z.object({
  /** Unique voice profile ID */
  voiceProfileId: z.string().min(1),
  /** Voice provider */
  provider: VoiceProviderSchema,
  /** Provider-specific voice ID */
  providerVoiceId: z.string().min(1),
  /** Human-readable voice name */
  voiceName: z.string().min(1),
  /** Voice tuning parameters */
  tuning: VoiceTuningSchema,
  /** Voice characteristics */
  characteristics: VoiceCharacteristicsSchema,
  /** Preview audio URL */
  previewUrl: z.string().url().optional(),
  /** Whether this is a custom/cloned voice */
  isCustomVoice: z.boolean().default(false),
  /** Custom voice source ID (if cloned) */
  customVoiceSourceId: z.string().optional(),
});

export type CompanionVoiceProfile = z.infer<typeof CompanionVoiceProfileSchema>;
