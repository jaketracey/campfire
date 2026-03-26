'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { generateRandomIdentity } from '@/lib/api/companions';

export type Pronouns = 'she/her' | 'he/him' | 'they/them';

interface StepNameInputProps {
  /** The currently selected name (may be empty). */
  name: string;
  /** Current pronoun selection. */
  pronouns: Pronouns;
  /** Called when the user types or the name is generated. */
  onNameChange: (name: string) => void;
  /** Called when the user switches pronouns. */
  onPronounsChange: (pronouns: Pronouns) => void;
  /** Called when the user clicks the "Let's meet" CTA. */
  onContinue: () => void;
}

const pronounOptions: { label: string; value: Pronouns }[] = [
  { label: 'She', value: 'she/her' },
  { label: 'He', value: 'he/him' },
  { label: 'They', value: 'they/them' },
];

export function StepNameInput({
  name,
  pronouns,
  onNameChange,
  onPronounsChange,
  onContinue,
}: StepNameInputProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  const handleSurpriseMe = useCallback(async () => {
    setIsGenerating(true);
    try {
      const identity = await generateRandomIdentity();
      onNameChange(identity.name);
      // Infer gender from the generated identity
      if (identity.pronouns.includes('she')) {
        onPronounsChange('she/her');
      } else if (identity.pronouns.includes('he')) {
        onPronounsChange('he/him');
      } else {
        onPronounsChange('they/them');
      }
    } catch {
      // Silently fail -- user can just type a name instead.
    } finally {
      setIsGenerating(false);
    }
  }, [onNameChange, onPronounsChange]);

  const isValid = name.trim().length >= 2;

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-md mx-auto" data-testid="step-name-input">
      {/* Heading */}
      <motion.div
        className="text-center space-y-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight font-display">
          Give them a name
        </h2>
        <p className="text-sm text-gray-400">
          Or let us pick one for you.
        </p>
      </motion.div>

      {/* Name input */}
      <motion.div
        className="w-full space-y-5"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
      >
        <div className="relative">
          <Input
            ref={inputRef}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isValid) onContinue();
            }}
            placeholder="What's their name?"
            maxLength={30}
            className="w-full text-center text-2xl sm:text-3xl font-medium bg-white/5 border-white/10 text-white placeholder:text-gray-600 h-16 rounded-xl focus-visible:ring-white/30"
            data-testid="name-input"
          />
        </div>

        {/* Gender toggle */}
        <div className="flex justify-center gap-2">
          {pronounOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPronounsChange(opt.value)}
              className={`
                px-5 py-2 rounded-full text-sm font-medium transition-all duration-200
                ${
                  pronouns === opt.value
                    ? 'bg-white/15 text-white border border-white/30'
                    : 'bg-white/5 text-gray-500 border border-transparent hover:text-gray-300 hover:bg-white/8'
                }
              `}
              data-testid={`pronoun-${opt.value.replace('/', '-')}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Surprise me */}
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleSurpriseMe}
            disabled={isGenerating}
            className="text-gray-400 hover:text-white gap-2"
            data-testid="surprise-me-btn"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Surprise me
          </Button>
        </div>
      </motion.div>

      {/* CTA */}
      <AnimatePresence>
        {isValid && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3 }}
          >
            <Button
              size="lg"
              onClick={onContinue}
              className="group text-lg px-10 py-7 rounded-full bg-gradient-to-r from-vibes-hot via-vibes-neon to-vibes-electric hover:shadow-[0_0_50px_rgba(168,85,247,0.5)] transition-all duration-300 hover:scale-105 active:scale-95"
              data-testid="continue-btn"
            >
              Let&apos;s meet {name.trim()}
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
