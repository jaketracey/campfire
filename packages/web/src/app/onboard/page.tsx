'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Step1Welcome } from '@/components/onboarding/steps/step-1-welcome';
import { Step2Identity } from '@/components/onboarding/steps/step-2-identity';
import { Step3Personality } from '@/components/onboarding/steps/step-3-personality';
import { Step4Voice } from '@/components/onboarding/steps/step-4-voice';
import { Step5Visuals } from '@/components/onboarding/steps/step-5-visuals';
import { Step6Boundaries } from '@/components/onboarding/steps/step-6-boundaries';
import { Step7Review } from '@/components/onboarding/steps/step-7-review';
import { VoiceVisualizer } from '@/components/ui/voice-visualizer';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function OnboardingPage() {
  const { currentStep, prevStep } = useOnboardingStore();

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1Welcome key="step1" />;
      case 2:
        return <Step2Identity key="step2" />;
      case 3:
        return <Step3Personality key="step3" />;
      case 4:
        return <Step4Voice key="step4" />;
      case 5:
        return <Step5Visuals key="step5" />;
      case 6:
        return <Step6Boundaries key="step6" />;
      case 7:
        return <Step7Review key="step7" />;
      default:
        return <Step1Welcome key="step1" />;
    }
  };

  const progress = ((currentStep - 1) / 6) * 100;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0a0a0a] text-white flex flex-col font-sans">
      {/* Background Visuals - Vibes Aesthetic */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        {/* Animated Glows */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-vibes-neon/20 rounded-full blur-[120px] animate-pulse-slow" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-vibes-electric/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] bg-vibes-hot/10 rounded-full blur-[100px] animate-float" />

        {/* 3D Perspective Container for Background Avatars */}
        <div className="absolute inset-0" style={{ perspective: '1000px' }}>
          <motion.div
            className="absolute top-[15%] left-[5%] w-32 h-32 opacity-20"
            animate={{
              y: [0, -20, 0],
              rotateX: [0, 10, 0],
              rotateY: [0, 15, 0]
            }}
            transition={{ duration: 6, repeat: Infinity, ease: [0.37, 0, 0.63, 1] }}
          >
            <img src="/avatars/avatar-1.png" alt="" className="w-full h-full object-contain filter grayscale" />
          </motion.div>
          <motion.div
            className="absolute bottom-[20%] right-[5%] w-40 h-40 opacity-20"
            animate={{
              y: [0, 20, 0],
              rotateX: [0, -15, 0],
              rotateY: [0, -10, 0]
            }}
            transition={{ duration: 8, repeat: Infinity, ease: [0.37, 0, 0.63, 1], delay: 1 }}
          >
            <img src="/avatars/avatar-4.png" alt="" className="w-full h-full object-contain filter grayscale" />
          </motion.div>
        </div>

        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0a]/50 to-[#0a0a0a]" />
      </div>

      {/* Header / Nav */}
      <header className="relative z-10 flex items-center justify-between p-6">
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
            <div className="flex flex-col gap-1.5 w-32 md:w-48">
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase font-display">
                Step {currentStep} <span className="text-vibes-cyan">/ 7</span>
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
            className="w-full max-w-2xl relative z-20"
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}