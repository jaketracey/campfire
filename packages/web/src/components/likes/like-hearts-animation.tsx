'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface LikeHeartsAnimationProps {
  trigger: number; // increment to trigger animation
}

interface HeartParticle {
  id: number;
  x: number;
  scale: number;
  color: string;
  delay: number;
}

const heartColors = ['#ff6b6b', '#ff8787', '#ffa8a8', '#ff5252'];
const ANIMATION_DURATION = 1.2;
const PARTICLE_COUNT = 4;

function generateHearts(): HeartParticle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    x: 20 + Math.random() * 60, // 20-80% horizontal spread
    scale: 0.6 + Math.random() * 0.4, // 0.6-1.0 scale
    color: heartColors[Math.floor(Math.random() * heartColors.length)],
    delay: Math.random() * 0.2, // 0-0.2s stagger
  }));
}

export function LikeHeartsAnimation({ trigger }: LikeHeartsAnimationProps) {
  const [hearts, setHearts] = useState<HeartParticle[]>([]);
  const [animationKey, setAnimationKey] = useState(0);

  useEffect(() => {
    if (trigger > 0) {
      setHearts(generateHearts());
      setAnimationKey((prev) => prev + 1);
    }
  }, [trigger]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
      <AnimatePresence mode="wait">
        {hearts.length > 0 && (
          <div key={animationKey} className="absolute inset-0">
            {hearts.map((heart) => (
              <motion.div
                key={heart.id}
                className="absolute text-lg pointer-events-none"
                style={{
                  left: `${heart.x}%`,
                  color: heart.color,
                }}
                initial={{ y: '100%', opacity: 0, scale: 0 }}
                animate={{
                  y: '-20%',
                  opacity: [0, 1, 1, 0],
                  scale: [0, heart.scale, heart.scale, heart.scale * 0.5],
                  x: [(Math.random() - 0.5) * 30],
                }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: ANIMATION_DURATION,
                  delay: heart.delay,
                  ease: 'easeOut',
                }}
              >
                ❤️
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
