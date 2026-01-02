'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowRight, Sparkles, Wand2 } from 'lucide-react';
import { generateRandomIdentity } from '@/lib/api/companions';

const identitySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  pronouns: z.string().min(1, 'Please select or enter pronouns'),
  backstory: z.string().optional(),
});

type IdentityFormValues = z.infer<typeof identitySchema>;

export function Step2Identity() {
  const { name, identity, setName, setIdentity, nextStep } = useOnboardingStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isValid },
  } = useForm<IdentityFormValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      name,
      pronouns: identity.pronouns,
      backstory: identity.backstory,
    },
    mode: 'onChange',
  });

  const onSubmit = (data: IdentityFormValues) => {
    setName(data.name);
    setIdentity({
      pronouns: data.pronouns,
      backstory: data.backstory || '',
    });
    nextStep();
  };

  const handleSurpriseMe = async () => {
    setIsGenerating(true);
    setJustGenerated(false);
    try {
      const generated = await generateRandomIdentity();
      setValue('name', generated.name, { shouldValidate: true });
      setValue('pronouns', generated.pronouns, { shouldValidate: true });
      setValue('backstory', generated.backstory, { shouldValidate: true });
      setJustGenerated(true);
      setHasGenerated(true);
      // Reset the animation trigger after a delay
      setTimeout(() => setJustGenerated(false), 1500);
    } catch (error) {
      console.error('Failed to generate identity:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Animation for individual inputs when generated - background color sweep
  const getInputAnimation = (delay: number) => ({
    background: [
      'rgba(255, 255, 255, 0.03)',
      'rgba(168, 85, 247, 0.15)',
      'rgba(6, 182, 212, 0.1)',
      'rgba(255, 255, 255, 0.03)',
    ],
    transition: {
      duration: 1.2,
      delay,
      ease: 'easeInOut',
    },
  });

  return (
    <Card className="w-full bg-white/[0.01] backdrop-blur-3xl border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden">
      <CardHeader className="space-y-2 pb-6">
        <div>
          <CardTitle className="text-3xl font-bold font-display tracking-tight text-white">Identity</CardTitle>
          <CardDescription className="text-gray-400 mt-2">
            Give your companion a name and identity — or let fate decide.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* Surprise Me Button + Next Button after generation */}
          <div className="flex gap-3">
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex-1"
              layout
            >
              <Button
                type="button"
                size="lg"
                onClick={handleSurpriseMe}
                disabled={isGenerating}
                className="relative w-full h-16 rounded-2xl bg-gradient-to-r from-vibes-hot via-vibes-neon to-vibes-cyan text-white font-bold text-lg shadow-[0_0_30px_rgba(168,85,247,0.3)] hover:shadow-[0_0_50px_rgba(168,85,247,0.5)] transition-all overflow-hidden group"
              >
                {/* Animated shimmer effect */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  initial={{ x: '-100%' }}
                  animate={isGenerating ? { x: '100%' } : { x: '-100%' }}
                  transition={isGenerating ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
                />

                <span className="relative flex items-center justify-center gap-3">
                  {isGenerating ? (
                    <>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                      >
                        <Sparkles className="h-6 w-6" />
                      </motion.div>
                      Conjuring...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-6 w-6 group-hover:rotate-12 transition-transform" />
                      Surprise Me
                    </>
                  )}
                </span>
              </Button>
            </motion.div>

            <AnimatePresence>
              {hasGenerated && !isGenerating && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: 'auto' }}
                  exit={{ opacity: 0, scale: 0.8, width: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                >
                  <Button
                    type="submit"
                    size="lg"
                    className="group h-16 px-8 rounded-2xl bg-gradient-to-r from-vibes-electric to-vibes-cyan hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-lg whitespace-nowrap"
                  >
                    Next: Visuals
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative flex items-center gap-4 py-2">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <span className="text-xs font-bold tracking-widest uppercase text-gray-500">or customize</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>

          <div className="space-y-3">
            <Label htmlFor="name" className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              Name
            </Label>
            <motion.div
              animate={justGenerated ? getInputAnimation(0) : {}}
              className="rounded-lg"
            >
              <Input
                id="name"
                placeholder="e.g. Atlas, Luna, Jarvis..."
                {...register('name')}
                className="bg-white/[0.03] border-white/10 h-14 md:h-16 text-lg md:text-xl focus:ring-vibes-neon focus:border-vibes-neon font-sans transition-all"
              />
            </motion.div>
            {errors.name && (
              <p className="text-sm text-vibes-hot font-medium">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-3">
            <Label htmlFor="pronouns" className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              Pronouns
            </Label>
            <motion.div
              animate={justGenerated ? getInputAnimation(0.15) : {}}
              className="rounded-lg"
            >
              <Input
                id="pronouns"
                placeholder="e.g. they/them, she/her..."
                {...register('pronouns')}
                className="bg-white/[0.03] border-white/10 h-14 md:h-16 text-lg md:text-xl focus:ring-vibes-cyan focus:border-vibes-cyan transition-all"
              />
            </motion.div>
            {errors.pronouns && (
              <p className="text-sm text-vibes-hot font-medium">{errors.pronouns.message}</p>
            )}
          </div>

          <div className="space-y-3">
            <Label htmlFor="backstory" className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              Backstory (Optional)
            </Label>
            <motion.div
              animate={justGenerated ? getInputAnimation(0.3) : {}}
              className="rounded-lg"
            >
              <Textarea
                id="backstory"
                placeholder="Briefly describe who they are... (e.g. A digital librarian from the 22nd century)"
                {...register('backstory')}
                className="min-h-[120px] md:min-h-[180px] lg:min-h-[220px] bg-white/[0.03] border-white/10 text-lg md:text-xl focus:ring-vibes-electric focus:border-vibes-electric transition-all scrollbar-subtle"
              />
            </motion.div>
          </div>

          <AnimatePresence>
            {!hasGenerated && (
              <motion.div
                className="pt-6 flex justify-end"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Button
                    type="submit"
                    size="lg"
                    disabled={!isValid}
                    className="group h-14 px-10 rounded-full bg-gradient-to-r from-vibes-electric to-vibes-cyan hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-lg"
                  >
                    Next: Visuals
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </CardContent>
    </Card>
  );
}
