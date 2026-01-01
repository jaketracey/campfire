'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import gsap from 'gsap';

export function Step1Welcome() {
  const { nextStep } = useOnboardingStore();
  const containerRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();

      // Animate "Design Your" letters
      tl.from(".char-design", {
        y: 100,
        opacity: 0,
        rotateX: -90,
        stagger: 0.02,
        duration: 1,
        ease: "back.out(1.7)",
      })
        // Animate "Companion" letters with a slight delay overlap
        .from(".char-companion", {
          y: 100,
          opacity: 0,
          rotateX: -90,
          stagger: 0.02,
          duration: 1,
          ease: "back.out(1.7)",
        }, "-=0.8")
        // Start the sonic ring animation
        .add(() => {
          gsap.to(".sonic-ring", {
            scale: 4,
            opacity: 0,
            duration: 3,
            stagger: 0.6,
            ease: "power1.out",
            repeat: -1,
            startAt: { scale: 0.5, opacity: 0.6 },
          });
        }, "-=0.2");

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div className="text-center space-y-12">

      <div className="space-y-6">
        <h1 ref={containerRef} className="relative z-10 text-5xl md:text-8xl lg:text-9xl font-bold tracking-tighter font-display text-white overflow-visible leading-tight flex flex-col items-center justify-center min-h-[1.2em]">
          {/* Main Text */}
          <div className="relative z-20">
            <div className="inline-block relative">
              {"Design Your".split('').map((char, i) => (
                <span key={`l1-${i}`} className="inline-block origin-bottom will-change-transform char-design">
                  {char === ' ' ? '\u00A0' : char}
                </span>
              ))}
            </div>{" "}
            <div className="inline-block relative">
              {"Companion".split('').map((char, i) => (
                <span
                  key={`l2-${i}`}
                  className="inline-block origin-bottom will-change-transform text-transparent bg-clip-text bg-gradient-to-r from-vibes-neon to-vibes-electric char-companion"
                >
                  {char}
                </span>
              ))}
            </div>
          </div>

          {/* Sonic Rings Background */}
          <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
            <div className="absolute w-[300px] h-[300px] rounded-full border border-vibes-cyan/30 sonic-ring opacity-0 shadow-[0_0_30px_rgba(6,182,212,0.2)]" />
            <div className="absolute w-[300px] h-[300px] rounded-full border border-vibes-neon/30 sonic-ring opacity-0 shadow-[0_0_30px_rgba(168,85,247,0.2)]" />
            <div className="absolute w-[300px] h-[300px] rounded-full border border-vibes-hot/30 sonic-ring opacity-0 shadow-[0_0_30px_rgba(236,72,153,0.2)]" />
          </div>
        </h1>
        <p className="text-xl text-gray-400 max-w-lg mx-auto leading-relaxed">
          Create a unique AI personality that listens, remembers, and grows with you.
          <span className="block mt-2 font-medium text-gray-300">Your journey begins here.</span>
        </p>
      </div>


      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="pt-12"
      >
        <Button
          size="lg"
          onClick={nextStep}
          className="group text-xl px-12 py-8 rounded-full bg-gradient-to-r from-vibes-neon to-vibes-electric hover:shadow-[0_0_40px_rgba(168,85,247,0.4)] transition-all duration-500 hover:scale-105 active:scale-95"
        >
          Start Designing
          <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>
      </motion.div>
    </div>
  );
}
