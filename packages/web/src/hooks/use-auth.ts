'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useAuthStore } from '@/stores/auth-store';
import * as authApi from '@/lib/api/auth';
import type { LoginCredentials, SignupCredentials, GoogleAuthCredentials, User, AuthTokens } from '@/lib/auth/types';

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
        const expiresAt = Date.now() + tokens.expiresIn * 1000;

        console.log('[AUTH] Login successful, writing to localStorage:', {
          user: user?.id,
          hasAccessToken: !!tokens.accessToken,
          hasRefreshToken: !!tokens.refreshToken,
          expiresAt,
        });

        // Write to localStorage BEFORE Zustand update to guarantee persistence
        localStorage.setItem(
          'campfire-auth',
          JSON.stringify({
            state: {
              user,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt,
            },
            version: 0,
          })
        );

        // Verify it was written
        const stored = localStorage.getItem('campfire-auth');
        console.log('[AUTH] localStorage after write:', stored?.substring(0, 100));

        // Update Zustand state and set cookie
        setSession(user, tokens);

        console.log('[AUTH] setSession called, navigating to /dashboard');

        // Hard navigation to ensure cookie is sent to server middleware
        window.location.href = '/dashboard';
        return { success: true };
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [router, setSession, setLoading]
  );

  const signup = useCallback(
    async (credentials: SignupCredentials) => {
      setLoading(true);
      try {
        const response = await authApi.signup(credentials);

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Signup failed');
        }

        const { user, tokens } = response.data;
        const expiresAt = Date.now() + tokens.expiresIn * 1000;

        // Write to localStorage BEFORE Zustand update to guarantee persistence
        localStorage.setItem(
          'campfire-auth',
          JSON.stringify({
            state: {
              user,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt,
            },
            version: 0,
          })
        );

        // Update Zustand state and set cookie
        setSession(user, tokens);

        // Hard navigation to ensure cookie is sent to server middleware
        window.location.href = '/onboard';
        return { success: true };
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [router, setSession, setLoading]
  );

  const logout = useCallback(async () => {
    try {
      if (refreshToken) {
        await authApi.logout(refreshToken);
      }
    } catch {
      // Ignore errors during logout
    } finally {
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
    async (credentials: GoogleAuthCredentials, isSignup: boolean = false) => {
      setLoading(true);
      try {
        const response = await authApi.googleAuth(credentials);

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Google authentication failed');
        }

        const { user, tokens } = response.data;
        const expiresAt = Date.now() + tokens.expiresIn * 1000;

        console.log('[AUTH] Google auth successful, writing to localStorage:', {
          user: user?.id,
          hasAccessToken: !!tokens.accessToken,
          hasRefreshToken: !!tokens.refreshToken,
          expiresAt,
        });

        // Write to localStorage BEFORE Zustand update to guarantee persistence
        localStorage.setItem(
          'campfire-auth',
          JSON.stringify({
            state: {
              user,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt,
            },
            version: 0,
          })
        );

        // Update Zustand state and set cookie
        setSession(user, tokens);

        // Navigate to onboarding for new signups, dashboard for logins
        // We determine if it's a new user by checking if they have a displayName
        const redirectPath = isSignup || !user.displayName ? '/onboard' : '/dashboard';
        window.location.href = redirectPath;
        return { success: true };
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [setSession, setLoading]
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
 */
export function useRequireAuth(redirectTo: Route = '/login' as Route) {
  const router = useRouter();
  const { isAuthenticated, isInitialized, isLoading } = useAuth();

  useEffect(() => {
    if (isInitialized && !isLoading && !isAuthenticated) {
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
