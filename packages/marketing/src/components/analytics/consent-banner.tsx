'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePostHog } from 'posthog-js/react';

const CONSENT_COOKIE_NAME = 'campfire_consent';

type ConsentStatus = 'pending' | 'accepted' | 'rejected';

export function ConsentBanner() {
  const [consentStatus, setConsentStatus] = React.useState<ConsentStatus>('pending');
  const [isVisible, setIsVisible] = React.useState(false);
  const posthog = usePostHog();

  React.useEffect(() => {
    const stored = localStorage.getItem(CONSENT_COOKIE_NAME);
    if (stored === 'accepted' || stored === 'rejected') {
      setConsentStatus(stored);
    } else {
      // Show banner after a short delay
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(CONSENT_COOKIE_NAME, 'accepted');
    setConsentStatus('accepted');
    setIsVisible(false);

    // Enable tracking
    if (posthog) {
      posthog.opt_in_capturing();
      posthog.capture('mkt.consent_accepted');
    }

    // Push to GTM dataLayer
    if (typeof window !== 'undefined' && window.dataLayer) {
      window.dataLayer.push({
        event: 'consent_accepted',
        consent: {
          analytics: true,
          marketing: true,
        },
      });
    }
  };

  const handleReject = () => {
    localStorage.setItem(CONSENT_COOKIE_NAME, 'rejected');
    setConsentStatus('rejected');
    setIsVisible(false);

    // Disable tracking
    if (posthog) {
      posthog.opt_out_capturing();
    }

    // Push to GTM dataLayer
    if (typeof window !== 'undefined' && window.dataLayer) {
      window.dataLayer.push({
        event: 'consent_rejected',
        consent: {
          analytics: false,
          marketing: false,
        },
      });
    }
  };

  if (consentStatus !== 'pending') {
    return null;
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50"
        >
          <div className="bg-surface border border-border rounded-xl shadow-elevation-5 p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-text-primary">
                  We value your privacy
                </h3>
                <p className="mt-1 text-xs text-text-secondary">
                  We use cookies to improve your experience, analyze site traffic, and
                  personalize content. You can manage your preferences at any time.
                </p>
              </div>
              <button
                onClick={handleReject}
                className="text-text-tertiary hover:text-text-primary transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" onClick={handleReject} className="flex-1">
                Reject All
              </Button>
              <Button size="sm" onClick={handleAccept} className="flex-1">
                Accept All
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}
