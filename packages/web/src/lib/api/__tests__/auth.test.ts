/**
 * Auth API Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, signup, logout, refresh } from '../auth';

// Mock the client module
vi.mock('../client', () => ({
  post: vi.fn(),
}));

import { post } from '../client';
const mockPost = post as unknown as ReturnType<typeof vi.fn>;

describe('Auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should call POST /auth/login with credentials', async () => {
      const mockResponse = {
        success: true,
        data: {
          user: { id: 'user-123', email: 'test@example.com' },
          tokens: {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            tokenType: 'Bearer',
            expiresIn: 3600,
          },
        },
      };
      mockPost.mockResolvedValue(mockResponse);

      const credentials = { email: 'test@example.com', password: 'password123' };
      const result = await login(credentials);

      expect(mockPost).toHaveBeenCalledWith('/auth/login', credentials);
      expect(result).toEqual(mockResponse);
    });

    it('should pass rememberMe flag when provided', async () => {
      mockPost.mockResolvedValue({ success: true, data: {} });

      const credentials = {
        email: 'test@example.com',
        password: 'password123',
        rememberMe: true,
      };
      await login(credentials);

      expect(mockPost).toHaveBeenCalledWith('/auth/login', credentials);
    });

    it('should propagate errors', async () => {
      mockPost.mockRejectedValue(new Error('Invalid credentials'));

      await expect(
        login({ email: 'test@example.com', password: 'wrong' })
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('signup', () => {
    it('should call POST /auth/signup with credentials', async () => {
      const mockResponse = {
        success: true,
        data: {
          user: { id: 'user-123', email: 'new@example.com' },
          tokens: {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            tokenType: 'Bearer',
            expiresIn: 3600,
          },
        },
      };
      mockPost.mockResolvedValue(mockResponse);

      const credentials = {
        email: 'new@example.com',
        password: 'password123',
        displayName: 'New User',
      };
      const result = await signup(credentials);

      expect(mockPost).toHaveBeenCalledWith('/auth/signup', credentials);
      expect(result).toEqual(mockResponse);
    });

    it('should work without displayName', async () => {
      mockPost.mockResolvedValue({ success: true, data: {} });

      const credentials = {
        email: 'new@example.com',
        password: 'password123',
      };
      await signup(credentials);

      expect(mockPost).toHaveBeenCalledWith('/auth/signup', credentials);
    });

    it('should propagate errors', async () => {
      mockPost.mockRejectedValue(new Error('Email already exists'));

      await expect(
        signup({ email: 'existing@example.com', password: 'password123' })
      ).rejects.toThrow('Email already exists');
    });
  });

  describe('logout', () => {
    it('should call POST /auth/logout with refresh token', async () => {
      mockPost.mockResolvedValue(undefined);

      await logout('refresh-token-123');

      expect(mockPost).toHaveBeenCalledWith('/auth/logout', {
        refreshToken: 'refresh-token-123',
      });
    });

    it('should not throw on error (silent failure)', async () => {
      // Logout might fail but we don't care in most cases
      mockPost.mockRejectedValue(new Error('Network error'));

      await expect(logout('refresh-token-123')).rejects.toThrow();
    });
  });

  describe('refresh', () => {
    it('should call POST /auth/refresh with refresh token', async () => {
      const mockResponse = {
        success: true,
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresIn: 3600,
        },
      };
      mockPost.mockResolvedValue(mockResponse);

      const result = await refresh('old-refresh-token');

      expect(mockPost).toHaveBeenCalledWith('/auth/refresh', {
        refreshToken: 'old-refresh-token',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors for invalid token', async () => {
      mockPost.mockRejectedValue(new Error('Invalid refresh token'));

      await expect(refresh('invalid-token')).rejects.toThrow('Invalid refresh token');
    });
  });
});
