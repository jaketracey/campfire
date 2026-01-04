'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Flowguard SDK types based on actual SDK API
interface FlowguardInstance {
  remove: () => void;
  submit: () => void;
}

interface FlowguardElementConfig {
  target: string;
  placeholder?: string;
  styles?: Record<string, unknown>;
}

interface FlowguardConstructorOptions {
  sessionId: string;
  cardNumber: FlowguardElementConfig;
  expDate: FlowguardElementConfig;
  cardholder: FlowguardElementConfig;
  cvv: FlowguardElementConfig;
  price?: FlowguardElementConfig;
  remember?: FlowguardElementConfig;
  styles?: Record<string, unknown>;
  onSuccess?: () => void;
  onDecline?: (error?: string) => void;
  onError?: (error: string) => void;
}

interface FlowguardConstructor {
  new (options: FlowguardConstructorOptions): FlowguardInstance;
}

interface FlowguardState {
  isLoading: boolean;
  isReady: boolean;
  isSubmitting: boolean;
  error: string | null;
}

declare global {
  interface Window {
    Flowguard?: FlowguardConstructor;
  }
}

const FLOWGUARD_SDK_URL = 'https://flowguard.yoursafe.com/js/flowguard.js';

export interface FlowguardInitOptions {
  sessionId: string;
  onSuccess?: () => void;
  onDecline?: (error?: string) => void;
  onError?: (error: string) => void;
}

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

        // Create new Flowguard instance with target elements
        // The SDK uses constructor pattern: new Flowguard({...})
        const instance = new window.Flowguard({
          sessionId: options.sessionId,
          cardNumber: {
            target: '#card-number-element',
          },
          expDate: {
            target: '#exp-date-element',
          },
          cardholder: {
            target: '#cardholder-element',
          },
          cvv: {
            target: '#cvv-element',
          },
          price: {
            target: '#price-element',
          },
          onSuccess: () => {
            setState(prev => ({ ...prev, isSubmitting: false }));
            options.onSuccess?.();
          },
          onDecline: (error) => {
            setState(prev => ({
              ...prev,
              isSubmitting: false,
              error: error || 'Payment declined'
            }));
            options.onDecline?.(error);
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
      instanceRef.current.submit();
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
