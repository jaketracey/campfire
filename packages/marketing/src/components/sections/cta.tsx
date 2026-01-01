'use client';

import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { siteConfig } from '@/lib/constants';
import { trackEvent } from '@/lib/analytics';

export function CTA() {
  return (
    <section className="section-padding-lg bg-surface relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-grid opacity-50" />
      <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-surface" />

      {/* Glow effects */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-500/10 rounded-full blur-3xl" />

      <div className="container-marketing relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="relative max-w-4xl mx-auto text-center"
        >
          {/* Card */}
          <div className="rounded-3xl border border-brand-500/20 bg-surface/80 backdrop-blur-xl p-8 sm:p-12 lg:p-16 shadow-glow">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-brand-500/10 mb-6">
              <Sparkles className="h-7 w-7 text-brand-500" />
            </div>

            <h2 className="text-display-sm sm:text-display-md lg:text-display-lg font-display text-text-primary">
              Ready to meet your companion?
            </h2>

            <p className="mt-4 text-lg text-text-secondary max-w-2xl mx-auto">
              Design your perfect AI companion in minutes. Start talking, start connecting,
              start a relationship that grows with you.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                size="xl"
                asChild
                onClick={() => trackEvent.ctaClick('get-started', 'cta-section')}
              >
                <Link href={`${siteConfig.appUrl}/onboard`}>
                  Create Your Companion
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button
                size="xl"
                variant="outline"
                asChild
                onClick={() => trackEvent.ctaClick('learn-more', 'cta-section')}
              >
                <Link href="/#features">Learn More</Link>
              </Button>
            </div>

            <p className="mt-6 text-sm text-text-tertiary">
              Free to start. 30 voice minutes included. No credit card required.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
