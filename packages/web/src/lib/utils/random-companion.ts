/**
 * Random companion generation utilities
 * Used for generating random traits and appearance when switching companions
 */

import type { CompanionAppearance, FemaleAppearance, MaleAppearance, SizeCategory, AppearanceEthnicity, AppearanceHairColor, FemaleBodyType, MaleBodyType } from '@/lib/api/companions';

const ETHNICITIES: AppearanceEthnicity[] = [
  'east-asian',
  'south-asian',
  'black',
  'caucasian',
  'latina',
  'middle-eastern',
  'mixed',
];

const FEMALE_BODY_TYPES: FemaleBodyType[] = [
  'slim',
  'athletic',
  'curvy',
  'plus-size',
];

const MALE_BODY_TYPES: MaleBodyType[] = [
  'slim',
  'athletic',
  'muscular',
  'dad-bod',
];

const HAIR_COLORS: AppearanceHairColor[] = [
  'black',
  'brown',
  'blonde',
  'red',
  'fantasy',
];

const SIZE_CATEGORIES: SizeCategory[] = ['S', 'M', 'L'];

/**
 * Generate random personality traits (0-100 scale)
 */
export function randomTraits(): Record<string, number> {
  return {
    warmth: Math.floor(Math.random() * 101),
    energy: Math.floor(Math.random() * 101),
    playfulness: Math.floor(Math.random() * 101),
    formality: Math.floor(Math.random() * 101),
    assertiveness: Math.floor(Math.random() * 101),
    curiosity: Math.floor(Math.random() * 101),
    empathy: Math.floor(Math.random() * 101),
    spontaneity: Math.floor(Math.random() * 101),
    optimism: Math.floor(Math.random() * 101),
    directness: Math.floor(Math.random() * 101),
  };
}

/**
 * Pick a random element from an array
 */
function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate random physical appearance (gender-aware)
 */
export function randomAppearance(gender?: 'female' | 'male'): CompanionAppearance {
  const isMale = gender === 'male' || (gender === undefined && Math.random() > 0.5);

  if (isMale) {
    return {
      gender: 'male',
      ethnicity: pickRandom(ETHNICITIES),
      bodyType: pickRandom(MALE_BODY_TYPES),
      hairColor: pickRandom(HAIR_COLORS),
      build: pickRandom(SIZE_CATEGORIES),
    };
  } else {
    return {
      gender: 'female',
      ethnicity: pickRandom(ETHNICITIES),
      bodyType: pickRandom(FEMALE_BODY_TYPES),
      hairColor: pickRandom(HAIR_COLORS),
      breastSize: pickRandom(SIZE_CATEGORIES),
    };
  }
}
