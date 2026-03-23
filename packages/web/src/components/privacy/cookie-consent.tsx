'use client';

/**
 * Cookie Consent Component
 * Minimal, non-intrusive cookie consent that slides up from the bottom.
 * Stores consent in localStorage and only shows once per device.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const CONSENT_KEY = 'campfire-cookie-consent';
const CONSENT_VERSION = '1.0';

interface CookiePreferences {
  version: string;
  timestamp: string;
  essential: boolean; // Always true
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

const defaultPreferences: CookiePreferences = {
  version: CONSENT_VERSION,
  timestamp: new Date().toISOString(),
  essential: true,
  functional: true,
  analytics: false,
  marketing: false,
};

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>(defaultPreferences);

  useEffect(() => {
    // Check if consent already given
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as CookiePreferences;
        // Check if consent version matches
        if (parsed.version === CONSENT_VERSION) {
          return; // Already consented
        }
      } catch {
        // Invalid stored consent, show banner
      }
    }
    // Small delay before showing for better UX
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  const saveConsent = (prefs: CookiePreferences) => {
    const consent = {
      ...prefs,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));

    // Dispatch event for other components to react
    window.dispatchEvent(new CustomEvent('cookie-consent-updated', { detail: consent }));

    setVisible(false);
  };

  const acceptAll = () => {
    saveConsent({
      ...preferences,
      functional: true,
      analytics: true,
      marketing: true,
    });
  };

  const acceptSelected = () => {
    saveConsent(preferences);
  };

  const rejectNonEssential = () => {
    saveConsent({
      ...defaultPreferences,
      functional: false,
      analytics: false,
      marketing: false,
    });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 200, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 200, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed bottom-0 left-0 right-0 z-[100] p-4 pointer-events-none"
        >
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <div className={cn(
              "relative bg-background/95 backdrop-blur-xl rounded-3xl overflow-hidden",
              "shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
            )}>
              {/* Gradient accent line */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-campfire-500 via-vibes-neon to-campfire-500" />

              <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-campfire-500/10">
                      <Cookie className="w-5 h-5 text-campfire-500" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">Your privacy matters</h3>
                      <p className="text-xs text-muted-foreground">We use cookies to improve your experience</p>
                    </div>
                  </div>
                  <button
                    onClick={rejectNonEssential}
                    className="p-1.5 rounded-full hover:bg-muted/50 transition-colors"
                    aria-label="Dismiss and reject non-essential cookies"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>

                {/* Expandable preferences */}
                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-3 mb-4 pt-2">
                        {/* Essential - always on */}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                          <div>
                            <p className="text-sm font-medium">Essential</p>
                            <p className="text-xs text-muted-foreground">Required for the site to work</p>
                          </div>
                          <Switch checked disabled className="data-[state=checked]:bg-campfire-500" />
                        </div>

                        {/* Functional */}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                          <div>
                            <p className="text-sm font-medium">Functional</p>
                            <p className="text-xs text-muted-foreground">Remember your preferences</p>
                          </div>
                          <Switch
                            checked={preferences.functional}
                            onCheckedChange={(checked) =>
                              setPreferences(p => ({ ...p, functional: checked }))
                            }
                            className="data-[state=checked]:bg-campfire-500"
                          />
                        </div>

                        {/* Analytics */}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                          <div>
                            <p className="text-sm font-medium">Analytics</p>
                            <p className="text-xs text-muted-foreground">Help us improve the service</p>
                          </div>
                          <Switch
                            checked={preferences.analytics}
                            onCheckedChange={(checked) =>
                              setPreferences(p => ({ ...p, analytics: checked }))
                            }
                            className="data-[state=checked]:bg-campfire-500"
                          />
                        </div>

                        {/* Marketing */}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                          <div>
                            <p className="text-sm font-medium">Marketing</p>
                            <p className="text-xs text-muted-foreground">Personalized recommendations</p>
                          </div>
                          <Switch
                            checked={preferences.marketing}
                            onCheckedChange={(checked) =>
                              setPreferences(p => ({ ...p, marketing: checked }))
                            }
                            className="data-[state=checked]:bg-campfire-500"
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
                  >
                    {expanded ? (
                      <>
                        <ChevronUp className="w-3 h-3" />
                        Hide options
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        Customize
                      </>
                    )}
                  </button>

                  <div className="flex-1" />

                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={rejectNonEssential}
                      className="rounded-xl text-xs px-4"
                    >
                      Reject all
                    </Button>

                    {expanded ? (
                      <Button
                        size="sm"
                        onClick={acceptSelected}
                        className="rounded-xl text-xs px-4 bg-campfire-500 hover:bg-campfire-600"
                      >
                        Save preferences
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={acceptAll}
                        className="rounded-xl text-xs px-4 bg-campfire-500 hover:bg-campfire-600"
                      >
                        Accept all
                      </Button>
                    )}
                  </div>
                </div>

                {/* Privacy link */}
                <p className="text-[10px] text-muted-foreground text-center mt-3">
                  Learn more in our{' '}
                  <a href="/privacy" className="underline hover:text-campfire-500 transition-colors">
                    Privacy Policy
                  </a>
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Hook to check cookie consent status
export function useCookieConsent() {
  const [consent, setConsent] = useState<CookiePreferences | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored) {
      try {
        setConsent(JSON.parse(stored));
      } catch {
        setConsent(null);
      }
    }

    const handler = (e: CustomEvent<CookiePreferences>) => {
      setConsent(e.detail);
    };

    window.addEventListener('cookie-consent-updated', handler as EventListener);
    return () => window.removeEventListener('cookie-consent-updated', handler as EventListener);
  }, []);

  return consent;
}
