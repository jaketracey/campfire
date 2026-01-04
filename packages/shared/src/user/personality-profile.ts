import { z } from 'zod';

/**
 * User Personality Profile
 *
 * Generated from analyzing user chat history to provide personalized experiences.
 */

/**
 * Greeting style for welcome messages
 */
export const GreetingStyleSchema = z.enum(['warm', 'playful', 'formal', 'friendly']);
export type GreetingStyle = z.infer<typeof GreetingStyleSchema>;

/**
 * Preferred communication tone detected from chats
 */
export const PreferredToneSchema = z.enum(['casual', 'formal', 'playful', 'direct']);
export type PreferredTone = z.infer<typeof PreferredToneSchema>;

/**
 * Verbosity level - how detailed the user tends to be
 */
export const VerbosityLevelSchema = z.enum(['concise', 'moderate', 'detailed']);
export type VerbosityLevel = z.infer<typeof VerbosityLevelSchema>;

/**
 * Personality trait value (0-100 scale)
 */
export const PersonalityTraitValueSchema = z.number().int().min(0).max(100).nullable();
export type PersonalityTraitValue = z.infer<typeof PersonalityTraitValueSchema>;

/**
 * User personality traits (detected from chat analysis)
 */
export const UserPersonalityTraitsSchema = z.object({
  /** Warmth: Reserved (0) to Affectionate (100) */
  warmth: PersonalityTraitValueSchema.optional(),
  /** Energy: Calm (0) to Energetic (100) */
  energy: PersonalityTraitValueSchema.optional(),
  /** Humor: Serious (0) to Playful (100) */
  humor: PersonalityTraitValueSchema.optional(),
  /** Formality: Casual (0) to Formal (100) */
  formality: PersonalityTraitValueSchema.optional(),
  /** Curiosity: Practical (0) to Inquisitive (100) */
  curiosity: PersonalityTraitValueSchema.optional(),
  /** Openness: Private (0) to Open (100) */
  openness: PersonalityTraitValueSchema.optional(),
});

export type UserPersonalityTraits = z.infer<typeof UserPersonalityTraitsSchema>;

/**
 * Complete user personality profile
 */
export const UserPersonalityProfileSchema = z.object({
  /** Profile ID */
  id: z.string().uuid(),
  /** User ID this profile belongs to */
  userId: z.string().uuid(),

  /** Analysis metadata */
  analysisVersion: z.string(),
  turnsAnalyzed: z.number().int().min(0),
  lastAnalysisAt: z.string().datetime(),
  nextAnalysisThreshold: z.number().int().min(0),

  /** Personality traits (0-100 scale) */
  traits: UserPersonalityTraitsSchema,

  /** Communication style */
  preferredTone: PreferredToneSchema.nullable(),
  verbosity: VerbosityLevelSchema.nullable(),

  /** Insights and interests */
  personalityInsights: z.array(z.string()),
  detectedInterests: z.array(z.string()),
  conversationThemes: z.array(z.string()),

  /** Welcome message customization */
  greetingStyle: GreetingStyleSchema,
  customInsight: z.string().nullable(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type UserPersonalityProfile = z.infer<typeof UserPersonalityProfileSchema>;

/**
 * Request for personality analysis
 */
export const AnalyzePersonalityRequestSchema = z.object({
  userId: z.string().uuid(),
  turns: z.array(
    z.object({
      userMessage: z.string(),
      agentMessage: z.string().optional(),
      timestamp: z.string().datetime().optional(),
    })
  ),
  existingProfile: UserPersonalityProfileSchema.partial().optional(),
});

export type AnalyzePersonalityRequest = z.infer<typeof AnalyzePersonalityRequestSchema>;

/**
 * Response from personality analysis
 */
export const AnalyzePersonalityResponseSchema = z.object({
  traits: UserPersonalityTraitsSchema,
  preferredTone: PreferredToneSchema,
  verbosity: VerbosityLevelSchema,
  personalityInsights: z.array(z.string()),
  detectedInterests: z.array(z.string()),
  conversationThemes: z.array(z.string()),
  greetingStyle: GreetingStyleSchema,
  customInsight: z.string(),
  latencyMs: z.number(),
});

export type AnalyzePersonalityResponse = z.infer<typeof AnalyzePersonalityResponseSchema>;

/**
 * Default welcome messages when no profile exists
 */
export const DEFAULT_WELCOME_MESSAGES: ((name: string) => string)[] = [
  (name) => `${name}, your companions have been thinking of you.`,
  (name) => `Ready to spark something new, ${name}?`,
  (name) => `${name}, the spark is waiting for you.`,
  (name) => `Let's pick up where we left off, ${name}.`,
  (name) => `${name}, your companions missed you.`,
  (name) => `Good to see you, ${name}.`,
];

/**
 * Get a random default welcome message
 */
export function getRandomDefaultWelcome(name: string): string {
  const index = Math.floor(Math.random() * DEFAULT_WELCOME_MESSAGES.length);
  const messageFn = DEFAULT_WELCOME_MESSAGES[index];
  return messageFn ? messageFn(name) : `Welcome back, ${name}.`;
}

/**
 * Greeting templates by style
 */
export const GREETING_TEMPLATES: Record<GreetingStyle, string[]> = {
  warm: [
    'So lovely to see you again, {name}.',
    '{name}, we missed you.',
    '{name}, your spark never fades.',
  ],
  playful: [
    '{name}, ready to have some fun?',
    'Look who\'s back! Things just got interesting.',
    '{name}! We\'ve been waiting for you.',
  ],
  formal: [
    'Good to see you, {name}.',
    '{name}, your companions await.',
    '{name}, we\'ve been expecting you.',
  ],
  friendly: [
    'Great to see you, {name}.',
    '{name}, glad you\'re back!',
    '{name}, your companions are ready.',
  ],
};

/**
 * Build a personalized welcome message
 */
export function buildPersonalizedWelcome(
  name: string,
  profile: UserPersonalityProfile,
  companionName?: string
): string {
  const templates = GREETING_TEMPLATES[profile.greetingStyle];
  const template = templates[Math.floor(Math.random() * templates.length)] ?? `Welcome back, {name}!`;
  let greeting = template.replace('{name}', name);

  // Add custom insight if available
  if (profile.customInsight) {
    greeting = `${greeting} ${profile.customInsight}`;
  }

  // Add companion awareness if provided
  if (companionName) {
    const companionMessages = [
      `${companionName} has been thinking of you.`,
      `${companionName} is excited to see you.`,
      `${companionName} remembers where you left off.`,
    ];
    const companionMsg = companionMessages[Math.floor(Math.random() * companionMessages.length)];
    greeting = `${greeting} ${companionMsg}`;
  }

  return greeting;
}
