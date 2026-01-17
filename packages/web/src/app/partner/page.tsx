'use client';

import { useEffect } from 'react';
import { trackEvent, trackCustomEvent } from '@/lib/analytics/meta-pixel';
import { usePartnerAffiliate } from '@/hooks/use-partner-affiliate';
import { HeroSection } from './components/hero-section';
import { ValueProps } from './components/value-props';
import { IncomeCalculator } from './components/income-calculator';
import { HowItWorks } from './components/how-it-works';
import { FeaturesGrid } from './components/features-grid';
import { SocialProof } from './components/social-proof';
import { FAQSection } from './components/faq-section';
import { FinalCTA } from './components/final-cta';
import { FloatingCTA } from './components/floating-cta';

export default function PartnerLandingPage() {
  const { affiliateCode } = usePartnerAffiliate();

  useEffect(() => {
    // Track page view on mount
    trackEvent('ViewContent', {
      content_type: 'partner_landing',
      content_name: 'Partner Landing Page',
    });
    trackCustomEvent('PartnerPageView', {
      source: new URLSearchParams(window.location.search).get('utm_source') || undefined,
      affiliate_code: affiliateCode || undefined,
    });
  }, [affiliateCode]);

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <HeroSection affiliateCode={affiliateCode} />
      <ValueProps />
      <IncomeCalculator affiliateCode={affiliateCode} />
      <HowItWorks />
      <FeaturesGrid />
      <SocialProof />
      <FAQSection />
      <FinalCTA affiliateCode={affiliateCode} />
      <FloatingCTA affiliateCode={affiliateCode} />
    </div>
  );
}
