'use client';

import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';

export function Step6Boundaries() {
  const { boundaries, setBoundaries, nextStep } = useOnboardingStore();

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center justify-center p-4 rounded-full bg-vibes-acid/10 border border-vibes-acid/20 mb-3 shadow-[0_0_20px_rgba(190,242,100,0.2)]"
        >
          <ShieldCheck className="h-10 w-10 text-vibes-acid" />
        </motion.div>
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">Boundaries & Consent</h2>
        <p className="text-gray-400 max-w-md mx-auto">You are in full control of your companion's memory and growth.</p>
      </div>

      <Card className="bg-white/[0.02] backdrop-blur-3xl border-white/10 shadow-2xl overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-vibes-acid to-vibes-cyan" />
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold font-display text-white">Security & Memory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8 pt-4">
          <div className="flex items-center justify-between space-x-6">
            <div className="space-y-1">
              <Label className="text-lg font-bold text-gray-200">Long-term Memory</Label>
              <p className="text-sm text-gray-500 leading-relaxed">
                Allow your companion to remember the heart of your conversations and build a shared history.
              </p>
            </div>
            <Switch
              checked={boundaries.consentToMemory}
              onCheckedChange={(checked) => setBoundaries({ consentToMemory: checked })}
              className="data-[state=checked]:bg-vibes-acid"
            />
          </div>

          <div className="flex items-center justify-between space-x-6">
            <div className="space-y-1">
              <Label className="text-lg font-bold text-gray-200">Active Evolution</Label>
              <p className="text-sm text-gray-500 leading-relaxed">
                Let your companion evolve its personality and perspective based on your unique interactions.
              </p>
            </div>
            <Switch
              checked={boundaries.consentToLearning}
              onCheckedChange={(checked) => setBoundaries({ consentToLearning: checked })}
              className="data-[state=checked]:bg-vibes-cyan"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pt-8">
        <Button
          size="lg"
          onClick={nextStep}
          className="group h-14 px-12 rounded-full bg-gradient-to-r from-vibes-acid to-vibes-cyan text-black hover:shadow-[0_0_30px_rgba(190,242,100,0.3)] transition-all font-bold text-lg"
        >
          Review & Ignite
          <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>
      </div>
    </div>
  );
}
