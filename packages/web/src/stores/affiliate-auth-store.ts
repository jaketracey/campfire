/**
 * Affiliate Auth Store
 * Separate authentication store for affiliate portal.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const AFFILIATE_AUTH_COOKIE = 'campfire-affiliate-session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function setAffiliateAuthCookie() {
  if (typeof document !== 'undefined') {
    document.cookie = `${AFFILIATE_AUTH_COOKIE}=1; path=/affiliate; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }
}

function clearAffiliateAuthCookie() {
  if (typeof document !== 'undefined') {
    document.cookie = `${AFFILIATE_AUTH_COOKIE}=; path=/affiliate; max-age=0`;
  }
}

export interface Affiliate {
  id: string;
  name: string;
  email: string;
  code: string;
}

export interface AffiliateAuthState {
  // State
  affiliate: Affiliate | null;
  token: string | null;
  expiresAt: number | null;
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  setSession: (affiliate: Affiliate, token: string, expiresIn: number) => void;
  clearSession: () => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
}

export const useAffiliateAuthStore = create<AffiliateAuthState>()(
  persist(
    (set) => ({
      // Initial state
      affiliate: null,
      token: null,
      expiresAt: null,
      isLoading: false,
      isInitialized: false,

      // Actions
      setSession: (affiliate, token, expiresIn) => {
        const expiresAt = Date.now() + expiresIn * 1000;
        set({
          affiliate,
          token,
          expiresAt,
          isLoading: false,
          isInitialized: true,
        });
        setAffiliateAuthCookie();
      },

      clearSession: () => {
        clearAffiliateAuthCookie();
        set({
          affiliate: null,
          token: null,
          expiresAt: null,
        });
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      setInitialized: (initialized) => {
        set({ isInitialized: initialized });
      },
    }),
    {
      name: 'campfire-affiliate-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        affiliate: state.affiliate,
        token: state.token,
        expiresAt: state.expiresAt,
      }),
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error('[AFFILIATE-AUTH-STORE] Hydration error:', error);
          }

          queueMicrotask(() => {
            const isExpired = state?.expiresAt && Date.now() > state.expiresAt;

            if (state?.token && state?.affiliate && !isExpired) {
              setAffiliateAuthCookie();
            } else if (isExpired) {
              clearAffiliateAuthCookie();
              useAffiliateAuthStore.setState({
                affiliate: null,
                token: null,
                expiresAt: null,
              });
            }

            useAffiliateAuthStore.setState({ isInitialized: true });
          });
        };
      },
    }
  )
);

/**
 * Get affiliate token for API requests
 */
export function getAffiliateToken(): string | null {
  return useAffiliateAuthStore.getState().token;
}

/**
 * Check if affiliate token is expired or expiring soon (within 1 minute)
 */
export function isAffiliateTokenExpiringSoon(): boolean {
  const { expiresAt } = useAffiliateAuthStore.getState();
  if (!expiresAt) return true;
  return Date.now() > expiresAt - 60 * 1000;
}

/**
 * Check if affiliate is authenticated
 */
export function isAffiliateAuthenticated(): boolean {
  const { affiliate, token, expiresAt } = useAffiliateAuthStore.getState();
  if (!affiliate || !token || !expiresAt) return false;
  return Date.now() < expiresAt;
}
