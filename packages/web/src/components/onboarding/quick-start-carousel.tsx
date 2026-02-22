'use client';

import { useCallback, useEffect } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { IdentityDisplay } from './quick-start/identity-display';
import { VisualsDisplay } from './quick-start/visuals-display';
import { ArchetypeDisplay } from './quick-start/archetype-display';
import { VoiceDisplay } from './quick-start/voice-display';
import { useOnboardingStore } from '@/stores/onboarding-store';
import type { CompanionAppearance } from '@/lib/api/companions';
import { quickStepToIndex } from '@/components/onboarding/onboarding-flow';

type CarouselSection = 'identity' | 'visuals' | 'archetype' | 'voice';

const SECTIONS: CarouselSection[] = ['identity', 'visuals', 'archetype', 'voice'];

interface GeneratedCompanionData {
  primaryArchetype: {
    id: string;
    name: string;
    description: string;
    icon: string;
    traits: readonly string[];
  };
  secondaryArchetype: {
    id: string;
    name: string;
    description: string;
    icon: string;
    traits: readonly string[];
  } | null;
  personality: {
    warmth: number;
    energy: number;
    playfulness: number;
    formality: number;
    assertiveness: number;
    curiosity: number;
    empathy: number;
    spontaneity: number;
    optimism: number;
    directness: number;
  };
  visualStyle: {
    appearance: CompanionAppearance;
  };
  pronouns: string;
  voice: {
    id: string;
    name: string;
    description: string;
    gender: string;
  };
  boundaries: {
    relationship_pacing: string;
    content_rating: string;
    emotional_depth: string;
    topics_avoid: string[];
    safe_topics: string[];
  };
}

interface QuickStartCarouselProps {
  companionName: string;
  generatedData: GeneratedCompanionData;
  onComplete: () => void;
  /** When false, display components won't auto-advance (for back navigation) */
  autoAdvance?: boolean;
}

// Generate a random backstory snippet
function generateBackstorySnippet(archetype: string): string {
  const snippets: Record<string, string[]> = {
    caregiver: [
      'A gentle soul who finds joy in nurturing others through life\'s challenges.',
      'Devoted to helping others flourish, always ready with a warm embrace.',
    ],
    sage: [
      'A seeker of wisdom who delights in exploring life\'s deeper meanings.',
      'Thoughtful and reflective, finding peace in philosophical contemplation.',
    ],
    explorer: [
      'An adventurous spirit driven by insatiable curiosity about the world.',
      'Always seeking new horizons, finding excitement in the unknown.',
    ],
    creator: [
      'An artistic soul who sees beauty and possibility everywhere.',
      'Driven to create and express, turning imagination into reality.',
    ],
    hero: [
      'A brave heart who stands ready to face any challenge head-on.',
      'Courageous and determined, always fighting for what matters.',
    ],
    jester: [
      'A playful spirit who finds joy in laughter and lighthearted moments.',
      'Quick-witted and spontaneous, bringing smiles wherever they go.',
    ],
    lover: [
      'A passionate soul devoted to deep connection and intimacy.',
      'Romantic and sensual, savoring every moment of closeness.',
    ],
    magician: [
      'A transformative presence who inspires wonder and possibility.',
      'Mystical and visionary, making the impossible feel within reach.',
    ],
    ruler: [
      'A confident leader who brings order and structure to any situation.',
      'Decisive and authoritative, commanding respect effortlessly.',
    ],
    everyperson: [
      'A down-to-earth companion who values genuine connection.',
      'Authentic and approachable, making everyone feel at ease.',
    ],
    innocent: [
      'An optimistic soul who sees the best in every situation.',
      'Pure-hearted and joyful, bringing light to dark moments.',
    ],
    rebel: [
      'A free spirit who defies convention and blazes their own trail.',
      'Bold and unconventional, unafraid to challenge the status quo.',
    ],
  };

  const options = snippets[archetype] || snippets.everyperson;
  return options[Math.floor(Math.random() * options.length)];
}

export function QuickStartCarousel({
  companionName,
  generatedData,
  onComplete,
  autoAdvance = true,
}: QuickStartCarouselProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { setQuickStartStep } = useOnboardingStore();

  // Derive current section from URL - URL is the source of truth
  const qsParam = searchParams.get('qs');
  const currentIndex = quickStepToIndex(qsParam ? parseInt(qsParam, 10) : 0);
  const currentSection = SECTIONS[currentIndex];

  const backstory = generateBackstorySnippet(generatedData.primaryArchetype.id);

  // Sync current section index with store for stepper display
  useEffect(() => {
    setQuickStartStep(currentIndex);
  }, [currentIndex, setQuickStartStep]);

  // Ensure URL has qs param on mount (for initial state)
  useEffect(() => {
    const parsed = qsParam !== null ? parseInt(qsParam, 10) : 0;
    const normalized = quickStepToIndex(parsed);

    if (qsParam === null || Number.isNaN(parsed) || normalized !== parsed) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set('qs', normalized.toString());
      router.replace(`${pathname}?${newParams.toString()}` as string, { scroll: false });
    }
  }, [pathname, qsParam, searchParams, router]);

  // Handle section completion - advance to next step via URL
  const handleSectionComplete = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < SECTIONS.length) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set('qs', nextIndex.toString());
      router.push(`${pathname}?${newParams.toString()}` as string, { scroll: false });
    } else {
      // Clean up qs param when completing carousel
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete('qs');
      const queryString = newParams.toString();
      router.replace((queryString ? `${pathname}?${queryString}` : pathname) as string, { scroll: false });
      onComplete();
    }
  }, [currentIndex, onComplete, pathname, searchParams, router]);

  const renderSection = () => {
    switch (currentSection) {
      case 'identity':
        return (
          <IdentityDisplay
            key="identity"
            name={companionName}
            pronouns={generatedData.pronouns}
            backstory={backstory}
            onComplete={handleSectionComplete}
            autoAdvance={autoAdvance}
          />
        );
      case 'visuals':
        return (
          <VisualsDisplay
            key="visuals"
            appearance={generatedData.visualStyle.appearance}
            onComplete={handleSectionComplete}
            autoAdvance={autoAdvance}
          />
        );
      case 'archetype':
        return (
          <ArchetypeDisplay
            key="archetype"
            primaryArchetypeId={generatedData.primaryArchetype.id}
            secondaryArchetypeId={generatedData.secondaryArchetype?.id || null}
            onComplete={handleSectionComplete}
            autoAdvance={autoAdvance}
          />
        );
      case 'voice':
        return (
          <VoiceDisplay
            key="voice"
            voiceId={generatedData.voice.id}
            onComplete={handleSectionComplete}
            autoAdvance={autoAdvance}
          />
        );
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Section content - stepper is now rendered by onboard/page.tsx */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentSection}
          initial={{ opacity: 0, x: 50, scale: 0.98, filter: 'blur(10px)' }}
          animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, x: -50, scale: 0.98, filter: 'blur(10px)' }}
          transition={{
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="relative z-10"
        >
          {renderSection()}
        </motion.div>
      </AnimatePresence>

      {/* Companion name badge */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex justify-center"
      >
        <div className="px-6 py-2 rounded-full bg-white/[0.03] border border-white/10">
          <span className="text-sm text-gray-400">Creating </span>
          <span className="text-sm font-bold text-vibes-neon">{companionName}</span>
        </div>
      </motion.div>
    </div>
  );
}
