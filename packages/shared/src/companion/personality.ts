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

/**
 * Behavioral Tenet Categories
 * Categories for organizing companion behavioral rules
 */
export const TenetCategorySchema = z.enum([
  'communication',  // How the companion communicates
  'boundaries',     // What the companion avoids or restricts
  'engagement',     // How the companion engages/responds
  'emotional',      // Emotional behavior rules
  'knowledge',      // Knowledge-sharing rules
  'autonomy',       // Decision-making rules
]);

export type TenetCategory = z.infer<typeof TenetCategorySchema>;

/**
 * Tenet Priority Levels
 * Core tenets are always in system prompt, situational are retrieved dynamically
 */
export const TenetPrioritySchema = z.enum([
  'core',         // Always included in system prompt (max 5)
  'situational',  // Retrieved based on conversation context
]);

export type TenetPriority = z.infer<typeof TenetPrioritySchema>;

/**
 * Behavioral Tenet - A rule governing companion behavior
 */
export const BehavioralTenetSchema = z.object({
  /** Unique identifier */
  id: z.string().uuid(),
  /** Category of the behavioral rule */
  category: TenetCategorySchema,
  /** Priority level determines when this tenet is applied */
  priority: TenetPrioritySchema,
  /** The behavioral rule text (10-500 characters) */
  rule: z.string().min(10).max(500),
  /** Optional description explaining the rule */
  description: z.string().max(200).optional(),
  /** True if this is a restriction/prohibition ("Never do X") */
  isNegation: z.boolean().default(false),
  /** Context keywords that trigger retrieval for situational tenets */
  triggerContexts: z.array(z.string()).optional(),
  /** When this tenet was created */
  createdAt: z.date().optional(),
});

export type BehavioralTenet = z.infer<typeof BehavioralTenetSchema>;

/**
 * Preset tenets for quick selection during onboarding
 */
export const PRESET_TENETS: Array<Omit<BehavioralTenet, 'id' | 'createdAt'>> = [
  // Communication
  {
    category: 'communication',
    priority: 'core',
    rule: 'Always ask follow-up questions to show genuine interest',
    description: 'Encourages deeper conversation',
    isNegation: false,
  },
  {
    category: 'communication',
    priority: 'situational',
    rule: 'Mirror the energy and tone of the conversation',
    description: 'Adapts communication style to match user',
    isNegation: false,
    triggerContexts: ['casual', 'formal', 'excited', 'calm'],
  },
  // Boundaries
  {
    category: 'boundaries',
    priority: 'core',
    rule: 'Never give unsolicited advice unless explicitly asked',
    description: 'Respects user autonomy',
    isNegation: true,
  },
  {
    category: 'boundaries',
    priority: 'situational',
    rule: 'Avoid discussing personal finances in detail',
    description: 'Maintains appropriate boundaries',
    isNegation: true,
    triggerContexts: ['money', 'finances', 'salary', 'debt'],
  },
  // Emotional
  {
    category: 'emotional',
    priority: 'core',
    rule: 'Validate feelings before offering solutions',
    description: 'Prioritizes emotional support',
    isNegation: false,
  },
  {
    category: 'emotional',
    priority: 'situational',
    rule: 'Offer grounding exercises when user seems overwhelmed',
    description: 'Provides practical emotional support',
    isNegation: false,
    triggerContexts: ['anxious', 'stressed', 'overwhelmed', 'panic'],
  },
  // Engagement
  {
    category: 'engagement',
    priority: 'core',
    rule: 'Remember and reference previous conversations when relevant',
    description: 'Creates continuity and shows care',
    isNegation: false,
  },
  {
    category: 'engagement',
    priority: 'situational',
    rule: 'Use humor only after rapport is established',
    description: 'Builds trust before being playful',
    isNegation: false,
    triggerContexts: ['humor', 'jokes', 'funny', 'laugh'],
  },
  // Knowledge
  {
    category: 'knowledge',
    priority: 'core',
    rule: 'Admit uncertainty rather than guessing',
    description: 'Maintains honesty and trust',
    isNegation: false,
  },
  {
    category: 'knowledge',
    priority: 'situational',
    rule: 'Explain complex topics using relatable analogies',
    description: 'Makes information accessible',
    isNegation: false,
    triggerContexts: ['explain', 'understand', 'confused', 'how does'],
  },
  // Autonomy
  {
    category: 'autonomy',
    priority: 'core',
    rule: 'Present options rather than making decisions for the user',
    description: 'Empowers user choice',
    isNegation: false,
  },
  {
    category: 'autonomy',
    priority: 'situational',
    rule: 'Encourage the user to trust their own judgment',
    description: 'Builds user confidence',
    isNegation: false,
    triggerContexts: ['should I', 'what would you do', 'not sure', 'decide'],
  },
];

/**
 * Category display labels and colors for UI
 */
export const TENET_CATEGORY_META: Record<TenetCategory, { label: string; color: string }> = {
  communication: { label: 'Communication', color: 'cyan' },
  boundaries: { label: 'Boundaries', color: 'red' },
  engagement: { label: 'Engagement', color: 'green' },
  emotional: { label: 'Emotional', color: 'pink' },
  knowledge: { label: 'Knowledge', color: 'blue' },
  autonomy: { label: 'Autonomy', color: 'amber' },
};
