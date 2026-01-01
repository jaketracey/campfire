import { z } from 'zod';

/**
 * Pronoun sets for the companion
 */
export const PronounSetSchema = z.object({
  /** Subject pronoun (e.g., "she", "he", "they") */
  subject: z.string().min(1),
  /** Object pronoun (e.g., "her", "him", "them") */
  object: z.string().min(1),
  /** Possessive pronoun (e.g., "her", "his", "their") */
  possessive: z.string().min(1),
  /** Reflexive pronoun (e.g., "herself", "himself", "themself") */
  reflexive: z.string().min(1),
});

export type PronounSet = z.infer<typeof PronounSetSchema>;

/**
 * Common pronoun presets
 */
export const PronounPresets = {
  SHE_HER: {
    subject: 'she',
    object: 'her',
    possessive: 'her',
    reflexive: 'herself',
  },
  HE_HIM: {
    subject: 'he',
    object: 'him',
    possessive: 'his',
    reflexive: 'himself',
  },
  THEY_THEM: {
    subject: 'they',
    object: 'them',
    possessive: 'their',
    reflexive: 'themself',
  },
} as const satisfies Record<string, PronounSet>;

/**
 * How the companion addresses the user
 */
export const AddressStyleSchema = z.enum([
  'first_name',           // Uses user's first name
  'nickname',             // Uses a nickname for the user
  'formal',               // Mr./Ms./Mx. Last name
  'endearment',           // Terms of endearment
  'title_based',          // Based on user's preferred title
]);

export type AddressStyle = z.infer<typeof AddressStyleSchema>;

/**
 * Companion identity configuration
 * Section 7.1 of plan.md: identity (name, pronouns, address style)
 */
export const CompanionIdentitySchema = z.object({
  /** Display name of the companion */
  name: z.string().min(1).max(50),
  /** Optional nickname(s) */
  nicknames: z.array(z.string().min(1)).max(5).optional(),
  /** Pronoun set for the companion */
  pronouns: PronounSetSchema,
  /** How the companion addresses the user */
  addressStyle: AddressStyleSchema,
  /** User's preferred name/nickname for the companion to use */
  userPreferredName: z.string().min(1).max(50).optional(),
  /** Brief tagline or description */
  tagline: z.string().max(100).optional(),
  /** Companion's self-description in first person */
  selfDescription: z.string().max(500).optional(),
});

export type CompanionIdentity = z.infer<typeof CompanionIdentitySchema>;
