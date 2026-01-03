'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { isNativeApp, requestNativeGoogleAuth } from '@/lib/native-bridge';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfig) => void;
          renderButton: (element: HTMLElement, config: GoogleButtonConfig) => void;
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
  use_fedcm_for_prompt?: boolean;
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

export interface GoogleSignInButtonProps {
  onSuccess: (idToken: string) => Promise<void>;
  onError: (error: Error) => void;
  text?: 'signin' | 'signup';
  disabled?: boolean;
  className?: string;
}

export function GoogleSignInButton({
  onSuccess,
  onError,
  text = 'signin',
  className,
}: GoogleSignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [isNative, setIsNative] = useState(false);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;

  // Check if running in native app
  useEffect(() => {
    setIsNative(isNativeApp());
  }, []);

  // Handle native Google auth
  const handleNativeGoogleAuth = useCallback(async () => {
    setIsLoading(true);
    try {
      const idToken = await requestNativeGoogleAuth(text === 'signup' ? 'signup' : 'signin');
      if (idToken) {
        await onSuccess(idToken);
      } else {
        // User cancelled
        console.log('[GoogleSignIn] Native auth cancelled');
      }
    } catch (error) {
      onError(error instanceof Error ? error : new Error('Native Google sign-in failed'));
    } finally {
      setIsLoading(false);
    }
  }, [onSuccess, onError, text]);

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
    if (!isScriptLoaded || !clientId || !window.google?.accounts?.id || !googleButtonRef.current) return;

    // Initialize Google Identity Services
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
      // Disable FedCM - it causes AbortError when prompt is dismissed
      use_fedcm_for_prompt: false,
    });

    // Clear any existing button
    googleButtonRef.current.innerHTML = '';

    // Use renderButton for both iOS and desktop - it provides a proper OAuth popup flow
    // The One Tap prompt() API is unreliable and shows a separate UI in the corner
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: text === 'signup' ? 'signup_with' : 'signin_with',
      shape: 'pill',
      width: googleButtonRef.current.offsetWidth || 300,
    });
  }, [isScriptLoaded, clientId, handleCredentialResponse, text]);

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

  // Native app: show a custom button that triggers native Google auth
  if (isNative) {
    return (
      <div className={className || 'w-full'} data-google-signin>
        <Button
          type="button"
          variant="outline"
          className="w-full h-11 bg-white hover:bg-gray-50 text-gray-700 border-gray-300"
          onClick={handleNativeGoogleAuth}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <GoogleIcon className="mr-2 h-5 w-5" />
          )}
          {isLoading ? 'Signing in...' : text === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
        </Button>
      </div>
    );
  }

  // Use Google's rendered button for both iOS and desktop
  // This provides a proper OAuth popup flow that works reliably
  return (
    <div className={className || 'w-full'} data-google-signin>
      {isLoading ? (
        <Button
          type="button"
          variant="outline"
          className="w-full h-full"
          disabled
        >
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Signing in...
        </Button>
      ) : (
        <div
          ref={googleButtonRef}
          className={`w-full flex items-center justify-center ${!isScriptLoaded ? 'opacity-50 pointer-events-none' : ''}`}
          style={{ minHeight: '44px' }}
        />
      )}
    </div>
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
