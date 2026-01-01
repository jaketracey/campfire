'use client';

import { motion } from 'framer-motion';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function Step1Welcome() {
  const { nextStep } = useOnboardingStore();

  return (
    <div className="text-center space-y-12">

      <div className="space-y-6">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tighter font-display text-white">
          Design Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-vibes-neon via-vibes-hot to-vibes-cyan animate-gradient-x">Companion</span>
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
