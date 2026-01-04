'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Step1Welcome } from '@/components/onboarding/steps/step-1-welcome';
import { Step2Identity } from '@/components/onboarding/steps/step-2-identity';
import { Step3Visuals } from '@/components/onboarding/steps/step-3-visuals';
import { Step4Archetype } from '@/components/onboarding/steps/step-4-archetype';
import { Step7Voice as Step5Voice } from '@/components/onboarding/steps/step-7-voice';
import { Step9Review as Step6Review } from '@/components/onboarding/steps/step-9-review';
import { WelcomeTransition } from '@/components/auth/welcome-transition';

// Step labels for the progress indicator
const STEP_LABELS = ['Identity', 'Visuals', 'Archetype', 'Voice', 'Review'];
const QUICK_START_LABELS = ['Identity', 'Visuals', 'Archetype', 'Voice'];

export default function OnboardingPage() {
  const { currentStep, setStep, reset, quickStartActive, quickStartStep } = useOnboardingStore();

  // Reset onboarding state when page mounts fresh
  useEffect(() => {
    reset();
  }, [reset]);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1Welcome key="step1" />;
      case 2:
        return <Step2Identity key="step2" />;
      case 3:
        return <Step3Visuals key="step3" />;
      case 4:
        return <Step4Archetype key="step4" />;
      case 5:
        return <Step5Voice key="step5" />;
      case 6:
        return <Step6Review key="step6" />;
      default:
        return <Step1Welcome key="step1" />;
    }
  };

  const progress = ((currentStep - 1) / 5) * 100;
  const quickStartProgress = ((quickStartStep + 1) / QUICK_START_LABELS.length) * 100;

  // Show stepper for normal flow (steps 2-5) OR quick start carousel
  const showNormalStepper = currentStep > 1 && currentStep < 6;
  const showQuickStartStepper = quickStartActive;

  return (
    <WelcomeTransition>
    <div className="relative min-h-screen w-full overflow-hidden text-white flex flex-col font-sans">
      {/* Step indicator - normal flow */}
      {showNormalStepper && !showQuickStartStepper && (
        <div className="flex justify-center px-4 pt-20 lg:pt-6 pb-8 md:pb-6">
          <div className="w-full max-w-md">
            {/* Step labels */}
            <div className="flex justify-between mb-2">
              {STEP_LABELS.map((label, index) => {
                const stepNumber = index + 2; // Steps 2-6 (step 1 is welcome)
                const isCompleted = index < currentStep - 1;
                const isCurrent = stepNumber === currentStep;
                const canNavigate = isCompleted;

                return (
                  <button
                    key={label}
                    onClick={() => canNavigate && setStep(stepNumber)}
                    disabled={!canNavigate}
                    className={`text-[10px] font-bold tracking-widest uppercase transition-all ${
                      isCompleted
                        ? 'text-white/60 hover:text-white/80 cursor-pointer'
                        : isCurrent
                          ? 'text-campfire-500 cursor-default'
                          : 'text-gray-600 cursor-default'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {/* Progress bar */}
            <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden border border-white/5">
              <motion.div
                className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step indicator - quick start flow */}
      {showQuickStartStepper && (
        <div className="flex justify-center px-4 pt-20 lg:pt-6 pb-8 md:pb-6">
          <div className="w-full max-w-md">
            {/* Step labels */}
            <div className="flex justify-between mb-2">
              {QUICK_START_LABELS.map((label, index) => {
                const isCompleted = index < quickStartStep;
                const isCurrent = index === quickStartStep;

                return (
                  <span
                    key={label}
                    className={`text-[10px] font-bold tracking-widest uppercase transition-all ${
                      isCompleted
                        ? 'text-white/60'
                        : isCurrent
                          ? 'text-campfire-500'
                          : 'text-gray-600'
                    }`}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
            {/* Progress bar */}
            <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden border border-white/5">
              <motion.div
                className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                initial={{ width: 0 }}
                animate={{ width: `${quickStartProgress}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className={`relative z-10 flex-1 flex flex-col items-center md:justify-center p-4 md:p-8 md:pt-20 ${currentStep === 1 && !quickStartActive ? 'pt-20' : ''}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 30, scale: 0.95, filter: 'blur(20px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -30, scale: 1.05, filter: 'blur(20px)' }}
            transition={{
              duration: 0.6,
              ease: [0.22, 1, 0.36, 1], // Custom cubic-bezier
              opacity: { duration: 0.4 }
            }}
            className="w-full max-w-4xl relative z-20"
            data-hides-logo
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
    </WelcomeTransition>
  );
}