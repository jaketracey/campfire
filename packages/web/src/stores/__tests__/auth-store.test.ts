/**
 * Auth Store Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore, getAccessToken, isTokenExpiringSoon } from '../auth-store';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('Auth Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      isLoading: false,
      isInitialized: false,
    });
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should start with null user', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
    });

    it('should start with null tokens', () => {
      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
    });

    it('should start not loading', () => {
      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
    });

    it('should start not initialized', () => {
      const state = useAuthStore.getState();
      expect(state.isInitialized).toBe(false);
    });
  });

  describe('setSession', () => {
    it('should set user and tokens', () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        emailVerified: true,
        role: 'user' as const,
        createdAt: '2024-01-01T00:00:00Z',
      };

      const mockTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer' as const,
        expiresIn: 3600,
      };

      useAuthStore.getState().setSession(mockUser, mockTokens);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.accessToken).toBe('access-token');
      expect(state.refreshToken).toBe('refresh-token');
      expect(state.expiresAt).toBeGreaterThan(Date.now());
      expect(state.isLoading).toBe(false);
    });

    it('should calculate expiration time correctly', () => {
      const now = Date.now();
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        emailVerified: true,
        role: 'user' as const,
        createdAt: '2024-01-01T00:00:00Z',
      };

      const mockTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer' as const,
        expiresIn: 3600, // 1 hour
      };

      useAuthStore.getState().setSession(mockUser, mockTokens);

      const state = useAuthStore.getState();
      // Should be approximately 1 hour from now
      expect(state.expiresAt).toBeGreaterThan(now + 3500 * 1000);
      expect(state.expiresAt).toBeLessThan(now + 3700 * 1000);
    });
  });

  describe('clearSession', () => {
    it('should clear all session data', () => {
      // First set a session
      useAuthStore.setState({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          displayName: 'Test',
          emailVerified: true,
          role: 'user',
          createdAt: '2024-01-01T00:00:00Z',
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
      });

      useAuthStore.getState().clearSession();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.expiresAt).toBeNull();
    });
  });

  describe('updateTokens', () => {
    it('should update tokens and expiration', () => {
      useAuthStore.getState().updateTokens('new-access', 'new-refresh', 7200);

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('new-access');
      expect(state.refreshToken).toBe('new-refresh');
      expect(state.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('setLoading', () => {
    it('should set loading state', () => {
      useAuthStore.getState().setLoading(true);
      expect(useAuthStore.getState().isLoading).toBe(true);

      useAuthStore.getState().setLoading(false);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('setInitialized', () => {
    it('should set initialized state', () => {
      useAuthStore.getState().setInitialized(true);
      expect(useAuthStore.getState().isInitialized).toBe(true);

      useAuthStore.getState().setInitialized(false);
      expect(useAuthStore.getState().isInitialized).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('should return access token when set', () => {
      useAuthStore.setState({ accessToken: 'my-token' });
      expect(getAccessToken()).toBe('my-token');
    });

    it('should return null when not set', () => {
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('should return true when no expiresAt', () => {
      expect(isTokenExpiringSoon()).toBe(true);
    });

    it('should return true when token expires in less than 1 minute', () => {
      useAuthStore.setState({ expiresAt: Date.now() + 30 * 1000 }); // 30 seconds
      expect(isTokenExpiringSoon()).toBe(true);
    });

    it('should return false when token has more than 1 minute', () => {
      useAuthStore.setState({ expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 minutes
      expect(isTokenExpiringSoon()).toBe(false);
    });

    it('should return true when token is expired', () => {
      useAuthStore.setState({ expiresAt: Date.now() - 1000 }); // 1 second ago
      expect(isTokenExpiringSoon()).toBe(true);
    });
  });
});
