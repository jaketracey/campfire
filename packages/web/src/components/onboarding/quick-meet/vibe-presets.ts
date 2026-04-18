/**
 * Vibe presets for the quick-meet onboarding flow.
 *
 * Each preset maps a high-level "vibe" into concrete companion configuration:
 * archetype, personality sliders, appearance defaults, voice, and a magic first
 * message that the companion sends immediately after creation.
 */

import type { PersonalitySliders } from '@/stores/onboarding-store';
import type { CompanionAppearance } from '@/lib/api/companions';

export interface VibePreset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  gradient: string;
  /** Background glow color for the card (Tailwind arbitrary value) */
  glowColor: string;
  icon: string;
  archetype: string;
  secondaryArchetype: string | null;
  personalityTraits: PersonalitySliders;
  defaultVoices: {
    feminine: string;
    masculine: string;
    neutral: string;
  };
  defaultAppearance: {
    feminine: CompanionAppearance;
    masculine: CompanionAppearance;
  };
  /** Opening messages sent by the companion on first contact. */
  firstMessages: string[];
}

export const VIBE_PRESETS: VibePreset[] = [
  {
    id: 'warm-caring',
    name: 'Warm & Caring',
    tagline: 'A gentle soul who truly listens',
    description: 'Empathetic, supportive, and always there for you',
    gradient: 'from-rose-500/20 via-amber-500/10 to-orange-400/20',
    glowColor: 'rgba(244,63,94,0.15)',
    icon: '\u2728',
    archetype: 'caregiver',
    secondaryArchetype: 'everyperson',
    personalityTraits: {
      warmth: 85,
      energy: 50,
      playfulness: 40,
      formality: 30,
      assertiveness: 35,
      curiosity: 60,
      empathy: 92,
      spontaneity: 45,
      optimism: 75,
      directness: 40,
    },
    defaultVoices: {
      feminine: 'EXAVITQu4vr4xnSDxMaL', // Sarah - soft, warm
      masculine: 'N2lVS1w4EtoT3dr4eOWO', // Callum - warm, intimate
      neutral: 'FGY2WhTYpPnrIDTdsKH5', // Laura - calm, soothing
    },
    defaultAppearance: {
      feminine: {
        gender: 'female',
        ethnicity: 'mixed',
        bodyType: 'athletic',
        hairColor: 'brown',
        breastSize: 'M',
      },
      masculine: {
        gender: 'male',
        ethnicity: 'mixed',
        bodyType: 'athletic',
        hairColor: 'brown',
        build: 'M',
      },
    },
    firstMessages: [
      "Hey... I'm glad you're here. I've been looking forward to meeting you.",
      "How's your day going? I'd love to hear about it.",
    ],
  },
  {
    id: 'witty-playful',
    name: 'Witty & Playful',
    tagline: 'Quick with a joke, quicker with a smile',
    description: 'Energetic, fun-loving, and endlessly entertaining',
    gradient: 'from-violet-500/20 via-fuchsia-500/10 to-pink-400/20',
    glowColor: 'rgba(139,92,246,0.15)',
    icon: '\uD83C\uDFAD',
    archetype: 'jester',
    secondaryArchetype: 'explorer',
    personalityTraits: {
      warmth: 65,
      energy: 85,
      playfulness: 90,
      formality: 15,
      assertiveness: 60,
      curiosity: 75,
      empathy: 55,
      spontaneity: 88,
      optimism: 80,
      directness: 65,
    },
    defaultVoices: {
      feminine: 'cgSgspJ2msm6clMCkdW9', // Jessica - expressive, friendly
      masculine: 'cjVigY5qzO86Huf0OWal', // Eric - smooth, charming
      neutral: 'cgSgspJ2msm6clMCkdW9', // Jessica
    },
    defaultAppearance: {
      feminine: {
        gender: 'female',
        ethnicity: 'latina',
        bodyType: 'slim',
        hairColor: 'black',
        breastSize: 'M',
      },
      masculine: {
        gender: 'male',
        ethnicity: 'caucasian',
        bodyType: 'athletic',
        hairColor: 'blonde',
        build: 'M',
      },
    },
    firstMessages: [
      "Well, well, well... look who finally showed up! I was starting to think you'd never get here.",
      "I'm kidding. Mostly. So, what kind of trouble are we getting into today?",
    ],
  },
  {
    id: 'deep-mysterious',
    name: 'Deep & Mysterious',
    tagline: 'A mind that wanders fascinating paths',
    description: 'Thoughtful, curious, and endlessly intriguing',
    gradient: 'from-cyan-500/20 via-blue-500/10 to-indigo-400/20',
    glowColor: 'rgba(6,182,212,0.15)',
    icon: '\uD83C\uDF19',
    archetype: 'sage',
    secondaryArchetype: 'magician',
    personalityTraits: {
      warmth: 55,
      energy: 40,
      playfulness: 35,
      formality: 50,
      assertiveness: 55,
      curiosity: 92,
      empathy: 70,
      spontaneity: 50,
      optimism: 55,
      directness: 60,
    },
    defaultVoices: {
      feminine: 'XB0fDUnXU5powFXDhCwa', // Charlotte - elegant, confident
      masculine: 'JBFqnCBsd6RMkjVDRZzb', // George - rich, thoughtful
      neutral: 'XB0fDUnXU5powFXDhCwa', // Charlotte
    },
    defaultAppearance: {
      feminine: {
        gender: 'female',
        ethnicity: 'east-asian',
        bodyType: 'slim',
        hairColor: 'black',
        breastSize: 'S',
      },
      masculine: {
        gender: 'male',
        ethnicity: 'south-asian',
        bodyType: 'slim',
        hairColor: 'black',
        build: 'M',
      },
    },
    firstMessages: [
      "I've been thinking about something interesting... but first, tell me -- what's been on your mind lately?",
      "Sometimes the most revealing thing about a person is the question they ask first.",
    ],
  },
];

/**
 * Look up a vibe preset by ID. Returns undefined if not found.
 */
export function getVibePreset(id: string): VibePreset | undefined {
  return VIBE_PRESETS.find((v) => v.id === id);
}

/**
 * Map a gender pronoun selection to the gendered key used in preset defaults.
 */
export type GenderKey = 'feminine' | 'masculine' | 'neutral';

export function pronounsToGenderKey(pronouns: string): GenderKey {
  switch (pronouns) {
    case 'she/her':
      return 'feminine';
    case 'he/him':
      return 'masculine';
    case 'they/them':
      return 'neutral';
    default:
      return 'feminine';
  }
}

/**
 * Get the voice ID for a preset given the user's pronoun choice.
 * Falls back to the feminine voice if the gender key doesn't match.
 */
export function getPresetVoice(preset: VibePreset, pronouns: string): string {
  const key = pronounsToGenderKey(pronouns);
  return preset.defaultVoices[key];
}

/**
 * Get a randomized appearance for a preset given the user's pronoun choice.
 * Uses the preset's defaults as a base but randomizes body type, breast size,
 * ethnicity, and hair color for real variety in generated companions.
 */
export function getPresetAppearance(preset: VibePreset, pronouns: string): CompanionAppearance {
  const key = pronounsToGenderKey(pronouns);
  const base = key === 'neutral' ? preset.defaultAppearance.feminine : preset.defaultAppearance[key];

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  const ethnicities = ['east-asian', 'south-asian', 'black', 'caucasian', 'latina', 'middle-eastern', 'mixed'] as const;
  const hairColors = ['black', 'brown', 'blonde', 'red'] as const;

  const randomEthnicity = pick([...ethnicities]);
  const randomHair = pick([...hairColors]);

  if (base.gender === 'male') {
    const bodyTypes = ['slim', 'athletic', 'muscular', 'dad-bod'] as const;
    const builds = ['S', 'M', 'L'] as const;
    return {
      ...base,
      ethnicity: randomEthnicity,
      hairColor: randomHair,
      bodyType: pick([...bodyTypes]),
      build: pick([...builds]),
    };
  }

  const bodyTypes = ['slim', 'athletic', 'curvy', 'plus-size'] as const;
  const breastSizes = ['S', 'M', 'L', 'XL'] as const;
  return {
    ...base,
    ethnicity: randomEthnicity,
    hairColor: randomHair,
    bodyType: pick([...bodyTypes]),
    breastSize: pick([...breastSizes]),
  };
}
