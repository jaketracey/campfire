'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Flame } from 'lucide-react';
import { ChatSessionContent } from '../[sessionId]/chat-session-content';
import { SignupModal, type SignupTrigger } from '@/components/demo/signup-modal';
import { getDemoCompanion, createDemoSession, type DemoCompanion } from '@/lib/api/demo';
import { getDeviceFingerprint } from '@/lib/fingerprint';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';

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

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (isInitialized && user) {
      router.replace('/dashboard');
    }
  }, [isInitialized, user, router]);

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
        setError('Failed to start demo. Please try again.');
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
        <Flame className="h-24 w-24 text-primary animate-pulse" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-destructive">{error}</p>
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
    </>
  );
}
