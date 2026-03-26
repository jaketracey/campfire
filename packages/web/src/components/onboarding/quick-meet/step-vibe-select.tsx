'use client';

import { motion } from 'framer-motion';
import { VIBE_PRESETS, type VibePreset } from './vibe-presets';

interface StepVibeSelectProps {
  onSelect: (preset: VibePreset) => void;
  onDesignOwn: () => void;
}

const cardVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: 0.1 + i * 0.1,
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
};

export function StepVibeSelect({ onSelect, onDesignOwn }: StepVibeSelectProps) {
  return (
    <div className="flex flex-col items-center gap-8" data-testid="step-vibe-select">
      {/* Heading */}
      <motion.div
        className="text-center space-y-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight font-display">
          Who do you want to meet?
        </h2>
        <p className="text-base text-gray-400 max-w-md mx-auto">
          Pick a vibe. You can always customize later.
        </p>
      </motion.div>

      {/* Vibe cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 w-full max-w-2xl">
        {VIBE_PRESETS.map((preset, i) => (
          <VibeCard key={preset.id} preset={preset} index={i} onSelect={onSelect} />
        ))}
      </div>

      {/* Design your own link */}
      <motion.button
        type="button"
        onClick={onDesignOwn}
        className="text-sm text-gray-500 hover:text-white transition-colors duration-200 underline underline-offset-4 decoration-gray-700 hover:decoration-gray-400"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        data-testid="design-own-link"
      >
        I&apos;ll design my own &rarr;
      </motion.button>
    </div>
  );
}

function VibeCard({
  preset,
  index,
  onSelect,
}: {
  preset: VibePreset;
  index: number;
  onSelect: (preset: VibePreset) => void;
}) {
  return (
    <motion.button
      type="button"
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover={{ scale: 1.04, y: -4 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onSelect(preset)}
      className={`
        relative group flex flex-col items-center text-center gap-3 p-6 sm:p-7
        rounded-2xl border border-white/10
        bg-gradient-to-br ${preset.gradient}
        backdrop-blur-sm
        hover:border-white/25
        transition-colors duration-300
        cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50
      `}
      style={{
        boxShadow: `0 0 60px ${preset.glowColor}`,
      }}
      data-testid={`vibe-card-${preset.id}`}
    >
      {/* Icon */}
      <span className="text-4xl sm:text-5xl" role="img" aria-hidden="true">
        {preset.icon}
      </span>

      {/* Name */}
      <h3 className="text-lg sm:text-xl font-semibold text-white tracking-tight">
        {preset.name}
      </h3>

      {/* Tagline */}
      <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
        {preset.tagline}
      </p>

      {/* Subtle hover glow */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${preset.glowColor}, transparent 70%)`,
        }}
      />
    </motion.button>
  );
}
