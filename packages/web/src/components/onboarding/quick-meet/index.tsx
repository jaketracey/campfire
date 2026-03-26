'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { StepVibeSelect } from './step-vibe-select';
import { StepNameInput, type Pronouns } from './step-name-input';
import { StepFirstChat } from './step-first-chat';
import type { VibePreset } from './vibe-presets';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { trackOnboardingStep } from '@/lib/analytics/meta-pixel';

type QuickMeetStep = 'vibe' | 'name' | 'creating';

const stepAnimation = {
  initial: { opacity: 0, x: 60, filter: 'blur(12px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, x: -60, filter: 'blur(12px)' },
  transition: {
    duration: 0.45,
    ease: [0.22, 1, 0.36, 1] as const,
  },
};

interface QuickMeetFlowProps {
  /** Called when the user clicks "I'll design my own" */
  onDesignOwn: () => void;
}

export function QuickMeetFlow({ onDesignOwn }: QuickMeetFlowProps) {
  const router = useRouter();
  const { setQuickStartActive, setQuickStartStep } = useOnboardingStore();

  const [step, setStep] = useState<QuickMeetStep>('vibe');
  const [selectedPreset, setSelectedPreset] = useState<VibePreset | null>(null);
  const [companionName, setCompanionName] = useState('');
  const [pronouns, setPronouns] = useState<Pronouns>('she/her');

  const handleVibeSelect = useCallback(
    (preset: VibePreset) => {
      setSelectedPreset(preset);
      setQuickStartActive(true);
      setQuickStartStep(0);
      trackOnboardingStep(1, 'quick-meet-vibe');
      setStep('name');
    },
    [setQuickStartActive, setQuickStartStep],
  );

  const handleNameContinue = useCallback(() => {
    setQuickStartStep(1);
    trackOnboardingStep(2, 'quick-meet-name');
    setStep('creating');
  }, [setQuickStartStep]);

  const handleDesignOwn = useCallback(() => {
    onDesignOwn();
  }, [onDesignOwn]);

  return (
    <div className="w-full" data-testid="quick-meet-flow">
      <AnimatePresence mode="wait">
        {step === 'vibe' && (
          <motion.div key="vibe" {...stepAnimation}>
            <StepVibeSelect onSelect={handleVibeSelect} onDesignOwn={handleDesignOwn} />
          </motion.div>
        )}

        {step === 'name' && selectedPreset && (
          <motion.div key="name" {...stepAnimation}>
            <StepNameInput
              name={companionName}
              pronouns={pronouns}
              onNameChange={setCompanionName}
              onPronounsChange={setPronouns}
              onContinue={handleNameContinue}
            />
          </motion.div>
        )}

        {step === 'creating' && selectedPreset && (
          <motion.div key="creating" {...stepAnimation}>
            <StepFirstChat
              preset={selectedPreset}
              companionName={companionName.trim()}
              pronouns={pronouns}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
