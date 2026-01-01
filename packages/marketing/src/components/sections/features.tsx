'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  Mic,
  Sparkles,
  Brain,
  Image,
  Shield,
  Clock,
} from 'lucide-react';
import { features } from '@/lib/constants';
import { trackEvent } from '@/lib/analytics';

const iconMap = {
  mic: Mic,
  sparkles: Sparkles,
  brain: Brain,
  image: Image,
  shield: Shield,
  clock: Clock,
};

export function Features() {
  return (
    <section id="features" className="section-padding bg-surface-secondary">
      <div className="container-marketing">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto"
        >
          <h2 className="text-display-sm sm:text-display-md font-display text-text-primary">
            A companion designed around you
          </h2>
          <p className="mt-4 text-lg text-text-secondary text-pretty">
            More than a chatbot. A voice you can talk to, a personality you create,
            and a memory that grows with every conversation.
          </p>
        </motion.div>

        {/* Features grid */}
        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => {
            const Icon = iconMap[feature.icon as keyof typeof iconMap];

            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                onClick={() => trackEvent.featureClick(feature.title)}
                className="group relative rounded-2xl border border-border bg-surface p-6 transition-all duration-300 hover:border-brand-500/50 hover:shadow-elevation-3 cursor-pointer"
              >
                {/* Icon */}
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-brand-500/10 text-brand-500 transition-all duration-300 group-hover:bg-brand-500 group-hover:text-white">
                  <Icon className="h-6 w-6" />
                </div>

                {/* Content */}
                <h3 className="mt-4 text-lg font-semibold text-text-primary">
                  {feature.title}
                </h3>
                <p className="mt-2 text-text-secondary">
                  {feature.description}
                </p>

                {/* Hover glow */}
                <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-r from-brand-500/0 via-brand-500/5 to-brand-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
