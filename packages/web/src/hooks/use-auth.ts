'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useAuthStore } from '@/stores/auth-store';
import * as authApi from '@/lib/api/auth';
import type { LoginCredentials, SignupCredentials, GoogleAuthCredentials, User, AuthTokens } from '@/lib/auth/types';
import { setWelcomeTransition } from '@/components/auth/welcome-transition';
import { trackSignup } from '@/lib/analytics/meta-pixel';
import { useOnboardingStore } from '@/stores/onboarding-store';

/**
 * Main auth hook providing auth state and actions
 */
export function useAuth() {
  const router = useRouter();
  const {
    user,
    accessToken,
    refreshToken,
    isLoading,
    isInitialized,
    setSession,
    clearSession,
    updateTokens,
    setLoading,
  } = useAuthStore();

  const isAuthenticated = !!accessToken && !!user;

  const getSafeReturnPath = useCallback((returnTo?: string | null): string | null => {
    if (!returnTo) return null;
    if (!returnTo.startsWith('/')) return null;
    if (returnTo.startsWith('//')) return null;
    return returnTo;
  }, []);

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      setLoading(true);
      try {
        const response = await authApi.login(credentials);

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Login failed');
        }

        if ('requiresMFA' in response.data && response.data.requiresMFA) {
          router.push('/two-factor');
          return { requiresMFA: true, mfaMethods: response.data.mfaMethods };
        }

        // After the MFA check, we know we have user and tokens
        const data = response.data as { user: User; tokens: AuthTokens };
        const { user, tokens } = data;

        // Update Zustand state and set cookie
        setSession(user, tokens);

        router.push('/dashboard');
        return { success: true };
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [router, setSession, setLoading]
  );

  const signup = useCallback(
    async (credentials: SignupCredentials, options?: { returnTo?: string | null }) => {
      setLoading(true);
      try {
        const response = await authApi.signup(credentials);

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Signup failed');
        }

        const { user, tokens } = response.data;

        // Update Zustand state and set cookie
        setSession(user, tokens);

        // Track signup conversion
        trackSignup('email');

        // Set welcome transition flag for the destination page
        setWelcomeTransition({ type: 'signup', provider: 'email' });

        const redirectPath = (getSafeReturnPath(options?.returnTo) || '/onboard') as Route;
        router.push(redirectPath);
        return { success: true };
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [router, setSession, setLoading, getSafeReturnPath]
  );

  const logout = useCallback(async () => {
    try {
      if (refreshToken) {
        await authApi.logout(refreshToken);
      }
    } catch {
      // Ignore errors during logout
    } finally {
      useOnboardingStore.getState().reset();
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('pendingQuickStart');
        window.sessionStorage.removeItem('campfire:onboard-completion-session');
      }
      clearSession();
      router.push('/login');
    }
  }, [refreshToken, clearSession, router]);

  const refreshTokens = useCallback(async () => {
    if (!refreshToken) return false;

    try {
      const response = await authApi.refresh(refreshToken);

      if (!response.success || !response.data) {
        clearSession();
        return false;
      }

      updateTokens(
        response.data.accessToken,
        response.data.refreshToken,
        response.data.expiresIn
      );
      return true;
    } catch {
      clearSession();
      return false;
    }
  }, [refreshToken, clearSession, updateTokens]);

  const loginWithGoogle = useCallback(
    async (
      credentials: GoogleAuthCredentials,
      isSignup: boolean = false,
      options?: { returnTo?: string | null }
    ) => {
      setLoading(true);
      try {
        const response = await authApi.googleAuth(credentials);

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Google authentication failed');
        }

        const { user, tokens } = response.data;

        // Update Zustand state and set cookie
        setSession(user, tokens);

        // Navigate to onboarding for new signups, dashboard for logins
        // We determine if it's a new user by checking if they have a displayName
        const isNewUser = isSignup || !user.displayName;
        const safeReturnPath = getSafeReturnPath(options?.returnTo);
        const redirectPath = (isNewUser ? (safeReturnPath || '/onboard') : '/dashboard') as Route;

        // Track signup conversion for new users
        if (isNewUser) {
          trackSignup('google');
        }

        // Set welcome transition flag for the destination page
        setWelcomeTransition({
          type: isNewUser ? 'signup' : 'login',
          provider: 'google',
        });

        router.push(redirectPath);
        return { success: true };
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [router, setSession, setLoading, getSafeReturnPath]
  );

  return {
    user,
    isAuthenticated,
    isLoading,
    isInitialized,
    login,
    signup,
    logout,
    refreshTokens,
    loginWithGoogle,
  };
}

/**
 * Hook for pages that require authentication
 * Redirects to login if not authenticated
 * Pass null to skip redirect (useful for demo mode)
 */
export function useRequireAuth(redirectTo: Route | null = '/login' as Route) {
  const router = useRouter();
  const { isAuthenticated, isInitialized, isLoading } = useAuth();

  useEffect(() => {
    if (isInitialized && !isLoading && !isAuthenticated && redirectTo) {
      router.replace(redirectTo);
    }
  }, [isInitialized, isLoading, isAuthenticated, router, redirectTo]);

  return { isAuthenticated, isLoading: !isInitialized || isLoading };
}

/**
 * Hook to get just the current user
 */
export function useUser() {
  return useAuthStore((state) => state.user);
}
