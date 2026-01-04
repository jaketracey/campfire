'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Flowguard SDK types
interface FlowguardInstance {
  remove: () => void;
  submit: () => Promise<void>;
}

interface FlowguardSDK {
  init: (options: FlowguardInitOptions) => FlowguardInstance;
}

interface FlowguardInitOptions {
  sessionId: string;
  onComplete?: () => void;
  onDeclined?: (error?: string) => void;
  onError?: (error: string) => void;
}

interface FlowguardState {
  isLoading: boolean;
  isReady: boolean;
  isSubmitting: boolean;
  error: string | null;
}

declare global {
  interface Window {
    Flowguard?: FlowguardSDK;
  }
}

const FLOWGUARD_SDK_URL = 'https://flowguard.yoursafe.com/js/flowguard.js';

/**
 * Hook to manage Flowguard payment SDK.
 * Loads the SDK script and provides methods to initialize and submit payment.
 */
export function useFlowguard() {
  const [state, setState] = useState<FlowguardState>({
    isLoading: false,
    isReady: false,
    isSubmitting: false,
    error: null,
  });

  const instanceRef = useRef<FlowguardInstance | null>(null);
  const scriptLoadedRef = useRef(false);

  // Load the Flowguard SDK script
  const loadScript = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Already loaded
      if (window.Flowguard) {
        resolve();
        return;
      }

      // Already loading
      if (scriptLoadedRef.current) {
        // Wait for it to finish
        const checkInterval = setInterval(() => {
          if (window.Flowguard) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        return;
      }

      scriptLoadedRef.current = true;

      const script = document.createElement('script');
      script.src = FLOWGUARD_SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Flowguard SDK'));
      document.head.appendChild(script);
    });
  }, []);

  // Initialize Flowguard with a session ID
  const initialize = useCallback(
    async (options: FlowguardInitOptions) => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        await loadScript();

        if (!window.Flowguard) {
          throw new Error('Flowguard SDK not available');
        }

        // Remove existing instance if any
        if (instanceRef.current) {
          instanceRef.current.remove();
        }

        const instance = window.Flowguard.init({
          sessionId: options.sessionId,
          onComplete: () => {
            setState(prev => ({ ...prev, isSubmitting: false }));
            options.onComplete?.();
          },
          onDeclined: (error) => {
            setState(prev => ({
              ...prev,
              isSubmitting: false,
              error: error || 'Payment declined'
            }));
            options.onDeclined?.(error);
          },
          onError: (error) => {
            setState(prev => ({ ...prev, isSubmitting: false, error }));
            options.onError?.(error);
          },
        });

        instanceRef.current = instance;
        setState(prev => ({ ...prev, isLoading: false, isReady: true }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to initialize payment';
        setState(prev => ({ ...prev, isLoading: false, error: message }));
        throw error;
      }
    },
    [loadScript]
  );

  // Submit the payment form
  const submit = useCallback(async () => {
    if (!instanceRef.current) {
      throw new Error('Flowguard not initialized');
    }

    setState(prev => ({ ...prev, isSubmitting: true, error: null }));

    try {
      await instanceRef.current.submit();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment submission failed';
      setState(prev => ({ ...prev, isSubmitting: false, error: message }));
      throw error;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (instanceRef.current) {
        instanceRef.current.remove();
        instanceRef.current = null;
      }
    };
  }, []);

  // Remove the current instance
  const remove = useCallback(() => {
    if (instanceRef.current) {
      instanceRef.current.remove();
      instanceRef.current = null;
    }
    setState({
      isLoading: false,
      isReady: false,
      isSubmitting: false,
      error: null,
    });
  }, []);

  return {
    ...state,
    initialize,
    submit,
    remove,
  };
}
