/**
 * Auth Routes Integration Tests
 * Tests for signup, login, logout, refresh, and session endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authRoutes } from '../../src/routes/auth.js';

// Mock the auth middleware
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn(async (request, reply) => {
    // Check for mock user in test
    if (request.headers.authorization === 'Bearer valid-token') {
      request.user = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };
      return; // Continue to handler
    }
    // Send 401 and stop request
    return reply.status(401).send({ error: 'Unauthorized' });
  }),
  createToken: vi.fn().mockResolvedValue('mock-access-token'),
  createRefreshToken: vi.fn().mockResolvedValue('mock-refresh-token'),
  verifyRefreshToken: vi.fn(),
}));

// Mock the auth service
const mockAuthService = {
  register: vi.fn(),
  login: vi.fn(),
};

vi.mock('../../src/services/auth.js', () => ({
  getAuthService: () => mockAuthService,
}));

// Mock the users repository
const mockUsersRepo = {
  findById: vi.fn(),
  updateProfile: vi.fn(),
};

vi.mock('../../src/repositories/index.js', () => ({
  getUsersRepository: () => mockUsersRepo,
}));

// Import mocked modules for assertions
import { createToken, createRefreshToken, verifyRefreshToken } from '../../src/middleware/auth.js';

describe('Auth Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify();
    await app.register(authRoutes, { prefix: '/auth' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /auth/signup', () => {
    it('should create a new user successfully', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'newuser@example.com',
        email_verified: false,
        created_at: new Date('2024-01-01'),
      };

      mockAuthService.register.mockResolvedValue({ user: mockUser });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'newuser@example.com',
          password: 'SecurePass123',
          displayName: 'New User',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.user.email).toBe('newuser@example.com');
      expect(body.data.tokens.accessToken).toBe('mock-access-token');
      expect(body.data.tokens.refreshToken).toBe('mock-refresh-token');
      expect(body.data.tokens.tokenType).toBe('Bearer');
    });

    it('should update display name when provided', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'newuser@example.com',
        email_verified: false,
        created_at: new Date('2024-01-01'),
      };

      mockAuthService.register.mockResolvedValue({ user: mockUser });
      mockUsersRepo.updateProfile.mockResolvedValue({});

      await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'newuser@example.com',
          password: 'SecurePass123',
          displayName: 'New User',
        },
      });

      expect(mockUsersRepo.updateProfile).toHaveBeenCalledWith('user-123', {
        display_name: 'New User',
      });
    });

    it('should reject invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'invalid-email',
          password: 'SecurePass123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'user@example.com',
          password: 'short',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate email', async () => {
      mockAuthService.register.mockRejectedValue({
        code: 'EMAIL_EXISTS',
        message: 'Email already exists',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'existing@example.com',
          password: 'SecurePass123',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('EMAIL_EXISTS');
    });
  });

  describe('POST /auth/login', () => {
    it('should login user successfully', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'user@example.com',
      };

      mockAuthService.login.mockResolvedValue({
        user: mockUser,
        requiresMFA: false,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.user.email).toBe('user@example.com');
      expect(body.data.tokens.accessToken).toBe('mock-access-token');
      expect(body.data.tokens.refreshToken).toBe('mock-refresh-token');
    });

    it('should return MFA required response when enabled', async () => {
      mockAuthService.login.mockResolvedValue({
        requiresMFA: true,
        mfaMethods: ['totp', 'sms'],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.requiresMFA).toBe(true);
      expect(body.data.mfaMethods).toEqual(['totp', 'sms']);
    });

    it('should reject invalid credentials', async () => {
      mockAuthService.login.mockRejectedValue({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should handle account locked', async () => {
      mockAuthService.login.mockRejectedValue({
        code: 'ACCOUNT_LOCKED',
        message: 'Account locked for 15 minutes',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('should handle account suspended', async () => {
      mockAuthService.login.mockRejectedValue({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('should reject missing password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user@example.com',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout authenticated user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('Logged out successfully');
    });

    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh tokens successfully', async () => {
      const mockVerifyRefreshToken = verifyRefreshToken as unknown as ReturnType<typeof vi.fn>;
      mockVerifyRefreshToken.mockResolvedValue('user-123');

      mockUsersRepo.findById.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'valid-refresh-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.accessToken).toBe('mock-access-token');
      expect(body.data.refreshToken).toBe('mock-refresh-token');
    });

    it('should reject invalid refresh token', async () => {
      const mockVerifyRefreshToken = verifyRefreshToken as unknown as ReturnType<typeof vi.fn>;
      mockVerifyRefreshToken.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'invalid-refresh-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should reject when user not found', async () => {
      const mockVerifyRefreshToken = verifyRefreshToken as unknown as ReturnType<typeof vi.fn>;
      mockVerifyRefreshToken.mockResolvedValue('nonexistent-user');
      mockUsersRepo.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'valid-token-deleted-user',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should reject missing refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /auth/session', () => {
    it('should return session info for authenticated user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.user.id).toBe('user-123');
      expect(body.data.user.email).toBe('test@example.com');
      expect(body.data.user.role).toBe('user');
    });

    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/session',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
