import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  requireAdmin,
  createRefreshToken,
  verifyRefreshToken,
} from '../../src/middleware/auth.js';

describe('Auth Middleware', () => {
  describe('createToken', () => {
    it('should create a valid JWT token', async () => {
      const token = await createToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should create different tokens for different users', async () => {
      const token1 = await createToken({
        userId: 'user-1',
        email: 'user1@example.com',
        role: 'user',
      });

      const token2 = await createToken({
        userId: 'user-2',
        email: 'user2@example.com',
        role: 'user',
      });

      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', async () => {
      const token = await createToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      const payload = await verifyToken(token);

      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe('user-123');
      expect(payload?.email).toBe('test@example.com');
      expect(payload?.role).toBe('user');
    });

    it('should reject an invalid token', async () => {
      const payload = await verifyToken('invalid-token');
      expect(payload).toBeNull();
    });

    it('should reject a malformed token', async () => {
      const payload = await verifyToken('not.a.valid.jwt.token');
      expect(payload).toBeNull();
    });

    it('should reject an empty token', async () => {
      const payload = await verifyToken('');
      expect(payload).toBeNull();
    });
  });

  describe('requireAuth', () => {
    it('should reject requests without authorization header', async () => {
      const mockRequest = {
        headers: {},
      } as any;

      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        sent: false,
      } as any;

      await requireAuth(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
      });
    });

    it('should reject requests with invalid scheme', async () => {
      const mockRequest = {
        headers: { authorization: 'Basic sometoken' },
      } as any;

      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        sent: false,
      } as any;

      await requireAuth(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(401);
    });

    it('should reject requests with invalid token', async () => {
      const mockRequest = {
        headers: { authorization: 'Bearer invalid-token' },
      } as any;

      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        sent: false,
      } as any;

      await requireAuth(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    });

    it('should accept valid Bearer token and attach user to request', async () => {
      const token = await createToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      const mockRequest = {
        headers: { authorization: `Bearer ${token}` },
      } as any;

      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        sent: false,
      } as any;

      await requireAuth(mockRequest, mockReply);

      expect(mockReply.status).not.toHaveBeenCalled();
      expect(mockRequest.user).toBeDefined();
      expect(mockRequest.user.userId).toBe('user-123');
      expect(mockRequest.user.email).toBe('test@example.com');
      expect(mockRequest.user.role).toBe('user');
    });
  });

  describe('optionalAuth', () => {
    it('should not attach user when no token provided', async () => {
      const mockRequest = {
        headers: {},
      } as any;

      const mockReply = {} as any;

      await optionalAuth(mockRequest, mockReply);

      expect(mockRequest.user).toBeUndefined();
    });

    it('should attach user when valid token provided', async () => {
      const token = await createToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      const mockRequest = {
        headers: { authorization: `Bearer ${token}` },
      } as any;

      const mockReply = {} as any;

      await optionalAuth(mockRequest, mockReply);

      expect(mockRequest.user).toBeDefined();
      expect(mockRequest.user.userId).toBe('user-123');
    });

    it('should not attach user when invalid token provided', async () => {
      const mockRequest = {
        headers: { authorization: 'Bearer invalid-token' },
      } as any;

      const mockReply = {} as any;

      await optionalAuth(mockRequest, mockReply);

      expect(mockRequest.user).toBeUndefined();
    });
  });

  describe('requireAdmin', () => {
    it('should reject non-admin users', async () => {
      const token = await createToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      const mockRequest = {
        headers: { authorization: `Bearer ${token}` },
      } as any;

      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        sent: false,
      } as any;

      await requireAdmin(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(403);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    });

    it('should accept admin users', async () => {
      const token = await createToken({
        userId: 'admin-123',
        email: 'admin@example.com',
        role: 'admin',
      });

      const mockRequest = {
        headers: { authorization: `Bearer ${token}` },
      } as any;

      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        sent: false,
      } as any;

      await requireAdmin(mockRequest, mockReply);

      expect(mockReply.status).not.toHaveBeenCalled();
      expect(mockRequest.user.role).toBe('admin');
    });
  });

  describe('createRefreshToken', () => {
    it('should create a refresh token', async () => {
      const token = await createRefreshToken('user-123');

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify a valid refresh token', async () => {
      const token = await createRefreshToken('user-123');
      const userId = await verifyRefreshToken(token);

      expect(userId).toBe('user-123');
    });

    it('should reject an invalid refresh token', async () => {
      const userId = await verifyRefreshToken('invalid-token');
      expect(userId).toBeNull();
    });

    it('should reject an access token used as refresh token', async () => {
      const accessToken = await createToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      const userId = await verifyRefreshToken(accessToken);
      expect(userId).toBeNull();
    });
  });
});
