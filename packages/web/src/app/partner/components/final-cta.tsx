'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackEvent, trackCustomEvent } from '@/lib/analytics/meta-pixel';

interface FinalCTAProps {
  affiliateCode?: string | null;
}

const benefits = [
  'Free to apply',
  '40-60% revenue share',
  'Launch in 24 hours',
  'Full white-label branding',
];

export function FinalCTA({ affiliateCode }: FinalCTAProps) {
  const applyUrl = affiliateCode
    ? (`/tenants/apply?aff=${affiliateCode}` as Route)
    : ('/tenants/apply' as Route);

  const handleCTAClick = () => {
    trackEvent('Lead', { content_name: 'partner_final_cta' });
    trackCustomEvent('PartnerCTAClick', { location: 'final' });
  };

  return (
    <section className="py-20 px-4">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-3xl md:text-5xl font-bold font-display text-white mb-6">
          Ready to Start Earning?
        </h2>
        <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
          Join 500+ partners already earning with their own AI companion platform.
        </p>

        {/* Benefits list */}
        <div className="flex flex-wrap justify-center gap-4 mb-10">
          {benefits.map((benefit) => (
            <div
              key={benefit}
              className="flex items-center gap-2 text-sm text-gray-300"
            >
              <CheckCircle className="h-4 w-4 text-green-500" />
              {benefit}
            </div>
          ))}
        </div>

        {/* CTA */}
        <Link href={applyUrl} onClick={handleCTAClick}>
          <Button
            size="lg"
            className="bg-campfire-500 hover:bg-campfire-600 text-lg px-10 py-7"
          >
            Apply Now - It&apos;s Free
            <ArrowRight className="h-5 w-5 ml-2" />
          </Button>
        </Link>

        <p className="text-sm text-gray-500 mt-6">
          No credit card required. Most applications approved within 24 hours.
        </p>
      </div>
    </section>
  );
}
