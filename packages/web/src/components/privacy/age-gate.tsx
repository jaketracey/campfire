'use client';

/**
 * Age Verification Gate
 * Full-screen overlay requiring users to confirm they are 18+
 * Blocks access to adult content settings without verification.
 * Minimal, dramatic design with gradient backgrounds.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, AlertTriangle, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatedFlame } from '@/components/ui/animated-flame';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const AGE_VERIFIED_KEY = 'campfire-age-verified';
const AGE_VERIFIED_VERSION = '1.0';

interface AgeVerification {
  version: string;
  verified: boolean;
  timestamp: string;
}

interface AgeGateProps {
  children: React.ReactNode;
  required?: boolean;
  onVerified?: () => void;
  className?: string;
}

/**
 * Wraps content that requires age verification
 * Shows full-screen gate if user hasn't verified age
 */
export function AgeGate({ children, required = true, onVerified, className }: AgeGateProps) {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [showGate, setShowGate] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(AGE_VERIFIED_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AgeVerification;
        if (parsed.version === AGE_VERIFIED_VERSION && parsed.verified) {
          setVerified(true);
          return;
        }
      } catch {
        // Invalid stored verification
      }
    }
    setVerified(false);
    if (required) {
      setShowGate(true);
    }
  }, [required]);

  const handleVerified = () => {
    const verification: AgeVerification = {
      version: AGE_VERIFIED_VERSION,
      verified: true,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(AGE_VERIFIED_KEY, JSON.stringify(verification));
    setVerified(true);
    setShowGate(false);
    onVerified?.();
  };

  // Still loading
  if (verified === null) {
    return null;
  }

  // Not verified and required - show gate
  if (!verified && required) {
    return (
      <AgeVerificationModal
        open={showGate}
        onVerified={handleVerified}
      />
    );
  }

  // Verified or not required - show content
  return <div className={className}>{children}</div>;
}

interface AgeVerificationModalProps {
  open: boolean;
  onVerified: () => void;
  onDecline?: () => void;
}

/**
 * Standalone age verification modal
 * Can be triggered independently of AgeGate wrapper
 */
export function AgeVerificationModal({ open, onVerified, onDecline }: AgeVerificationModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const canProceed = confirmed && termsAccepted;

  const handleDecline = () => {
    onDecline?.();
    // Redirect to homepage or show message
    window.location.href = '/';
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center"
        >
          {/* Dramatic gradient background */}
          <div className="absolute inset-0 bg-black">
            <div className="absolute inset-0 bg-gradient-to-br from-campfire-950 via-black to-ember-950 opacity-80" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(249,115,22,0.15),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(139,92,246,0.1),transparent_40%)]" />

            {/* Animated particles */}
            <div className="absolute inset-0 overflow-hidden">
              {[...Array(20)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-1 h-1 rounded-full bg-campfire-500/30"
                  initial={{
                    x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000),
                    y: (typeof window !== 'undefined' ? window.innerHeight : 800) + 20,
                  }}
                  animate={{
                    y: -20,
                    transition: {
                      duration: 8 + Math.random() * 4,
                      repeat: Infinity,
                      delay: Math.random() * 5,
                    },
                  }}
                />
              ))}
            </div>
          </div>

          {/* Content */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="relative max-w-md w-full mx-4"
          >
            <div className="bg-background/95 backdrop-blur-2xl rounded-3xl overflow-hidden">
              {/* Warning accent */}
              <div className="h-1 bg-gradient-to-r from-ember-500 via-campfire-500 to-ember-500" />

              <div className="p-8">
                {/* Logo and shield */}
                <div className="flex flex-col items-center mb-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', delay: 0.2 }}
                    className="relative mb-6"
                  >
                    <div className="absolute inset-0 bg-campfire-500/20 blur-2xl rounded-full" />
                    <div className="relative p-4 rounded-2xl bg-gradient-to-br from-campfire-500/20 to-ember-500/20">
                      <ShieldCheck className="w-12 h-12 text-campfire-500" />
                    </div>
                  </motion.div>

                  <div className="mb-2">
                    <AnimatedFlame size="sm" />
                  </div>

                  <h1 className="text-2xl font-bold text-center mb-2">
                    Age Verification Required
                  </h1>

                  <p className="text-muted-foreground text-center text-sm">
                    This platform contains adult content and is intended for users 18 years or older.
                  </p>
                </div>

                {/* Verification options */}
                <div className="space-y-4 mb-6">
                  {/* Age confirmation */}
                  <label
                    className={cn(
                      "flex items-start gap-4 p-4 rounded-2xl cursor-pointer transition-all",
                      "bg-muted/30 hover:bg-muted/50",
                      confirmed && "bg-campfire-500/10 ring-1 ring-campfire-500/30"
                    )}
                  >
                    <Checkbox
                      checked={confirmed}
                      onCheckedChange={(checked) => setConfirmed(!!checked)}
                      className="mt-0.5 data-[state=checked]:bg-campfire-500 data-[state=checked]:border-campfire-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Calendar className="w-4 h-4 text-campfire-500" />
                        <span className="font-medium text-sm">I am 18 years or older</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        I confirm that I meet the minimum age requirement to access this content.
                      </p>
                    </div>
                  </label>

                  {/* Terms acceptance */}
                  <label
                    className={cn(
                      "flex items-start gap-4 p-4 rounded-2xl cursor-pointer transition-all",
                      "bg-muted/30 hover:bg-muted/50",
                      termsAccepted && "bg-campfire-500/10 ring-1 ring-campfire-500/30"
                    )}
                  >
                    <Checkbox
                      checked={termsAccepted}
                      onCheckedChange={(checked) => setTermsAccepted(!!checked)}
                      className="mt-0.5 data-[state=checked]:bg-campfire-500 data-[state=checked]:border-campfire-500"
                    />
                    <div className="flex-1">
                      <span className="font-medium text-sm">I accept the terms</span>
                      <p className="text-xs text-muted-foreground mt-1">
                        I have read and agree to the{' '}
                        <a href="/terms" className="text-campfire-500 hover:underline" target="_blank">
                          Terms of Service
                        </a>{' '}
                        and{' '}
                        <a href="/privacy" className="text-campfire-500 hover:underline" target="_blank">
                          Privacy Policy
                        </a>
                        .
                      </p>
                    </div>
                  </label>
                </div>

                {/* Warning note */}
                <div className="flex items-start gap-3 p-3 rounded-xl bg-ember-500/10 mb-6">
                  <AlertTriangle className="w-4 h-4 text-ember-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    By entering, you acknowledge that you are of legal age in your jurisdiction
                    and take full responsibility for your interactions.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3">
                  <Button
                    onClick={onVerified}
                    disabled={!canProceed}
                    className={cn(
                      "w-full h-12 rounded-2xl text-base font-semibold transition-all",
                      canProceed
                        ? "bg-campfire-500 hover:bg-campfire-600 shadow-lg shadow-campfire-500/25"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    Enter Campfire
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={handleDecline}
                    className="w-full rounded-2xl text-muted-foreground hover:text-foreground"
                  >
                    I am under 18 - Exit
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Hook to check if age has been verified
 */
export function useAgeVerified(): boolean {
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(AGE_VERIFIED_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AgeVerification;
        setVerified(parsed.version === AGE_VERIFIED_VERSION && parsed.verified);
      } catch {
        setVerified(false);
      }
    }
  }, []);

  return verified;
}

/**
 * Trigger age verification modal programmatically
 */
export function requireAgeVerification(): Promise<boolean> {
  return new Promise((resolve) => {
    const stored = localStorage.getItem(AGE_VERIFIED_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AgeVerification;
        if (parsed.version === AGE_VERIFIED_VERSION && parsed.verified) {
          resolve(true);
          return;
        }
      } catch {
        // Continue to show modal
      }
    }

    // Create and show modal
    const container = document.createElement('div');
    container.id = 'age-verification-modal';
    document.body.appendChild(container);

    const cleanup = () => {
      document.body.removeChild(container);
    };

    // This would need React portal, simplified for now
    resolve(false);
  });
}
