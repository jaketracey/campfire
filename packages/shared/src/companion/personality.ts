import { z } from 'zod';

/**
 * Personality archetypes
 */
export const PersonalityArchetypeSchema = z.enum([
  'caregiver',        // Nurturing, supportive, empathetic
  'sage',             // Wise, thoughtful, philosophical
  'explorer',         // Curious, adventurous, open-minded
  'creator',          // Imaginative, expressive, artistic
  'hero',             // Brave, determined, protective
  'jester',           // Playful, humorous, lighthearted
  'lover',            // Passionate, intimate, devoted
  'magician',         // Transformative, visionary, inspiring
  'ruler',            // Confident, authoritative, organized
  'everyperson',      // Relatable, down-to-earth, friendly
  'innocent',         // Optimistic, pure, hopeful
  'rebel',            // Unconventional, bold, independent
]);

export type PersonalityArchetype = z.infer<typeof PersonalityArchetypeSchema>;

/**
 * Personality slider value (0-100)
 * 0 = minimum, 50 = balanced, 100 = maximum
 */
export const PersonalitySliderSchema = z.number().int().min(0).max(100);
export type PersonalitySlider = z.infer<typeof PersonalitySliderSchema>;

/**
 * Personality slider configuration
 * These are the adjustable traits on top of the base archetype
 */
export const PersonalitySlidersSchema = z.object({
  /** Warmth: Reserved (0) to Affectionate (100) */
  warmth: PersonalitySliderSchema,
  /** Energy: Calm (0) to Energetic (100) */
  energy: PersonalitySliderSchema,
  /** Humor: Serious (0) to Playful (100) */
  humor: PersonalitySliderSchema,
  /** Formality: Casual (0) to Formal (100) */
  formality: PersonalitySliderSchema,
  /** Assertiveness: Passive (0) to Assertive (100) */
  assertiveness: PersonalitySliderSchema,
  /** Openness: Private (0) to Open (100) */
  openness: PersonalitySliderSchema,
  /** Empathy: Analytical (0) to Empathetic (100) */
  empathy: PersonalitySliderSchema,
  /** Spontaneity: Structured (0) to Spontaneous (100) */
  spontaneity: PersonalitySliderSchema,
  /** Optimism: Realistic (0) to Optimistic (100) */
  optimism: PersonalitySliderSchema,
  /** Directness: Subtle (0) to Direct (100) */
  directness: PersonalitySliderSchema,
});

export type PersonalitySliders = z.infer<typeof PersonalitySlidersSchema>;

/**
 * Default slider values for balanced personality
 */
export const DEFAULT_PERSONALITY_SLIDERS: PersonalitySliders = {
  warmth: 60,
  energy: 50,
  humor: 50,
  formality: 40,
  assertiveness: 50,
  openness: 60,
  empathy: 70,
  spontaneity: 50,
  optimism: 60,
  directness: 50,
};

/**
 * Communication style preferences
 */
export const CommunicationStyleSchema = z.object({
  /** Preferred message length */
  messageLength: z.enum(['concise', 'moderate', 'detailed']),
  /** Use of emojis */
  emojiUsage: z.enum(['none', 'minimal', 'moderate', 'frequent']),
  /** Use of exclamations */
  exclamationUsage: z.enum(['none', 'minimal', 'moderate', 'frequent']),
  /** Vocabulary level */
  vocabularyLevel: z.enum(['simple', 'moderate', 'sophisticated']),
  /** Use of questions to engage */
  questionFrequency: z.enum(['rare', 'occasional', 'frequent']),
});

export type CommunicationStyle = z.infer<typeof CommunicationStyleSchema>;

/**
 * Interests and topics the companion is knowledgeable/enthusiastic about
 */
export const CompanionInterestsSchema = z.object({
  /** Primary interests (up to 5) */
  primary: z.array(z.string().min(1)).min(1).max(5),
  /** Secondary interests (up to 10) */
  secondary: z.array(z.string().min(1)).max(10).optional(),
  /** Topics to avoid */
  avoid: z.array(z.string().min(1)).max(10).optional(),
});

export type CompanionInterests = z.infer<typeof CompanionInterestsSchema>;

/**
 * Complete personality configuration
 * Section 7.1 of plan.md: personality (archetype + slider values)
 */
export const CompanionPersonalitySchema = z.object({
  /** Base personality archetype */
  archetype: PersonalityArchetypeSchema,
  /** Secondary archetype for blending (optional) */
  secondaryArchetype: PersonalityArchetypeSchema.optional(),
  /** Personality trait sliders */
  sliders: PersonalitySlidersSchema,
  /** Communication style preferences */
  communicationStyle: CommunicationStyleSchema,
  /** Interests and topics */
  interests: CompanionInterestsSchema,
  /** Custom personality notes for prompt engineering */
  customNotes: z.string().max(1000).optional(),
});

export type CompanionPersonality = z.infer<typeof CompanionPersonalitySchema>;
