'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackEvent, trackCustomEvent } from '@/lib/analytics/meta-pixel';

interface HeroSectionProps {
  affiliateCode?: string | null;
}

export function HeroSection({ affiliateCode }: HeroSectionProps) {
  const applyUrl = affiliateCode
    ? (`/tenants/apply?aff=${affiliateCode}` as Route)
    : ('/tenants/apply' as Route);

  const handleCTAClick = () => {
    trackEvent('Lead', { content_name: 'partner_hero_cta' });
    trackCustomEvent('PartnerCTAClick', { location: 'hero' });
  };

  return (
    <section className="relative py-16 md:py-24 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-campfire-500/10 to-transparent pointer-events-none" />

      <div className="relative max-w-5xl mx-auto px-4">
        <div className="flex flex-col items-center text-center gap-8">
          {/* Trust badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-campfire-500/10 border border-campfire-500/20">
            <Rocket className="h-4 w-4 text-campfire-500" />
            <span className="text-sm font-medium text-campfire-400">500+ partners earning with us</span>
          </div>

          {/* Main headline */}
          <div className="space-y-4 max-w-3xl">
            <h1 className="text-4xl md:text-6xl font-bold font-display text-white leading-tight">
              Launch Your Own AI Girlfriend Platform in 24 Hours
            </h1>
            <p className="text-xl md:text-2xl text-gray-300">
              Zero code. Your brand. 40-60% revenue share.
            </p>
          </div>

          {/* Trust indicators */}
          <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-400">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span>$2.4M+ paid to partners</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span>24hr average launch time</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span>No upfront costs</span>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            <Link href={applyUrl} onClick={handleCTAClick}>
              <Button size="lg" className="w-full sm:w-auto bg-campfire-500 hover:bg-campfire-600 text-lg px-8 py-6">
                Start Your Platform
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
            <a href="#calculator">
              <Button size="lg" variant="outline" className="w-full sm:w-auto border-white/10 hover:bg-white/10 text-lg px-8 py-6">
                See Your Earnings
              </Button>
            </a>
          </div>

          {/* Subtext */}
          <p className="text-sm text-gray-500">
            Free to apply. No credit card required.
          </p>
        </div>
      </div>
    </section>
  );
}
