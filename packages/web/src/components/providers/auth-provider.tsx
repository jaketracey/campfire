'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore, isTokenExpiringSoon } from '@/stores/auth-store';
import * as authApi from '@/lib/api/auth';

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { isInitialized, updateTokens, clearSession } = useAuthStore();
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasAttemptedRefreshRef = useRef(false);

  // Set up token refresh interval - only after hydration is complete
  useEffect(() => {
    // Wait for hydration before doing anything
    if (!isInitialized) return;

    const refreshTokens = async () => {
      // Only refresh if we have a token and it's expiring soon
      const currentToken = useAuthStore.getState().refreshToken;
      if (!currentToken) return;
      if (!isTokenExpiringSoon()) return;

      try {
        const response = await authApi.refresh(currentToken);

        if (response.success && response.data) {
          updateTokens(
            response.data.accessToken,
            response.data.refreshToken,
            response.data.expiresIn
          );
        } else {
          // Only clear session if this isn't the initial refresh attempt
          // (avoid clearing valid session due to race conditions)
          if (hasAttemptedRefreshRef.current) {
            clearSession();
          }
        }
      } catch {
        // Only clear session if this isn't the initial refresh attempt
        if (hasAttemptedRefreshRef.current) {
          clearSession();
        }
      }
      hasAttemptedRefreshRef.current = true;
    };

    // Check for refresh every 30 seconds
    refreshIntervalRef.current = setInterval(refreshTokens, 30 * 1000);

    // Initial check (after a short delay to ensure state is stable)
    const initialCheckTimeout = setTimeout(refreshTokens, 1000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      clearTimeout(initialCheckTimeout);
    };
  }, [isInitialized, updateTokens, clearSession]);

  return <>{children}</>;
}
