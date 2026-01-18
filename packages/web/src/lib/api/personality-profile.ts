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
 * Returns null if the user doesn't have a profile yet (expected for new users)
 */
export async function getPersonalityProfile(userId: string): Promise<UserPersonalityProfile | null> {
  return get<UserPersonalityProfile | null>(`/users/${userId}/personality-profile`);
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
  'Welcome back. Your companions are waiting.',
  'Good to see you. The fire burns bright tonight.',
  'Your sanctuary awaits.',
  'What stories shall we share today?',
  'The campfire glows for you.',
  'Step into the warmth. Your companions remember you.',
];

/**
 * Get a random default welcome message
 */
export function getRandomDefaultWelcome(_name?: string): string {
  const index = Math.floor(Math.random() * DEFAULT_WELCOME_MESSAGES.length);
  return DEFAULT_WELCOME_MESSAGES[index];
}

/**
 * Greeting templates by style (name is now shown in the header)
 */
const GREETING_TEMPLATES: Record<string, string[]> = {
  warm: [
    'So lovely to see you again.',
    'Welcome back, we\'ve missed you.',
    'It warms our hearts to see you.',
  ],
  playful: [
    'Ready for some fun?',
    'Look who\'s back!',
    'The party can start now!',
  ],
  formal: [
    'Good evening. Welcome back.',
    'Your session awaits.',
    'We\'ve been expecting you.',
  ],
  friendly: [
    'Great to see you!',
    'Welcome back!',
    'Glad you\'re here!',
  ],
};

/**
 * Build a personalized welcome message
 */
export function buildPersonalizedWelcome(
  _name: string,
  profile: UserPersonalityProfile,
  companionName?: string
): string {
  const templates = GREETING_TEMPLATES[profile.greetingStyle] || GREETING_TEMPLATES.friendly;
  let greeting = templates[Math.floor(Math.random() * templates.length)];

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
