'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { ArrowRight, Zap } from 'lucide-react';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { QuickStart } from '@/components/onboarding/quick-start';
import { trackStartOnboarding, trackOnboardingStep } from '@/lib/analytics/meta-pixel';

// Register SplitText plugin
gsap.registerPlugin(SplitText);

export function Step1Welcome() {
  const { nextStep } = useOnboardingStore();
  const [showQuickStart, setShowQuickStart] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const hasTrackedRef = useRef(false);

  // Track onboarding welcome step on mount
  useEffect(() => {
    if (!hasTrackedRef.current) {
      trackOnboardingStep(1, 'welcome');
      hasTrackedRef.current = true;
    }
  }, []);

  const handleStartDesigning = () => {
    trackStartOnboarding('full');
    nextStep();
  };

  const handleQuickStart = () => {
    trackStartOnboarding('quick');
    setShowQuickStart(true);
  };

  useEffect(() => {
    if (!headingRef.current || !subtitleRef.current || !buttonRef.current) return;

    const ctx = gsap.context(() => {
      // Split the text elements
      const designYourSplit = new SplitText('.design-your-text', {
        type: 'chars',
        charsClass: 'char-design',
      });

      const companionSplit = new SplitText('.companion-text', {
        type: 'chars',
        charsClass: 'char-companion',
      });

      const subtitleSplit = new SplitText(subtitleRef.current, {
        type: 'words',
        wordsClass: 'word-subtitle',
      });

      // Set initial states
      gsap.set(designYourSplit.chars, {
        opacity: 0,
        scale: 0,
        rotation: -15,
      });

      gsap.set(companionSplit.chars, {
        opacity: 0,
        y: 60,
        scale: 0.5,
      });

      gsap.set(subtitleSplit.words, {
        opacity: 0,
        y: 20,
      });

      gsap.set(buttonRef.current, {
        opacity: 0,
        y: 40,
        scale: 0.9,
      });

      gsap.set('.sonic-ring', {
        scale: 0.5,
        opacity: 0,
      });

      // Create the playful timeline
      const tl = gsap.timeline({ delay: 0.1 });

      // "Design Your" - bouncy pop from center
      tl.to(designYourSplit.chars, {
        opacity: 1,
        scale: 1,
        rotation: 0,
        duration: 0.6,
        stagger: {
          each: 0.03,
          from: 'center',
        },
        ease: 'elastic.out(1, 0.5)',
      })
        // "Companion" - bouncy wave entrance
        .to(
          companionSplit.chars,
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.8,
            stagger: {
              each: 0.04,
              from: 'start',
            },
            ease: 'elastic.out(1, 0.4)',
          },
          '-=0.3'
        )
        // Sonic rings start pulsing
        .add(() => {
          gsap.to('.sonic-ring', {
            scale: 4,
            opacity: 0,
            duration: 2.5,
            stagger: 0.5,
            ease: 'power2.out',
            repeat: -1,
            startAt: { scale: 0.5, opacity: 0.5 },
          });
        }, '-=0.4')
        // Subtitle words fade in
        .to(
          subtitleSplit.words,
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            stagger: 0.04,
            ease: 'back.out(1.5)',
          },
          '-=0.5'
        )
        // Button bounces up
        .to(
          buttonRef.current,
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.6,
            ease: 'elastic.out(1, 0.6)',
          },
          '-=0.3'
        );

      // Cleanup function to revert SplitText
      return () => {
        designYourSplit.revert();
        companionSplit.revert();
        subtitleSplit.revert();
      };
    }, containerRef);

    return () => ctx.revert();
  }, []);

  // If quick start is active, show that instead
  if (showQuickStart) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="quick-start"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.4 }}
        >
          <QuickStart onBack={() => setShowQuickStart(false)} />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div ref={containerRef} className="text-center space-y-12 pt-12 md:pt-0">
      <div className="space-y-6">
        <h1
          ref={headingRef}
          className="relative z-10 text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-bold tracking-tighter font-display overflow-visible leading-[0.9] flex flex-col items-center justify-center min-h-[1.2em]"
        >
          {/* Main Text */}
          <div className="relative z-20">
            <span
              className="design-your-text inline-block text-white"
              style={{
                textShadow: '0 0 40px rgba(255,255,255,0.15), 0 0 80px rgba(168,85,247,0.1)',
              }}
            >
              Design Your
            </span>{' '}
            <span
              className="companion-text inline-block text-white"
              style={{
                textShadow: '0 0 40px rgba(255,255,255,0.15), 0 0 80px rgba(168,85,247,0.1)',
              }}
            >
              Companion
            </span>
          </div>

          {/* Sonic Rings Background */}
          <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
            <div className="absolute w-[300px] h-[300px] rounded-full border-2 border-vibes-cyan/40 sonic-ring shadow-[0_0_40px_rgba(6,182,212,0.3)]" />
            <div className="absolute w-[300px] h-[300px] rounded-full border-2 border-vibes-neon/40 sonic-ring shadow-[0_0_40px_rgba(168,85,247,0.3)]" />
            <div className="absolute w-[300px] h-[300px] rounded-full border-2 border-vibes-hot/40 sonic-ring shadow-[0_0_40px_rgba(236,72,153,0.3)]" />
          </div>
        </h1>

        <p
          ref={subtitleRef}
          className="text-xl md:text-2xl text-gray-400 max-w-lg mx-auto leading-relaxed text-center flex flex-wrap justify-center gap-x-[0.3em]"
        >
          Create a unique AI personality that listens, remembers, and grows with you.{' '}
          <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-vibes-neon to-vibes-cyan">
            Your journey begins here.
          </span>
        </p>
      </div>

      <div ref={buttonRef} className="pt-8 flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6">
        {/* Primary CTA - Full Designer */}
        <Button
          size="lg"
          onClick={handleStartDesigning}
          className="group text-xl px-12 py-8 rounded-full bg-gradient-to-r from-vibes-hot via-vibes-neon to-vibes-electric hover:shadow-[0_0_50px_rgba(168,85,247,0.5)] transition-all duration-300 hover:scale-105 active:scale-95"
        >
          Start Designing
          <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>

        {/* Divider - vertical on mobile, inline on desktop */}
        <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">or</span>

        {/* Quick Start Option */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          <Button
            variant="ghost"
            size="lg"
            onClick={handleQuickStart}
            className="group text-base px-8 py-6 rounded-full border border-vibes-cyan/30 hover:border-vibes-cyan/60 hover:bg-vibes-cyan/10 hover:shadow-[0_0_30px_rgba(6,182,212,0.2)] transition-all duration-300"
          >
            <Zap className="mr-2 h-5 w-5 text-vibes-cyan group-hover:animate-pulse" />
            Quick Start
            <span className="ml-2 text-xs text-gray-500 group-hover:text-gray-400">60 seconds</span>
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
