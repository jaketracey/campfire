'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Step1Welcome } from '@/components/onboarding/steps/step-1-welcome';
import { Step2Identity } from '@/components/onboarding/steps/step-2-identity';
import { Step3Visuals } from '@/components/onboarding/steps/step-3-visuals';
import { Step4Archetype } from '@/components/onboarding/steps/step-4-archetype';
import { Step7Voice as Step5Voice } from '@/components/onboarding/steps/step-7-voice';
import { Step9Review as Step6Review } from '@/components/onboarding/steps/step-9-review';
import { WelcomeTransition } from '@/components/auth/welcome-transition';
import {
  FULL_STEP_LABEL_MIN,
  FULL_ONBOARDING_LABELS,
  QUICK_ONBOARDING_LABELS,
  clampFullStep,
  fullReviewStepProgress,
  quickStartProgress,
} from '@/components/onboarding/onboarding-flow';

export default function OnboardingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    currentStep,
    setStep,
    reset,
    quickStartActive,
    quickStartStep,
    companionId,
    sessionId,
  } = useOnboardingStore();

  // Reset onboarding state when page mounts fresh (only if no step param and no active draft flow)
  useEffect(() => {
    const stepParam = searchParams.get('step');
    if (!stepParam) {
      if (!quickStartActive && !companionId && !sessionId) {
        reset();
      }
    }
  }, [quickStartActive, companionId, reset, searchParams, sessionId]);

  // Sync URL to step state on mount and popstate (browser back/forward)
  // Note: We intentionally exclude currentStep from deps to avoid a feedback loop.
  // This effect should only run when the URL changes (browser back/forward/direct navigation),
  // not when the store changes (which is handled by the next effect).
  useEffect(() => {
    const stepParam = searchParams.get('step');
    if (stepParam) {
      const stepNum = clampFullStep(parseInt(stepParam, 10));
      // Use getState() to get current value without adding dependency
      const current = useOnboardingStore.getState().currentStep;
      if (stepNum !== current) {
        setStep(stepNum);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setStep]);

  // Update URL when step changes (push to history for back/forward support)
  useEffect(() => {
    const stepParam = searchParams.get('step');
    const currentStepStr = currentStep.toString();

    // Only update URL if step changed and we're past the welcome step
    if (currentStep > 1 && stepParam !== currentStepStr) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set('step', currentStepStr);
      router.push(`/onboard?${newParams.toString()}`, { scroll: false });
    } else if (currentStep === 1 && stepParam) {
      // Remove step param when going back to welcome
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete('step');
      const queryString = newParams.toString();
      router.push(queryString ? `/onboard?${queryString}` : '/onboard', { scroll: false });
    }
  }, [currentStep, searchParams, router]);

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

  const progress = fullReviewStepProgress(currentStep);
  const quickStartProgressPercent = quickStartProgress(quickStartStep);

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
            {/* Step counter */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-white/50">
                Step {currentStep - FULL_STEP_LABEL_MIN + 1} of {FULL_ONBOARDING_LABELS.length}
              </span>
              <div className="flex gap-3">
                {FULL_ONBOARDING_LABELS.map((label, index) => {
                  const stepNumber = index + FULL_STEP_LABEL_MIN;
                  const isCompleted = stepNumber < currentStep;
                  const isCurrent = stepNumber === currentStep;
                  const canNavigate = stepNumber < currentStep;

                  return (
                    <button
                      key={label}
                      onClick={() => canNavigate && setStep(stepNumber)}
                      disabled={!canNavigate}
                      className={`text-xs font-medium tracking-wide transition-all ${
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
            </div>
            {/* Progress bar */}
            <div
              className="h-1 w-full bg-white/10 rounded-full overflow-hidden border border-white/5"
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Onboarding progress"
            >
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
              {QUICK_ONBOARDING_LABELS.map((label, index) => {
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
            <div
              className="h-1 w-full bg-white/10 rounded-full overflow-hidden border border-white/5"
              role="progressbar"
              aria-valuenow={Math.round(quickStartProgressPercent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Quick start progress"
            >
              <motion.div
                className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                initial={{ width: 0 }}
                animate={{ width: `${quickStartProgressPercent}%` }}
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
