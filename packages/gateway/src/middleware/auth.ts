/**
 * Authentication Middleware
 * JWT-based authentication using jose library.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import { logger } from '../observability/logger.js';

// JWT configuration
const JWT_SECRET = new TextEncoder().encode(
  process.env['JWT_SECRET'] ?? 'development-secret-change-in-production'
);
const JWT_ISSUER = process.env['JWT_ISSUER'] ?? 'campfire';
const JWT_AUDIENCE = process.env['JWT_AUDIENCE'] ?? 'campfire-api';
const JWT_EXPIRY = process.env['JWT_EXPIRY'] ?? '24h';

/**
 * Authenticated user attached to request
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  sessionId?: string;
}

/**
 * Extend FastifyRequest with user property
 */
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * JWT payload structure
 */
interface JWTPayload extends jose.JWTPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
}

/**
 * Create a JWT token for a user
 */
export async function createToken(user: AuthenticatedUser): Promise<string> {
  const token = await new jose.SignJWT({
    userId: user.userId,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);

  return token;
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return payload as JWTPayload;
  } catch (error) {
    logger.debug({ err: error }, 'JWT verification failed');
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

// Dev user for bypassing auth in development
export const DEV_USER: AuthenticatedUser = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'dev@campfire.local',
  role: 'user',
};

/**
 * Authentication middleware - requires valid JWT
 * In development mode, bypasses auth and uses a dev user
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Dev mode bypass
  if (process.env['NODE_ENV'] === 'development') {
    request.user = DEV_USER;
    return;
  }

  const token = extractToken(request);

  if (!token) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid authorization header',
    });
  }

  const payload = await verifyToken(token);

  if (!payload) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }

  // Attach user to request
  request.user = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  };
}

/**
 * Optional authentication - attaches user if token present but doesn't require it
 */
export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    return;
  }

  const payload = await verifyToken(token);

  if (payload) {
    request.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };
  }
}

/**
 * Admin-only middleware - requires admin role
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await requireAuth(request, reply);

  if (reply.sent) {
    return;
  }

  if (request.user?.role !== 'admin') {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Admin access required',
    });
  }
}

/**
 * Create a refresh token (longer-lived)
 */
export async function createRefreshToken(userId: string): Promise<string> {
  const token = await new jose.SignJWT({ userId, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  return token;
}

/**
 * Verify a refresh token
 */
export async function verifyRefreshToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (payload.type !== 'refresh') {
      return null;
    }

    return payload.userId as string;
  } catch {
    return null;
  }
}
