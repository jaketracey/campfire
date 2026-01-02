import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User, AuthTokens } from '@/lib/auth/types';

const AUTH_COOKIE = 'campfire-auth-session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function setAuthCookie() {
  if (typeof document !== 'undefined') {
    document.cookie = `${AUTH_COOKIE}=1; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }
}

function clearAuthCookie() {
  if (typeof document !== 'undefined') {
    document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0`;
  }
}

// Impersonation state stored separately to survive session changes
interface ImpersonationState {
  originalUser: User;
  originalAccessToken: string;
  originalRefreshToken: string;
  originalExpiresAt: number;
}

export interface AuthState {
  // State
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  isLoading: boolean;
  isInitialized: boolean;

  // Impersonation state
  isImpersonating: boolean;
  impersonationState: ImpersonationState | null;

  // Actions
  setSession: (user: User, tokens: AuthTokens) => void;
  clearSession: () => void;
  updateTokens: (accessToken: string, refreshToken: string, expiresIn: number) => void;
  updateUser: (updates: Partial<User>) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;

  // Impersonation actions
  startImpersonation: (targetUser: User, tokens: AuthTokens) => void;
  stopImpersonation: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      isLoading: false,
      isInitialized: false,

      // Impersonation state
      isImpersonating: false,
      impersonationState: null,

      // Actions
      setSession: (user, tokens) => {
        const expiresAt = Date.now() + tokens.expiresIn * 1000;
        set({
          user,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt,
          isLoading: false,
          isInitialized: true,
        });
        // Set cookie after state is updated (for middleware)
        setAuthCookie();
      },

      clearSession: () => {
        clearAuthCookie();
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
        });
      },

      updateTokens: (accessToken, refreshToken, expiresIn) => {
        const expiresAt = Date.now() + expiresIn * 1000;
        set({
          accessToken,
          refreshToken,
          expiresAt,
        });
        // Refresh the cookie expiry
        setAuthCookie();
      },

      updateUser: (updates) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        }));
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      setInitialized: (initialized) => {
        set({ isInitialized: initialized });
      },

      // Impersonation actions
      startImpersonation: (targetUser, tokens) => {
        const state = get();

        // Don't allow nested impersonation
        if (state.isImpersonating) {
          console.warn('[AUTH-STORE] Already impersonating, cannot start nested impersonation');
          return;
        }

        // Store current admin state
        const impersonationState: ImpersonationState = {
          originalUser: state.user!,
          originalAccessToken: state.accessToken!,
          originalRefreshToken: state.refreshToken!,
          originalExpiresAt: state.expiresAt!,
        };

        const expiresAt = Date.now() + tokens.expiresIn * 1000;
        set({
          user: targetUser,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt,
          isImpersonating: true,
          impersonationState,
        });
        setAuthCookie();
        console.log('[AUTH-STORE] Started impersonating user:', targetUser.id);
      },

      stopImpersonation: () => {
        const state = get();

        if (!state.isImpersonating || !state.impersonationState) {
          console.warn('[AUTH-STORE] Not impersonating, cannot stop');
          return;
        }

        // Restore original admin state
        const { originalUser, originalAccessToken, originalRefreshToken, originalExpiresAt } =
          state.impersonationState;

        set({
          user: originalUser,
          accessToken: originalAccessToken,
          refreshToken: originalRefreshToken,
          expiresAt: originalExpiresAt,
          isImpersonating: false,
          impersonationState: null,
        });
        setAuthCookie();
        console.log('[AUTH-STORE] Stopped impersonation, restored admin:', originalUser.id);
      },
    }),
    {
      name: 'campfire-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        expiresAt: state.expiresAt,
        isImpersonating: state.isImpersonating,
        impersonationState: state.impersonationState,
      }),
      onRehydrateStorage: () => {
        console.log('[AUTH-STORE] onRehydrateStorage called');
        return (state, error) => {
          if (error) {
            console.error('[AUTH-STORE] Hydration error:', error);
          }
          console.log('[AUTH-STORE] Hydration complete:', {
            hasState: !!state,
            userId: state?.user?.id ?? null,
            hasAccessToken: !!state?.accessToken,
            expiresAt: state?.expiresAt,
          });
          // Defer to next tick to avoid circular reference issues
          queueMicrotask(() => {
            // Check if token is expired
            const isExpired = state?.expiresAt && Date.now() > state.expiresAt;

            if (state?.accessToken && state?.user && !isExpired) {
              console.log('[AUTH-STORE] Restoring auth cookie from hydrated state');
              setAuthCookie();
            } else if (isExpired) {
              console.log('[AUTH-STORE] Token expired, clearing session');
              clearAuthCookie();
              useAuthStore.setState({
                user: null,
                accessToken: null,
                refreshToken: null,
                expiresAt: null,
              });
            }

            console.log('[AUTH-STORE] Setting isInitialized = true');
            useAuthStore.setState({ isInitialized: true });
          });
        };
      },
    }
  )
);

/**
 * Get access token for API requests
 */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

/**
 * Check if token is expired or expiring soon (within 1 minute)
 */
export function isTokenExpiringSoon(): boolean {
  const { expiresAt } = useAuthStore.getState();
  if (!expiresAt) return true;
  return Date.now() > expiresAt - 60 * 1000;
}
