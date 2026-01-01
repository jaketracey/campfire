'use client';

import { motion } from 'framer-motion';
import { SectionHeader } from '@/components/layout/section-header';
import { Badge } from '@/components/ui/badge';

const changes = [
  {
    version: '2.0.0',
    date: 'January 1, 2026',
    title: 'Campfire 2.0: The New Era of AI Companions',
    description: 'We have completely rebuilt Campfire from the ground up to support voice-first, multimodal interactions with improved latency and memory.',
    features: [
      'Real-time voice conversations with ultra-low latency',
      'Multimodal capabilities: send images to your companion',
      'New "Obsidian-style" vault for memory storage',
      'Enhanced knowledge graph for better context retention',
      'Stripe integration for seamless billing',
    ],
    type: 'major',
  },
  {
    version: '1.5.0',
    date: 'December 15, 2025',
    title: 'Performance Improvements & Bug Fixes',
    description: 'A focus on stability and performance before the big 2.0 release.',
    features: [
      'Optimized database queries for faster response times',
      'Fixed issues with avatar generation consistency',
      'Improved mobile responsiveness for the dashboard',
    ],
    type: 'patch',
  },
  {
    version: '1.4.0',
    date: 'November 20, 2025',
    title: 'Introducing Custom Voices',
    description: 'You can now upload voice samples to create custom voices for your companions.',
    features: [
      'Voice cloning tool (Beta)',
      'New preset voices added',
      'Audio quality settings',
    ],
    type: 'minor',
  },
];

export default function ChangelogPage() {
  return (
    <div className="container py-24 md:py-32 max-w-4xl mx-auto">
      <SectionHeader
        title="Changelog"
        description="Stay up to date with the latest features, improvements, and fixes."
        className="mb-16"
      />

      <div className="space-y-12">
        {changes.map((change, index) => (
          <motion.div
            key={change.version}
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
            className="relative pl-8 border-l border-border"
          >
            {/* Timeline dot */}
            <div className="absolute -left-[5px] top-2 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-surface" />

            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
              <h3 className="text-2xl font-bold">{change.title}</h3>
              <div className="flex items-center gap-2">
                <Badge variant={change.type === 'major' ? 'default' : 'secondary'}>
                  v{change.version}
                </Badge>
                <span className="text-sm text-muted-foreground">{change.date}</span>
              </div>
            </div>

            <p className="text-muted-foreground mb-6 text-lg">
              {change.description}
            </p>

            <ul className="space-y-2">
              {change.features.map((feature, i) => (
                <li key={i} className="flex items-start gap-2 text-text-secondary">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-text-tertiary shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
