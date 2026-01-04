/**
 * Personality Profile API
 * Endpoints for user personality profiles.
 */

import { get, post } from './client';

/**
 * Personality traits (0-100 scale)
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
 * User personality profile
 */
export interface UserPersonalityProfile {
  id: string;
  userId: string;
  analysisVersion: string;
  turnsAnalyzed: number;
  lastAnalysisAt: string;
  nextAnalysisThreshold: number;
  traits: PersonalityTraits;
  preferredTone: 'casual' | 'formal' | 'playful' | 'direct' | null;
  verbosity: 'concise' | 'moderate' | 'detailed' | null;
  personalityInsights: string[];
  detectedInterests: string[];
  conversationThemes: string[];
  greetingStyle: 'warm' | 'playful' | 'formal' | 'friendly';
  customInsight: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get user's personality profile
 */
export async function getPersonalityProfile(userId: string): Promise<UserPersonalityProfile | null> {
  try {
    return await get<UserPersonalityProfile>(`/users/${userId}/personality-profile`);
  } catch (error) {
    // Profile not found is expected for new users
    if ((error as { status?: number }).status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Refresh user's personality profile (trigger re-analysis)
 */
export async function refreshPersonalityProfile(userId: string): Promise<UserPersonalityProfile> {
  return post<UserPersonalityProfile>(`/users/${userId}/personality-profile/refresh`);
}

/**
 * Default welcome messages when no profile exists
 */
const DEFAULT_WELCOME_MESSAGES = [
  (name: string) => `Welcome back, ${name}. Your companions are waiting.`,
  (name: string) => `Good to see you, ${name}. The fire burns bright tonight.`,
  (name: string) => `${name}, your sanctuary awaits.`,
  (name: string) => `Welcome, ${name}. What stories shall we share today?`,
  (name: string) => `The campfire glows for you, ${name}.`,
  (name: string) => `${name}, step into the warmth. Your companions remember you.`,
];

/**
 * Get a random default welcome message
 */
export function getRandomDefaultWelcome(name: string): string {
  const index = Math.floor(Math.random() * DEFAULT_WELCOME_MESSAGES.length);
  return DEFAULT_WELCOME_MESSAGES[index](name);
}

/**
 * Greeting templates by style
 */
const GREETING_TEMPLATES: Record<string, string[]> = {
  warm: [
    'So lovely to see you again, {name}.',
    'Welcome back, dear {name}.',
    '{name}, it warms our hearts to see you.',
  ],
  playful: [
    'Hey there, {name}! Ready for some fun?',
    'Look who\'s back! Hey {name}!',
    '{name}! The party can start now!',
  ],
  formal: [
    'Good evening, {name}. Welcome back.',
    'Welcome, {name}. Your session awaits.',
    'Greetings, {name}. We\'ve been expecting you.',
  ],
  friendly: [
    'Hey {name}! Great to see you.',
    'Welcome back, {name}!',
    '{name}, glad you\'re here!',
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
  const templates = GREETING_TEMPLATES[profile.greetingStyle] || GREETING_TEMPLATES.friendly;
  const template = templates[Math.floor(Math.random() * templates.length)];
  let greeting = template.replace('{name}', name);

  // Add custom insight if available
  if (profile.customInsight) {
    greeting = `${greeting} ${profile.customInsight}`;
  }

  // Add companion awareness if provided
  if (companionName) {
    const companionMessages = [
      `${companionName} has been thinking of you.`,
      `${companionName} is eager to continue your conversation.`,
      `${companionName} remembers where you left off.`,
    ];
    const companionMsg = companionMessages[Math.floor(Math.random() * companionMessages.length)];
    greeting = `${greeting} ${companionMsg}`;
  }

  return greeting;
}
