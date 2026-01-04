'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';

const WELCOME_FLAG_KEY = 'campfire-welcome-transition';

export interface WelcomeTransitionData {
  type: 'signup' | 'login';
  provider?: 'google' | 'email';
  timestamp: number;
}

/**
 * Set the welcome transition flag before redirecting
 */
export function setWelcomeTransition(data: Omit<WelcomeTransitionData, 'timestamp'>) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(
    WELCOME_FLAG_KEY,
    JSON.stringify({ ...data, timestamp: Date.now() })
  );
}

/**
 * Check and clear the welcome transition flag
 */
function getAndClearWelcomeTransition(): WelcomeTransitionData | null {
  if (typeof window === 'undefined') return null;

  const stored = sessionStorage.getItem(WELCOME_FLAG_KEY);
  if (!stored) return null;

  sessionStorage.removeItem(WELCOME_FLAG_KEY);

  try {
    const data = JSON.parse(stored) as WelcomeTransitionData;
    // Only show if the flag was set within the last 10 seconds
    if (Date.now() - data.timestamp > 10000) return null;
    return data;
  } catch {
    return null;
  }
}

interface WelcomeTransitionProps {
  children: React.ReactNode;
}

export function WelcomeTransition({ children }: WelcomeTransitionProps) {
  const [transitionData, setTransitionData] = useState<WelcomeTransitionData | null>(null);
  const [phase, setPhase] = useState<'initial' | 'message' | 'reveal' | 'done'>('initial');

  useEffect(() => {
    const data = getAndClearWelcomeTransition();
    if (data) {
      setTransitionData(data);
      setPhase('message');

      // Show message for 2 seconds, then reveal
      const messageTimer = setTimeout(() => setPhase('reveal'), 2000);
      // Complete after reveal animation
      const doneTimer = setTimeout(() => setPhase('done'), 3200);

      return () => {
        clearTimeout(messageTimer);
        clearTimeout(doneTimer);
      };
    } else {
      setPhase('done');
    }
  }, []);

  // No transition needed
  if (phase === 'done' && !transitionData) {
    return <>{children}</>;
  }

  const getMessage = () => {
    if (!transitionData) return { title: '', subtitle: '' };

    if (transitionData.type === 'signup') {
      return {
        title: 'Welcome to Ignite',
        subtitle: 'Let\'s spark something special',
      };
    }
    return {
      title: 'Welcome back',
      subtitle: 'Your companions missed you',
    };
  };

  const { title, subtitle } = getMessage();

  return (
    <>
      {/* The actual page content - hidden during transition, then revealed */}
      <motion.div
        initial={transitionData ? { opacity: 0 } : { opacity: 1 }}
        animate={{
          opacity: phase === 'reveal' || phase === 'done' ? 1 : 0,
        }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>

      {/* Overlay */}
      <AnimatePresence>
        {phase !== 'done' && transitionData && (
          <motion.div
            className="fixed inset-0 z-[100] pointer-events-none"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Black background with bottom gradient */}
            <div className="absolute inset-0 bg-black" />
            <div className="absolute inset-0 bg-gradient-to-t from-campfire-950/50 via-transparent to-transparent" />

            {/* Ambient glow */}
            <motion.div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full"
              style={{
                background:
                  'radial-gradient(ellipse at center, rgba(234,88,12,0.15) 0%, rgba(234,88,12,0.05) 40%, transparent 70%)',
                filter: 'blur(60px)',
              }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
            />

            {/* Content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
              {/* Sparkle icon */}
              <motion.div
                initial={{ opacity: 0, scale: 0.5, y: 20 }}
                animate={{
                  opacity: phase === 'message' ? 1 : 0,
                  scale: phase === 'message' ? 1 : 0.5,
                  y: phase === 'message' ? 0 : 20,
                }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="mb-8"
              >
                <div className="relative">
                  <div className="absolute inset-0 blur-xl bg-campfire-500/30 rounded-full" />
                  <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-campfire-500 to-campfire-600 flex items-center justify-center shadow-[0_0_40px_rgba(234,88,12,0.4)]">
                    <Sparkles className="h-8 w-8 text-white" />
                  </div>
                </div>
              </motion.div>

              {/* Title */}
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{
                  opacity: phase === 'message' ? 1 : 0,
                  y: phase === 'message' ? 0 : phase === 'reveal' ? -20 : 30,
                }}
                transition={{
                  duration: 0.8,
                  delay: phase === 'message' ? 0.2 : 0,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="text-4xl md:text-6xl font-bold font-display text-white text-center mb-4"
              >
                {title}
              </motion.h1>

              {/* Subtitle */}
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{
                  opacity: phase === 'message' ? 1 : 0,
                  y: phase === 'message' ? 0 : phase === 'reveal' ? -10 : 20,
                }}
                transition={{
                  duration: 0.8,
                  delay: phase === 'message' ? 0.4 : 0,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="text-xl md:text-2xl text-white/60 text-center"
              >
                {subtitle}
              </motion.p>

              {/* Animated line */}
              <motion.div
                className="mt-12 h-[2px] bg-gradient-to-r from-transparent via-campfire-500 to-transparent"
                initial={{ width: 0, opacity: 0 }}
                animate={{
                  width: phase === 'message' ? 200 : 0,
                  opacity: phase === 'message' ? 1 : 0,
                }}
                transition={{
                  duration: 1,
                  delay: phase === 'message' ? 0.6 : 0,
                  ease: [0.22, 1, 0.36, 1],
                }}
              />
            </div>

            {/* Bottom gradient fade for reveal */}
            <motion.div
              className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black"
              initial={{ opacity: 0 }}
              animate={{ opacity: phase === 'reveal' ? 1 : 0 }}
              transition={{ duration: 0.5 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
