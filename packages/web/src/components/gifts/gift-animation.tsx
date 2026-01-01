'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

export type GiftAnimationType = 'hearts' | 'sparkles' | 'confetti' | 'glow';

interface GiftAnimationProps {
  type: GiftAnimationType;
  isPlaying: boolean;
  onComplete?: () => void;
  className?: string;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  color: string;
  emoji?: string;
}

const ANIMATION_DURATION = 2000; // 2 seconds

const heartColors = ['#ff6b6b', '#ff8787', '#ffa8a8', '#ff5252', '#e74c3c'];
const sparkleColors = ['#ffd700', '#ffec8b', '#fff8dc', '#ffc107', '#ff9800'];
const confettiColors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96e6a1', '#dda0dd', '#f39c12'];

function generateParticles(type: GiftAnimationType, count: number): Particle[] {
  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    const particle: Particle = {
      id: i,
      x: Math.random() * 100,
      y: type === 'confetti' ? -10 : 50 + (Math.random() - 0.5) * 40,
      rotation: Math.random() * 360,
      scale: 0.5 + Math.random() * 0.5,
      color: '',
    };

    switch (type) {
      case 'hearts':
        particle.color = heartColors[Math.floor(Math.random() * heartColors.length)];
        particle.emoji = '❤️';
        break;
      case 'sparkles':
        particle.color = sparkleColors[Math.floor(Math.random() * sparkleColors.length)];
        particle.emoji = '✨';
        break;
      case 'confetti':
        particle.color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        break;
      case 'glow':
        particle.color = sparkleColors[Math.floor(Math.random() * sparkleColors.length)];
        break;
    }

    particles.push(particle);
  }

  return particles;
}

function HeartsAnimation({ isPlaying }: { isPlaying: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (isPlaying) {
      setParticles(generateParticles('hearts', 12));
    }
  }, [isPlaying]);

  return (
    <AnimatePresence>
      {isPlaying &&
        particles.map((p) => (
          <motion.div
            key={p.id}
            className="absolute pointer-events-none text-2xl"
            style={{ left: `${p.x}%` }}
            initial={{ y: '100%', opacity: 0, scale: 0 }}
            animate={{
              y: '-100%',
              opacity: [0, 1, 1, 0],
              scale: [0, p.scale, p.scale, p.scale * 0.5],
              x: [0, (Math.random() - 0.5) * 50],
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: ANIMATION_DURATION / 1000,
              delay: Math.random() * 0.5,
              ease: 'easeOut',
            }}
          >
            {p.emoji}
          </motion.div>
        ))}
    </AnimatePresence>
  );
}

function SparklesAnimation({ isPlaying }: { isPlaying: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (isPlaying) {
      setParticles(generateParticles('sparkles', 15));
    }
  }, [isPlaying]);

  return (
    <AnimatePresence>
      {isPlaying &&
        particles.map((p) => (
          <motion.div
            key={p.id}
            className="absolute pointer-events-none text-xl"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            initial={{ opacity: 0, scale: 0, rotate: 0 }}
            animate={{
              opacity: [0, 1, 1, 0],
              scale: [0, p.scale * 1.5, p.scale, 0],
              rotate: [0, p.rotation],
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: ANIMATION_DURATION / 1000,
              delay: Math.random() * 0.3,
              ease: 'easeOut',
            }}
          >
            {p.emoji}
          </motion.div>
        ))}
    </AnimatePresence>
  );
}

function ConfettiAnimation({ isPlaying }: { isPlaying: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (isPlaying) {
      setParticles(generateParticles('confetti', 30));
    }
  }, [isPlaying]);

  return (
    <AnimatePresence>
      {isPlaying &&
        particles.map((p) => (
          <motion.div
            key={p.id}
            className="absolute pointer-events-none w-2 h-2 rounded-sm"
            style={{
              left: `${p.x}%`,
              backgroundColor: p.color,
            }}
            initial={{ y: -20, opacity: 1, rotate: 0 }}
            animate={{
              y: '120%',
              opacity: [1, 1, 0],
              rotate: p.rotation * 3,
              x: [0, (Math.random() - 0.5) * 100],
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: ANIMATION_DURATION / 1000 + Math.random() * 0.5,
              delay: Math.random() * 0.3,
              ease: 'easeIn',
            }}
          />
        ))}
    </AnimatePresence>
  );
}

function GlowAnimation({ isPlaying }: { isPlaying: boolean }) {
  return (
    <AnimatePresence>
      {isPlaying && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.6, 0.3, 0.6, 0] }}
          exit={{ opacity: 0 }}
          transition={{
            duration: ANIMATION_DURATION / 1000,
            ease: 'easeInOut',
          }}
        >
          <div className="absolute inset-0 bg-gradient-radial from-amber-400/40 via-amber-300/20 to-transparent" />
          <motion.div
            className="absolute inset-0 bg-gradient-radial from-white/30 to-transparent"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.5, 0.8, 0.5],
            }}
            transition={{
              duration: 0.5,
              repeat: 3,
              ease: 'easeInOut',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function GiftAnimation({
  type,
  isPlaying,
  onComplete,
  className,
}: GiftAnimationProps) {
  const handleComplete = useCallback(() => {
    if (onComplete) {
      setTimeout(onComplete, ANIMATION_DURATION);
    }
  }, [onComplete]);

  useEffect(() => {
    if (isPlaying) {
      handleComplete();
    }
  }, [isPlaying, handleComplete]);

  return (
    <div
      className={cn(
        'absolute inset-0 overflow-hidden pointer-events-none z-50',
        className
      )}
    >
      {type === 'hearts' && <HeartsAnimation isPlaying={isPlaying} />}
      {type === 'sparkles' && <SparklesAnimation isPlaying={isPlaying} />}
      {type === 'confetti' && <ConfettiAnimation isPlaying={isPlaying} />}
      {type === 'glow' && <GlowAnimation isPlaying={isPlaying} />}
    </div>
  );
}
