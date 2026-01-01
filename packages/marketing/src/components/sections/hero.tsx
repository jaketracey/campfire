'use client';

import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Play, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HeroVisualizer } from '@/components/ui/hero-visualizer';
import { siteConfig } from '@/lib/constants';
import { trackEvent } from '@/lib/analytics';

export function Hero() {
  const handleCtaClick = (cta: string) => {
    trackEvent.ctaClick(cta, 'hero');
  };

  return (
    <section className="relative overflow-hidden bg-surface">
      {/* Background */}
      <div className="absolute inset-0 bg-grid" />
      <HeroVisualizer />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface/50 to-surface" />

      {/* Glow effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-500/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-brand-400/10 rounded-full blur-3xl" />

      <div className="container-marketing relative section-padding-lg">
        <div className="mx-auto max-w-4xl text-center">
          {/* Announcement badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Link
              href="/changelog"
              className="group inline-flex items-center gap-2 rounded-full bg-surface-secondary border border-border px-4 py-1.5 text-sm text-text-secondary hover:border-brand-500/50 hover:bg-surface-tertiary transition-all"
              onClick={() => handleCtaClick('announcement')}
            >
              <Sparkles className="h-4 w-4 text-brand-500" />
              <span>Now with real-time voice</span>
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-8 text-display-lg sm:text-display-xl lg:text-display-2xl font-display text-text-primary text-balance"
          >
            Your AI companion,{' '}
            <span className="gradient-text">your way</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-6 text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto text-pretty"
          >
            Design a companion with the personality, voice, and look you want.
            Talk naturally, build real memories, and experience AI that truly knows you.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Button size="xl" asChild onClick={() => handleCtaClick('get-started')}>
              <Link href={`${siteConfig.appUrl}/onboard`}>
                Create Your Companion
                <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
            <Button
              size="xl"
              variant="outline"
              onClick={() => handleCtaClick('watch-demo')}
            >
              <Play className="h-5 w-5" />
              See It In Action
            </Button>
          </motion.div>

          {/* Social proof */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-6 text-sm text-text-tertiary"
          >
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-8 w-8 rounded-full bg-surface-tertiary border-2 border-surface"
                  />
                ))}
              </div>
              <span>50,000+ companions created</span>
            </div>
            <div className="hidden sm:block h-4 w-px bg-border" />
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <svg
                  key={i}
                  className="h-4 w-4 text-warning-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
              <span className="ml-1">4.9/5 rating</span>
            </div>
          </motion.div>
        </div>

        {/* Hero image / Interactive demo placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="mt-16 relative"
        >
          <div className="relative mx-auto max-w-5xl">
            {/* Browser chrome */}
            <div className="rounded-xl border border-border bg-surface-secondary shadow-elevation-5 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface-tertiary">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-error-400" />
                  <div className="h-3 w-3 rounded-full bg-warning-400" />
                  <div className="h-3 w-3 rounded-full bg-success-400" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="px-3 py-1 rounded bg-surface text-xs text-text-tertiary font-mono">
                    app.campfire.dev
                  </div>
                </div>
              </div>
              {/* Demo content placeholder */}
              <div className="aspect-[16/10] bg-surface-secondary p-8 flex items-center justify-center">
                <div className="text-center text-text-tertiary">
                  <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-500/10 mb-4">
                    <Sparkles className="h-8 w-8 text-brand-500" />
                  </div>
                  <p className="text-lg font-medium text-text-secondary">Meet Your Companion</p>
                  <p className="mt-1 text-sm">Voice conversation demo coming soon</p>
                </div>
              </div>
            </div>

            {/* Glow behind */}
            <div className="absolute -inset-4 -z-10 bg-gradient-to-r from-brand-500/20 via-brand-400/10 to-brand-500/20 rounded-2xl blur-2xl" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
