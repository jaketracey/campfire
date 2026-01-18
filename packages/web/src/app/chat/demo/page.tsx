'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedFlame } from '@/components/ui/animated-flame';
import { Button } from '@/components/ui/button';
import { ChatSessionContent } from '../[sessionId]/chat-session-content';
import { SignupModal, type SignupTrigger } from '@/components/demo/signup-modal';
import { getDemoCompanion, createDemoSession, type DemoCompanion } from '@/lib/api/demo';
import { getDeviceFingerprint } from '@/lib/fingerprint';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api/client';

export default function DemoChatPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, isInitialized, loginWithGoogle, login, signup } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [companion, setCompanion] = useState<DemoCompanion | null>(null);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [signupTrigger, setSignupTrigger] = useState<SignupTrigger>('general');
  const [isSwitchingCompanion, setIsSwitchingCompanion] = useState(false);
  const [showDesignCTA, setShowDesignCTA] = useState(false);

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (isInitialized && user) {
      router.replace('/dashboard');
    }
  }, [isInitialized, user, router]);

  // Show Design Your Companion CTA after 12 seconds
  useEffect(() => {
    if (!sessionId || isLoading) return;

    const timer = setTimeout(() => {
      setShowDesignCTA(true);
    }, 12000);

    return () => clearTimeout(timer);
  }, [sessionId, isLoading]);

  // Initialize demo session
  useEffect(() => {
    if (!isInitialized || user) return;

    async function initDemo() {
      try {
        setIsLoading(true);
        setError(null);

        // Get fingerprint and demo companion in parallel
        const [fp, demoCompanion] = await Promise.all([
          getDeviceFingerprint(),
          getDemoCompanion(),
        ]);

        setFingerprint(fp);
        setCompanion(demoCompanion);

        // Create demo session
        const session = await createDemoSession({
          companionId: demoCompanion.id,
          fingerprint: fp,
        });

        setSessionId(session.id);
        setIsLoading(false);
      } catch (err) {
        console.error('[DemoChat] Init error:', err);
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to start chat. Please try again.');
        }
        setIsLoading(false);
      }
    }

    initDemo();
  }, [isInitialized, user]);

  // Handle limit reached
  const handleLimitReached = useCallback(() => {
    setSignupTrigger('message_limit');
    setShowSignupModal(true);
  }, []);

  // Handle require auth with specific trigger
  const handleRequireAuth = useCallback((trigger: SignupTrigger) => {
    setSignupTrigger(trigger);
    setShowSignupModal(true);
  }, []);

  // Handle switching to a new random demo companion
  const handleSwitchDemoCompanion = useCallback(async () => {
    if (isSwitchingCompanion || !fingerprint) return;

    setIsSwitchingCompanion(true);
    try {
      // Get a new random demo companion
      const newCompanion = await getDemoCompanion();

      // Create a new demo session with the new companion
      const newSession = await createDemoSession({
        companionId: newCompanion.id,
        fingerprint,
      });

      // Update state - this will trigger a re-render with new companion
      setCompanion(newCompanion);
      setSessionId(newSession.id);
    } catch (err) {
      console.error('[DemoChat] Switch companion error:', err);
      toast({
        title: 'Failed to switch companion',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSwitchingCompanion(false);
    }
  }, [isSwitchingCompanion, fingerprint, toast]);

  // Handle Design Your Companion click
  const handleDesignCompanion = useCallback(() => {
    router.push('/onboard');
  }, [router]);

  // Handle Google sign-in success
  const handleGoogleSuccess = useCallback(
    async (idToken: string) => {
      try {
        await loginWithGoogle({ idToken }, false);
        toast({
          title: 'Welcome!',
          description: 'Your account has been created.',
        });
        router.replace('/dashboard');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Sign-in failed. Please try again.';
        toast({
          title: 'Sign-in failed',
          description: message,
          variant: 'destructive',
        });
      }
    },
    [loginWithGoogle, toast, router]
  );

  // Handle Google error
  const handleGoogleError = useCallback(
    (error: Error) => {
      toast({
        title: 'Sign-in failed',
        description: error.message || 'Google sign-in failed. Please try again.',
        variant: 'destructive',
      });
    },
    [toast]
  );

  // Handle email/password login
  const handleEmailLogin = useCallback(
    async (email: string, password: string) => {
      try {
        await login({ email, password });
        toast({
          title: 'Welcome back!',
          description: 'You have successfully signed in.',
        });
        router.replace('/dashboard');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Login failed. Please check your credentials.';
        toast({
          title: 'Login failed',
          description: message,
          variant: 'destructive',
        });
        throw error;
      }
    },
    [login, toast, router]
  );

  // Handle email/password signup
  const handleEmailSignup = useCallback(
    async (email: string, password: string, name?: string) => {
      try {
        await signup({ email, password, displayName: name });
        toast({
          title: 'Welcome!',
          description: 'Your account has been created.',
        });
        router.replace('/dashboard');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Signup failed. Please try again.';
        toast({
          title: 'Signup failed',
          description: message,
          variant: 'destructive',
        });
        throw error;
      }
    },
    [signup, toast, router]
  );

  // Loading state - show Campfire logo
  if (isLoading || !isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <AnimatedFlame size="lg" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-6 text-center">
          <AnimatedFlame size="lg" />
          <p className="text-xl text-white">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-primary hover:underline"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Render chat
  if (!sessionId || !fingerprint || !companion) {
    return null;
  }

  return (
    <>
      <ChatSessionContent
        sessionId={sessionId}
        isDemo
        demoFingerprint={fingerprint}
        demoCompanion={companion}
        onLimitReached={handleLimitReached}
        onRequireAuth={handleRequireAuth}
        onSwitchDemoCompanion={handleSwitchDemoCompanion}
        isSwitchingDemoCompanion={isSwitchingCompanion}
        demoAvatarTopRight={showDesignCTA}
      />
      <SignupModal
        open={showSignupModal}
        onOpenChange={setShowSignupModal}
        onGoogleSuccess={handleGoogleSuccess}
        onGoogleError={handleGoogleError}
        onEmailLogin={handleEmailLogin}
        onEmailSignup={handleEmailSignup}
        trigger={signupTrigger}
      />

      {/* Design Your Companion CTA - appears after 12 seconds */}
      <AnimatePresence>
        {showDesignCTA && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="fixed bottom-[190px] left-4 right-4 lg:bottom-32 lg:left-1/2 lg:-translate-x-1/2 lg:right-auto lg:w-auto z-50 flex flex-col items-center gap-3"
          >
            {/* Desktop-only feature list */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="hidden lg:block text-center text-sm text-muted-foreground max-w-md"
            >
              Choose their appearance, personality, voice, and more
            </motion.p>

            <Button
              onClick={handleDesignCompanion}
              size="lg"
              data-testid="design-companion-cta"
              className="w-full lg:w-auto h-14 lg:h-16 px-8 lg:px-12 rounded-2xl bg-gradient-to-r from-campfire-500 via-rose-500 to-orange-500 hover:from-campfire-600 hover:via-rose-600 hover:to-orange-600 shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:shadow-[0_0_50px_rgba(249,115,22,0.6)] transition-all duration-300 text-lg lg:text-xl font-bold"
            >
              Design Your Own Companion
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
