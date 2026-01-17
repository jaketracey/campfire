'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackEvent, trackCustomEvent } from '@/lib/analytics/meta-pixel';

interface FloatingCTAProps {
  affiliateCode?: string | null;
}

export function FloatingCTA({ affiliateCode }: FloatingCTAProps) {
  const [isVisible, setIsVisible] = useState(false);

  const applyUrl = affiliateCode
    ? (`/tenants/apply?aff=${affiliateCode}` as Route)
    : ('/tenants/apply' as Route);

  useEffect(() => {
    const handleScroll = () => {
      // Show after scrolling 500px
      setIsVisible(window.scrollY > 500);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleCTAClick = () => {
    trackEvent('Lead', { content_name: 'partner_floating_cta' });
    trackCustomEvent('PartnerCTAClick', { location: 'floating' });
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      <div className="bg-black/95 backdrop-blur-lg border-t border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-white font-medium text-sm truncate">
              Launch Your Platform
            </div>
            <div className="text-xs text-gray-400">
              Free to apply
            </div>
          </div>
          <Link href={applyUrl} onClick={handleCTAClick}>
            <Button className="bg-campfire-500 hover:bg-campfire-600 shrink-0">
              Apply Now
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
