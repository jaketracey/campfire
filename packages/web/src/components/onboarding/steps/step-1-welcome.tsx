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
      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{
          type: "spring",
          stiffness: 260,
          damping: 20,
          delay: 0.2
        }}
        className="inline-flex items-center justify-center p-6 rounded-3xl bg-vibes-neon/10 border border-vibes-neon/20 mb-4 shadow-[0_0_30px_rgba(168,85,247,0.2)]"
      >
        <Sparkles className="h-16 w-16 text-vibes-neon animate-pulse" />
      </motion.div>

      <div className="space-y-6">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tighter font-display text-white">
          Design Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-vibes-neon via-vibes-hot to-vibes-cyan animate-gradient-x">Companion</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-lg mx-auto leading-relaxed">
          Create a unique AI personality that listens, remembers, and grows with you.
          <span className="block mt-2 font-medium text-gray-300">Your journey begins here.</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-4xl mx-auto pt-8">
        {[
          {
            title: 'Voice First',
            desc: 'Real-time conversations with ultra-low latency.',
            icon: '🎙️',
            color: 'border-vibes-electric/30'
          },
          {
            title: 'Long-term Memory',
            desc: 'Remembers details and builds a shared history.',
            icon: '🧠',
            color: 'border-vibes-neon/30'
          },
          {
            title: 'Visual Identity',
            desc: 'Generates consistent visuals for your companion.',
            icon: '🎨',
            color: 'border-vibes-hot/30'
          },
        ].map((feature, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.1, duration: 0.5 }}
          >
            <Card className={cn(
              "p-6 h-full bg-white/[0.03] backdrop-blur-xl border border-white/10 hover:border-white/20 transition-all group",
              feature.color
            )}>
              <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">{feature.icon}</div>
              <h3 className="font-bold text-lg mb-2 text-white font-display tracking-tight">{feature.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{feature.desc}</p>
            </Card>
          </motion.div>
        ))}
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
