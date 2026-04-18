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
  previewUrl?: string | null;
  accent?: string;
  age?: string;
  category?: string;
}

// ============================================================================
// Appearance Types
// ============================================================================

export type CompanionGender = 'female' | 'male';

export type AppearanceEthnicity =
  | 'east-asian'
  | 'south-asian'
  | 'black'
  | 'caucasian'
  | 'latina'
  | 'middle-eastern'
  | 'mixed';

export type FemaleBodyType = 'slim' | 'athletic' | 'curvy' | 'plus-size';
export type MaleBodyType = 'slim' | 'athletic' | 'muscular' | 'dad-bod';
export type AppearanceBodyType = FemaleBodyType | MaleBodyType;

export type AppearanceHairColor = 'black' | 'brown' | 'blonde' | 'red' | 'fantasy';

export type SizeCategory = 'S' | 'M' | 'L' | 'XL';

/**
 * Base appearance fields shared by both genders
 */
interface BasePhysicalAppearance {
  ethnicity: AppearanceEthnicity;
  hairColor: AppearanceHairColor;
}

/**
 * Female-specific appearance
 */
export interface FemalePhysicalAppearance extends BasePhysicalAppearance {
  gender: 'female';
  bodyType: FemaleBodyType;
  breastSize: SizeCategory;
}

/**
 * Male-specific appearance
 */
export interface MalePhysicalAppearance extends BasePhysicalAppearance {
  gender: 'male';
  bodyType: MaleBodyType;
  build: SizeCategory;
}

/**
 * Physical appearance - discriminated union based on gender
 */
export type PhysicalAppearance = FemalePhysicalAppearance | MalePhysicalAppearance;

// Type guards
export function isFemaleAppearance(appearance: PhysicalAppearance): appearance is FemalePhysicalAppearance {
  return appearance.gender === 'female';
}

export function isMaleAppearance(appearance: PhysicalAppearance): appearance is MalePhysicalAppearance {
  return appearance.gender === 'male';
}

/**
 * Visual style configuration
 * Note: avatarStyle removed - always photorealistic now
 */
export interface VisualStyle {
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

export interface AnchorImage {
  id: string;
  url: string;
  emotionalState: string;
  isIdentityAnchor: boolean;
}

/**
 * Lightweight character context from identity generation,
 * used to inform anchor image prompts without waiting for full backstory.
 */
export interface BackstoryContext {
  occupation?: string;
  distinctiveFeatures?: string[];
  dressStyle?: string;
  vibe?: string;
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
  backstoryContext: BackstoryContext | null;

  // Generation state (persists across steps)
  companionId: string | null;
  sessionId: string | null;
  generationStarted: boolean;

  // Anchor image state (for early generation during Surprise Me)
  anchorImages: AnchorImage[];
  anchorImagesComplete: boolean;
  anchorStreamStarted: boolean;

  // Quick start state (for stepper positioning)
  quickStartActive: boolean;
  quickStartStep: number; // 0-3 for Identity, Visuals, Archetype, Voice

  // Quick-meet flow state (conversational onboarding)
  quickMeetVibeId: string | null;

  // Readiness flags that represent onboarding progression explicitly.
  companionReady: boolean;
  companionActive: boolean;
  anchorReady: boolean;
  backstoryReady: boolean;

  // Change tracking for appearance modifications after Surprise Me
  appearanceChangedAfterGeneration: boolean;
  anchorAppearanceSnapshot: PhysicalAppearance | null;

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
  setTenets: (tenets: OnboardingTenet[]) => void;
  setName: (name: string) => void;
  setIdentity: (identity: { pronouns: string; backstory: string }) => void;
  setVoice: (voice: VoiceOption) => void;
  setVisualStyle: (style: Partial<VisualStyle>) => void;
  setAppearance: (appearance: Partial<PhysicalAppearance>) => void;
  setBoundaries: (boundaries: Partial<Boundaries>) => void;
  setCompanionId: (id: string | null) => void;
  setSessionId: (id: string | null) => void;
  setGenerationStarted: (started: boolean) => void;
  addAnchorImage: (anchor: AnchorImage) => void;
  clearAnchorImages: () => void;
  setAnchorImagesComplete: (complete: boolean) => void;
  setAnchorStreamStarted: (started: boolean) => void;
  setQuickStartActive: (active: boolean) => void;
  setQuickStartStep: (step: number) => void;
  setQuickMeetVibeId: (vibeId: string | null) => void;
  setCompanionReady: (ready: boolean) => void;
  setCompanionActive: (active: boolean) => void;
  setAnchorReady: (ready: boolean) => void;
  setBackstoryReady: (ready: boolean) => void;
  setAppearanceChangedAfterGeneration: (changed: boolean) => void;
  setAnchorAppearanceSnapshot: (appearance: PhysicalAppearance | null) => void;
  setBackstoryContext: (context: BackstoryContext | null) => void;
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

const initialAppearance: FemalePhysicalAppearance = {
  gender: 'female',
  ethnicity: 'mixed',
  bodyType: 'athletic',
  hairColor: 'brown',
  breastSize: 'M',
};

const initialVisualStyle: VisualStyle = {
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
      companionId: null,
      sessionId: null,
      generationStarted: false,
      anchorImages: [],
      anchorImagesComplete: false,
      anchorStreamStarted: false,
      quickStartActive: false,
      quickStartStep: 0,
      quickMeetVibeId: null,
      companionReady: false,
      companionActive: false,
      anchorReady: false,
      backstoryReady: false,
      backstoryContext: null,
      appearanceChangedAfterGeneration: false,
      anchorAppearanceSnapshot: null,

      setStep: (step) => set({ currentStep: step }),
      nextStep: () => {
        if (typeof window !== 'undefined') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        set((state) => ({ currentStep: Math.min(state.currentStep + 1, 6) }));
      },
      prevStep: () => {
        if (typeof window !== 'undefined') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        set((state) => ({ currentStep: Math.max(state.currentStep - 1, 1) }));
      },

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

      setTenets: (tenets) => set({ tenets }),

      setName: (name) => set({ name }),
      setIdentity: (identity) => set({ identity }),
      setVoice: (voice) => set({ voice }),
      setVisualStyle: (style) =>
        set((state) => ({
          visualStyle: { ...state.visualStyle, ...style },
        })),
      setAppearance: (appearance) =>
        set((state) => {
          const current = state.visualStyle.appearance;
          const newGender = appearance.gender ?? current.gender;

          // If gender changed, reset to clean state for new gender
          if (newGender !== current.gender) {
            const base: PhysicalAppearance = newGender === 'female'
              ? {
                  gender: 'female',
                  ethnicity: current.ethnicity,
                  bodyType: 'athletic' as const,
                  hairColor: current.hairColor,
                  breastSize: 'M' as const,
                }
              : {
                  gender: 'male',
                  ethnicity: current.ethnicity,
                  bodyType: 'athletic' as const,
                  hairColor: current.hairColor,
                  build: 'M' as const,
                };

            return {
              visualStyle: {
                ...state.visualStyle,
                appearance: { ...base, ...appearance } as PhysicalAppearance,
              },
              // Mark appearance as changed if generation already started
              appearanceChangedAfterGeneration: state.generationStarted ? true : state.appearanceChangedAfterGeneration,
            };
          }

          return {
            visualStyle: {
              ...state.visualStyle,
              appearance: { ...current, ...appearance } as PhysicalAppearance,
            },
            // Mark appearance as changed if generation already started
            appearanceChangedAfterGeneration: state.generationStarted ? true : state.appearanceChangedAfterGeneration,
          };
        }),
      setBoundaries: (boundaries) =>
        set((state) => ({
          boundaries: { ...state.boundaries, ...boundaries },
        })),
      setCompanionId: (id) => set({ companionId: id }),
      setSessionId: (id) => set({ sessionId: id }),
      setGenerationStarted: (started) => set({ generationStarted: started }),
      setCompanionReady: (ready) => set({ companionReady: ready }),
      setCompanionActive: (active) => set({ companionActive: active }),
      setAnchorReady: (ready) => set({ anchorReady: ready }),
      setBackstoryReady: (ready) => set({ backstoryReady: ready }),
      addAnchorImage: (anchor) =>
        set((state) => ({
          anchorImages: [...state.anchorImages, anchor],
        })),
      clearAnchorImages: () => set({
        anchorImages: [],
        anchorImagesComplete: false,
        anchorStreamStarted: false,
        anchorReady: false,
      }),
      setAnchorImagesComplete: (complete) => set({ anchorImagesComplete: complete }),
      setAnchorStreamStarted: (started) => set({ anchorStreamStarted: started }),
      setQuickStartActive: (active) => set({ quickStartActive: active }),
      setQuickStartStep: (step) => set({ quickStartStep: step }),
      setQuickMeetVibeId: (vibeId) => set({ quickMeetVibeId: vibeId }),
      setAppearanceChangedAfterGeneration: (changed) => set({ appearanceChangedAfterGeneration: changed }),
      setAnchorAppearanceSnapshot: (appearance) => set({ anchorAppearanceSnapshot: appearance }),
      setBackstoryContext: (context) => set({ backstoryContext: context }),
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
          visualStyle: {
            ...initialVisualStyle,
            appearance: { ...initialAppearance } as PhysicalAppearance,
          },
          boundaries: initialBoundaries,
          companionId: null,
          sessionId: null,
          generationStarted: false,
          anchorImages: [],
          anchorImagesComplete: false,
          anchorStreamStarted: false,
          quickStartActive: false,
          quickStartStep: 0,
          quickMeetVibeId: null,
          companionReady: false,
          companionActive: false,
          anchorReady: false,
          backstoryReady: false,
          backstoryContext: null,
          appearanceChangedAfterGeneration: false,
          anchorAppearanceSnapshot: null,
        }),
    }),
    {
      name: 'campfire-onboarding',
    }
  )
);

// Expose store on window for E2E testing (development only)
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__ONBOARDING_STORE__ = useOnboardingStore;
}
