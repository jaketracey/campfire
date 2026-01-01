'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfig) => void;
          renderButton: (element: HTMLElement, config: GoogleButtonConfig) => void;
          prompt: (callback?: (notification: PromptMomentNotification) => void) => void;
          cancel: () => void;
        };
      };
    };
  }
}

interface GoogleIdConfig {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GoogleButtonConfig {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
}

interface GoogleCredentialResponse {
  credential: string;
  select_by: string;
  clientId?: string;
}

interface PromptMomentNotification {
  isDisplayMoment: () => boolean;
  isDisplayed: () => boolean;
  isNotDisplayed: () => boolean;
  getNotDisplayedReason: () =>
    | 'browser_not_supported'
    | 'invalid_client'
    | 'missing_client_id'
    | 'opt_out_or_no_session'
    | 'secure_http_required'
    | 'suppressed_by_user'
    | 'unregistered_origin'
    | 'unknown_reason';
  isSkippedMoment: () => boolean;
  getSkippedReason: () =>
    | 'auto_cancel'
    | 'user_cancel'
    | 'tap_outside'
    | 'issuing_failed';
  isDismissedMoment: () => boolean;
  getDismissedReason: () =>
    | 'credential_returned'
    | 'cancel_called'
    | 'flow_restarted';
}

interface GoogleSignInButtonProps {
  onSuccess: (idToken: string) => Promise<void>;
  onError: (error: Error) => void;
  text?: 'signin' | 'signup';
  disabled?: boolean;
}

export function GoogleSignInButton({
  onSuccess,
  onError,
  text = 'signin',
  disabled = false,
}: GoogleSignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;

  const handleCredentialResponse = useCallback(
    async (response: GoogleCredentialResponse) => {
      setIsLoading(true);
      try {
        await onSuccess(response.credential);
      } catch (error) {
        onError(error instanceof Error ? error : new Error('Google sign-in failed'));
      } finally {
        setIsLoading(false);
      }
    },
    [onSuccess, onError]
  );

  useEffect(() => {
    // Don't load if client ID is not configured
    if (!clientId) {
      console.warn('Google OAuth client ID is not configured');
      return;
    }

    // Check if script is already loaded
    if (window.google?.accounts?.id) {
      setIsScriptLoaded(true);
      return;
    }

    // Load the Google Identity Services script
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setIsScriptLoaded(true);
    script.onerror = () => {
      console.error('Failed to load Google Identity Services script');
      onError(new Error('Failed to load Google sign-in'));
    };
    document.body.appendChild(script);

    return () => {
      // Cleanup script on unmount if it was added by this component
      const existingScript = document.querySelector(
        'script[src="https://accounts.google.com/gsi/client"]'
      );
      // Only remove if there are no other Google sign-in buttons on the page
      if (existingScript && document.querySelectorAll('[data-google-signin]').length <= 1) {
        existingScript.remove();
      }
    };
  }, [clientId, onError]);

  useEffect(() => {
    if (!isScriptLoaded || !clientId || !window.google?.accounts?.id) return;

    // Initialize Google Identity Services
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
  }, [isScriptLoaded, clientId, handleCredentialResponse]);

  const handlePromptNotification = useCallback(
    (notification: PromptMomentNotification) => {
      if (notification.isNotDisplayed()) {
        const reason = notification.getNotDisplayedReason();
        let errorMessage = 'Google sign-in is not available';

        switch (reason) {
          case 'browser_not_supported':
            errorMessage = 'Your browser does not support Google sign-in';
            break;
          case 'invalid_client':
          case 'missing_client_id':
            errorMessage = 'Google sign-in is not properly configured';
            break;
          case 'opt_out_or_no_session':
            errorMessage = 'Please sign in to your Google account first';
            break;
          case 'secure_http_required':
            errorMessage = 'Google sign-in requires a secure connection (HTTPS)';
            break;
          case 'suppressed_by_user':
            errorMessage = 'Google sign-in was previously dismissed. Please try again.';
            break;
          case 'unregistered_origin':
            errorMessage = 'This website is not authorized for Google sign-in';
            break;
        }

        console.warn('Google prompt not displayed:', reason);
        // Don't show error for opt_out_or_no_session as user might just click again
        if (reason !== 'opt_out_or_no_session' && reason !== 'suppressed_by_user') {
          onError(new Error(errorMessage));
        }
      }

      if (notification.isSkippedMoment()) {
        const reason = notification.getSkippedReason();
        // User cancelled or tapped outside - this is expected behavior, don't show error
        if (reason === 'user_cancel' || reason === 'tap_outside' || reason === 'auto_cancel') {
          console.debug('Google prompt skipped:', reason);
          return;
        }

        if (reason === 'issuing_failed') {
          onError(new Error('Failed to get Google credentials. Please try again.'));
        }
      }
    },
    [onError]
  );

  const handleClick = useCallback(() => {
    if (!window.google?.accounts?.id) {
      onError(new Error('Google sign-in is not available. Please refresh the page and try again.'));
      return;
    }

    // Trigger the One Tap prompt with notification callback
    window.google.accounts.id.prompt(handlePromptNotification);
  }, [onError, handlePromptNotification]);

  // If client ID is not configured, show a disabled button
  if (!clientId) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled
        data-google-signin
      >
        <GoogleIcon className="mr-2 h-5 w-5" />
        Google sign-in not configured
      </Button>
    );
  }

  const buttonText = text === 'signup' ? 'Sign up with Google' : 'Sign in with Google';

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleClick}
      disabled={disabled || isLoading || !isScriptLoaded}
      data-google-signin
    >
      {isLoading ? (
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      ) : (
        <GoogleIcon className="mr-2 h-5 w-5" />
      )}
      {isLoading ? 'Signing in...' : buttonText}
    </Button>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
