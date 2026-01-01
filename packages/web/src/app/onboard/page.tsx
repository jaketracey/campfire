'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Step1Welcome } from '@/components/onboarding/steps/step-1-welcome';
import { Step2Identity } from '@/components/onboarding/steps/step-2-identity';
import { Step3Visuals } from '@/components/onboarding/steps/step-3-visuals';
import { Step4Archetype } from '@/components/onboarding/steps/step-4-archetype';
import { Step5Traits } from '@/components/onboarding/steps/step-5-traits';
import { Step6Tenets } from '@/components/onboarding/steps/step-6-tenets';
import { Step7Voice } from '@/components/onboarding/steps/step-7-voice';
import { Step8Boundaries } from '@/components/onboarding/steps/step-8-boundaries';
import { Step9Review } from '@/components/onboarding/steps/step-9-review';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

export default function OnboardingPage() {
  const router = useRouter();
  const { isAuthenticated, isInitialized, isLoading: authLoading } = useAuth();
  const { currentStep, prevStep } = useOnboardingStore();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (isInitialized && !authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isInitialized, authLoading, isAuthenticated, router]);

  // Show loading while checking auth
  if (!isInitialized || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a]">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

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
        return <Step5Traits key="step5" />;
      case 6:
        return <Step6Tenets key="step6" />;
      case 7:
        return <Step7Voice key="step7" />;
      case 8:
        return <Step8Boundaries key="step8" />;
      case 9:
        return <Step9Review key="step9" />;
      default:
        return <Step1Welcome key="step1" />;
    }
  };

  const progress = ((currentStep - 1) / 8) * 100;

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-white flex flex-col font-sans">
      {/* Header / Nav */}
      <header className="relative z-10 flex items-center justify-between p-6 pt-20">
        <div className="flex items-center gap-4">
          {currentStep > 1 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={prevStep}
              className="rounded-full hover:bg-primary/10"
            >
              <ChevronLeft className="h-6 w-6" />
            </Button>
          )}
          {currentStep > 1 && (
            <div id="step-indicator" className="flex flex-col gap-1.5 w-32 md:w-48">
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase font-display">
                Step {currentStep} <span className="text-vibes-cyan">/ 9</span>
              </span>
              <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  className="h-full bg-gradient-to-r from-vibes-electric to-vibes-cyan shadow-[0_0_10px_rgba(6,182,212,0.5)]"
                />
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 md:p-8">
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
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}