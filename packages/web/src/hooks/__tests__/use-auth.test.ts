/**
 * useAuth Hook Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuth } from '../use-auth';
import { useAuthStore } from '@/stores/auth-store';

// Mock the auth API
vi.mock('@/lib/api/auth', () => ({
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
}));

// Mock the router
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import * as authApi from '@/lib/api/auth';

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      isLoading: false,
      isInitialized: true,
    });
  });

  describe('initial state', () => {
    it('should return unauthenticated state when no session', () => {
      const { result } = renderHook(() => useAuth());

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('should return authenticated state when session exists', () => {
      useAuthStore.setState({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          displayName: 'Test',
          emailVerified: true,
          role: 'user',
          createdAt: '2024-01-01',
        },
        accessToken: 'token',
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.email).toBe('test@example.com');
    });
  });

  describe('login', () => {
    it('should login successfully and redirect to dashboard', async () => {
      const mockLoginResponse = {
        success: true,
        data: {
          user: {
            id: 'user-123',
            email: 'test@example.com',
            displayName: 'Test User',
            emailVerified: true,
            role: 'user' as const,
            createdAt: '2024-01-01',
          },
          tokens: {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            tokenType: 'Bearer' as const,
            expiresIn: 3600,
          },
        },
      };
      vi.mocked(authApi.login).mockResolvedValue(mockLoginResponse);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.login({
          email: 'test@example.com',
          password: 'password123',
        });
      });

      expect(authApi.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });

    it('should handle MFA required response', async () => {
      const mockMFAResponse = {
        success: true,
        data: {
          requiresMFA: true as const,
          mfaMethods: ['totp'],
        },
      };
      vi.mocked(authApi.login).mockResolvedValue(mockMFAResponse);

      const { result } = renderHook(() => useAuth());

      let loginResult: unknown;
      await act(async () => {
        loginResult = await result.current.login({
          email: 'test@example.com',
          password: 'password123',
        });
      });

      expect(loginResult).toEqual({ requiresMFA: true, mfaMethods: ['totp'] });
      expect(mockPush).toHaveBeenCalledWith('/two-factor');
    });

    it('should throw error on failed login', async () => {
      vi.mocked(authApi.login).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
      });

      const { result } = renderHook(() => useAuth());

      await expect(
        act(async () => {
          await result.current.login({
            email: 'test@example.com',
            password: 'wrong',
          });
        })
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('signup', () => {
    it('should signup successfully and redirect to onboard', async () => {
      const mockSignupResponse = {
        success: true,
        data: {
          user: {
            id: 'user-123',
            email: 'new@example.com',
            displayName: 'New User',
            emailVerified: false,
            role: 'user' as const,
            createdAt: '2024-01-01',
          },
          tokens: {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            tokenType: 'Bearer' as const,
            expiresIn: 3600,
          },
        },
      };
      vi.mocked(authApi.signup).mockResolvedValue(mockSignupResponse);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signup({
          email: 'new@example.com',
          password: 'password123',
          displayName: 'New User',
        });
      });

      expect(authApi.signup).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
        displayName: 'New User',
      });
      expect(mockPush).toHaveBeenCalledWith('/onboard');
    });

    it('should throw error on failed signup', async () => {
      vi.mocked(authApi.signup).mockResolvedValue({
        success: false,
        error: { code: 'EMAIL_EXISTS', message: 'Email already exists' },
      });

      const { result } = renderHook(() => useAuth());

      await expect(
        act(async () => {
          await result.current.signup({
            email: 'existing@example.com',
            password: 'password123',
          });
        })
      ).rejects.toThrow('Email already exists');
    });
  });

  describe('logout', () => {
    it('should logout and redirect to login', async () => {
      useAuthStore.setState({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          displayName: 'Test',
          emailVerified: true,
          role: 'user',
          createdAt: '2024-01-01',
        },
        accessToken: 'token',
        refreshToken: 'refresh-token',
      });

      vi.mocked(authApi.logout).mockResolvedValue(undefined);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.logout();
      });

      expect(authApi.logout).toHaveBeenCalledWith('refresh-token');
      expect(mockPush).toHaveBeenCalledWith('/login');
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('should still clear session even if API call fails', async () => {
      useAuthStore.setState({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          displayName: 'Test',
          emailVerified: true,
          role: 'user',
          createdAt: '2024-01-01',
        },
        accessToken: 'token',
        refreshToken: 'refresh-token',
      });

      vi.mocked(authApi.logout).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.logout();
      });

      // Should still redirect and clear session
      expect(mockPush).toHaveBeenCalledWith('/login');
      expect(useAuthStore.getState().user).toBeNull();
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens successfully', async () => {
      useAuthStore.setState({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          displayName: 'Test',
          emailVerified: true,
          role: 'user',
          createdAt: '2024-01-01',
        },
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
      });

      vi.mocked(authApi.refresh).mockResolvedValue({
        success: true,
        data: {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          expiresIn: 3600,
        },
      });

      const { result } = renderHook(() => useAuth());

      let refreshResult: boolean;
      await act(async () => {
        refreshResult = await result.current.refreshTokens();
      });

      expect(refreshResult!).toBe(true);
      expect(useAuthStore.getState().accessToken).toBe('new-access');
      expect(useAuthStore.getState().refreshToken).toBe('new-refresh');
    });

    it('should return false and clear session on refresh failure', async () => {
      useAuthStore.setState({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          displayName: 'Test',
          emailVerified: true,
          role: 'user',
          createdAt: '2024-01-01',
        },
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
      });

      vi.mocked(authApi.refresh).mockRejectedValue(new Error('Invalid token'));

      const { result } = renderHook(() => useAuth());

      let refreshResult: boolean;
      await act(async () => {
        refreshResult = await result.current.refreshTokens();
      });

      expect(refreshResult!).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('should return false when no refresh token', async () => {
      const { result } = renderHook(() => useAuth());

      let refreshResult: boolean;
      await act(async () => {
        refreshResult = await result.current.refreshTokens();
      });

      expect(refreshResult!).toBe(false);
      expect(authApi.refresh).not.toHaveBeenCalled();
    });
  });
});
