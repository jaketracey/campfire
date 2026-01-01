import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CompanionArchetype {
  id: string;
  name: string;
  description: string;
  traits: string[];
  icon: string;
}

export interface PersonalitySliders {
  warmth: number;
  playfulness: number;
  directness: number;
  curiosity: number;
  empathy: number;
  assertiveness: number;
}

export interface VoiceOption {
  id: string;
  name: string;
  description: string;
  sampleUrl: string;
  gender: 'masculine' | 'feminine' | 'neutral';
}

export interface VisualStyle {
  avatarStyle: 'realistic' | 'stylized' | 'abstract' | 'minimal';
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
  personality: PersonalitySliders;
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
  setPersonality: (personality: Partial<PersonalitySliders>) => void;
  setName: (name: string) => void;
  setIdentity: (identity: { pronouns: string; backstory: string }) => void;
  setVoice: (voice: VoiceOption) => void;
  setVisualStyle: (style: Partial<VisualStyle>) => void;
  setBoundaries: (boundaries: Partial<Boundaries>) => void;
  reset: () => void;
}

const initialPersonality: PersonalitySliders = {
  warmth: 70,
  playfulness: 50,
  directness: 50,
  curiosity: 60,
  empathy: 70,
  assertiveness: 40,
};

const initialVisualStyle: VisualStyle = {
  avatarStyle: 'stylized',
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
      personality: initialPersonality,
      name: '',
      identity: {
        pronouns: '',
        backstory: '',
      },
      voice: null,
      visualStyle: initialVisualStyle,
      boundaries: initialBoundaries,

      setStep: (step) => set({ currentStep: step }),
      nextStep: () => set((state) => ({ currentStep: Math.min(state.currentStep + 1, 7) })),
      prevStep: () => set((state) => ({ currentStep: Math.max(state.currentStep - 1, 1) })),

      setArchetype: (archetype) => set({ archetype }),
      setPersonality: (personality) =>
        set((state) => ({
          personality: { ...state.personality, ...personality },
        })),
      setName: (name) => set({ name }),
      setIdentity: (identity) => set({ identity }),
      setVoice: (voice) => set({ voice }),
      setVisualStyle: (style) =>
        set((state) => ({
          visualStyle: { ...state.visualStyle, ...style },
        })),
      setBoundaries: (boundaries) =>
        set((state) => ({
          boundaries: { ...state.boundaries, ...boundaries },
        })),
      reset: () =>
        set({
          currentStep: 1,
          archetype: null,
          personality: initialPersonality,
          name: '',
          identity: {
            pronouns: '',
            backstory: '',
          },
          voice: null,
          visualStyle: initialVisualStyle,
          boundaries: initialBoundaries,
        }),
    }),
    {
      name: 'campfire-onboarding',
    }
  )
);
