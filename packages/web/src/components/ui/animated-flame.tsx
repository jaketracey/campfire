'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AnimatedFlameProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

export function AnimatedFlame({ className, size = 'md' }: AnimatedFlameProps) {
  const [flameAnimation, setFlameAnimation] = useState({});

  useEffect(() => {
    const animations = [
      { scale: [1, 1.15, 1], transition: { duration: 0.4 } },
      { rotate: [0, -8, 8, -4, 0], transition: { duration: 0.5 } },
      { y: [0, -3, 0], transition: { duration: 0.3 } },
      { filter: ['brightness(1)', 'brightness(1.4)', 'brightness(1)'], transition: { duration: 0.6 } },
    ];

    let timeoutId: NodeJS.Timeout;

    const scheduleNext = () => {
      const delay = 30000 + Math.random() * 60000;
      timeoutId = setTimeout(() => {
        const animation = animations[Math.floor(Math.random() * animations.length)];
        setFlameAnimation(animation);
        setTimeout(() => setFlameAnimation({}), 700);
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <motion.div animate={flameAnimation}>
      <Flame className={cn(sizeClasses[size], 'text-campfire-500', className)} />
    </motion.div>
  );
}
