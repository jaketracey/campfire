import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Tenet types (defined locally to avoid shared package issues with Next.js turbopack)
export type TenetCategory = 'communication' | 'boundaries' | 'engagement' | 'emotional' | 'knowledge' | 'autonomy';
export type TenetPriority = 'core' | 'situational';

export interface CompanionArchetype {
  id: string;
  name: string;
  description: string;
  traits: string[];
  icon: string;
}

/**
 * Personality sliders matching the shared schema (10 dimensions)
 */
export interface PersonalitySliders {
  warmth: number;        // Reserved (0) to Affectionate (100)
  energy: number;        // Calm (0) to Energetic (100)
  playfulness: number;   // Serious (0) to Playful (100)
  formality: number;     // Casual (0) to Formal (100)
  assertiveness: number; // Passive (0) to Assertive (100)
  curiosity: number;     // Incurious (0) to Curious (100)
  empathy: number;       // Analytical (0) to Empathetic (100)
  spontaneity: number;   // Structured (0) to Spontaneous (100)
  optimism: number;      // Realistic (0) to Optimistic (100)
  directness: number;    // Subtle (0) to Direct (100)
}

/**
 * Local tenet type for onboarding (before saving to DB)
 */
export interface OnboardingTenet {
  id: string;
  category: TenetCategory;
  priority: TenetPriority;
  rule: string;
  description?: string;
  isNegation: boolean;
  triggerContexts?: string[];
}

export interface VoiceOption {
  id: string;
  name: string;
  description: string;
  sampleUrl: string;
  gender: 'masculine' | 'feminine' | 'neutral';
}

export type AppearanceEthnicity =
  | 'east-asian'
  | 'south-asian'
  | 'black'
  | 'caucasian'
  | 'latina'
  | 'middle-eastern'
  | 'mixed';

export type AppearanceBodyType = 'slim' | 'athletic' | 'curvy' | 'plus-size';

export type AppearanceHairColor = 'black' | 'brown' | 'blonde' | 'red' | 'fantasy';

export interface PhysicalAppearance {
  ethnicity: AppearanceEthnicity;
  bodyType: AppearanceBodyType;
  hairColor: AppearanceHairColor;
  breastSize: number; // 0 to 100
}

export interface VisualStyle {
  avatarStyle: 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';
  appearance: PhysicalAppearance;
  colorTheme: string;
  animationLevel: 'minimal' | 'moderate' | 'expressive';
}

export interface Boundaries {
  safeTopics: string[];
  avoidTopics: string[];
  interactionStyle: 'formal' | 'casual' | 'adaptive';
  emotionalDepth: 'surface' | 'moderate' | 'deep';
  consentToMemory: boolean;
  consentToLearning: boolean;
}

export interface OnboardingState {
  currentStep: number;
  archetype: CompanionArchetype | null;
  secondaryArchetype: CompanionArchetype | null;
  personality: PersonalitySliders;
  tenets: OnboardingTenet[];
  name: string;
  identity: {
    pronouns: string;
    backstory: string;
  };
  voice: VoiceOption | null;
  visualStyle: VisualStyle;
  boundaries: Boundaries;

  // Actions
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setArchetype: (archetype: CompanionArchetype) => void;
  setSecondaryArchetype: (archetype: CompanionArchetype | null) => void;
  setPersonality: (personality: Partial<PersonalitySliders>) => void;
  addTenet: (tenet: OnboardingTenet) => void;
  removeTenet: (id: string) => void;
  updateTenet: (id: string, updates: Partial<OnboardingTenet>) => void;
  setName: (name: string) => void;
  setIdentity: (identity: { pronouns: string; backstory: string }) => void;
  setVoice: (voice: VoiceOption) => void;
  setVisualStyle: (style: Partial<VisualStyle>) => void;
  setAppearance: (appearance: Partial<PhysicalAppearance>) => void;
  setBoundaries: (boundaries: Partial<Boundaries>) => void;
  reset: () => void;
}

const initialPersonality: PersonalitySliders = {
  warmth: 60,
  energy: 50,
  playfulness: 50,
  formality: 40,
  assertiveness: 50,
  curiosity: 60,
  empathy: 70,
  spontaneity: 50,
  optimism: 60,
  directness: 50,
};

const initialAppearance: PhysicalAppearance = {
  ethnicity: 'mixed',
  bodyType: 'athletic',
  hairColor: 'brown',
  breastSize: 50,
};

const initialVisualStyle: VisualStyle = {
  avatarStyle: 'stylized',
  appearance: initialAppearance,
  colorTheme: 'campfire',
  animationLevel: 'moderate',
};

const initialBoundaries: Boundaries = {
  safeTopics: [],
  avoidTopics: [],
  interactionStyle: 'adaptive',
  emotionalDepth: 'moderate',
  consentToMemory: true,
  consentToLearning: true,
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      currentStep: 1,
      archetype: null,
      secondaryArchetype: null,
      personality: initialPersonality,
      tenets: [],
      name: '',
      identity: {
        pronouns: '',
        backstory: '',
      },
      voice: null,
      visualStyle: initialVisualStyle,
      boundaries: initialBoundaries,

      setStep: (step) => set({ currentStep: step }),
      nextStep: () => set((state) => ({ currentStep: Math.min(state.currentStep + 1, 9) })),
      prevStep: () => set((state) => ({ currentStep: Math.max(state.currentStep - 1, 1) })),

      setArchetype: (archetype) => set({ archetype }),
      setSecondaryArchetype: (archetype) => set({ secondaryArchetype: archetype }),
      setPersonality: (personality) =>
        set((state) => ({
          personality: { ...state.personality, ...personality },
        })),

      addTenet: (tenet) =>
        set((state) => ({
          tenets: [...state.tenets, tenet],
        })),

      removeTenet: (id) =>
        set((state) => ({
          tenets: state.tenets.filter((t) => t.id !== id),
        })),

      updateTenet: (id, updates) =>
        set((state) => ({
          tenets: state.tenets.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),

      setName: (name) => set({ name }),
      setIdentity: (identity) => set({ identity }),
      setVoice: (voice) => set({ voice }),
      setVisualStyle: (style) =>
        set((state) => ({
          visualStyle: { ...state.visualStyle, ...style },
        })),
      setAppearance: (appearance) =>
        set((state) => ({
          visualStyle: {
            ...state.visualStyle,
            appearance: { ...state.visualStyle.appearance, ...appearance },
          },
        })),
      setBoundaries: (boundaries) =>
        set((state) => ({
          boundaries: { ...state.boundaries, ...boundaries },
        })),
      reset: () =>
        set({
          currentStep: 1,
          archetype: null,
          secondaryArchetype: null,
          personality: initialPersonality,
          tenets: [],
          name: '',
          identity: {
            pronouns: '',
            backstory: '',
          },
          voice: null,
          visualStyle: { ...initialVisualStyle, appearance: { ...initialAppearance } },
          boundaries: initialBoundaries,
        }),
    }),
    {
      name: 'campfire-onboarding',
    }
  )
);
