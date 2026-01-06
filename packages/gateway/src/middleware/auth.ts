/**
 * Authentication Middleware
 * JWT-based authentication using jose library.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import { timingSafeEqual } from 'crypto';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';

// JWT configuration (validated at startup)
if (!env.JWT_SECRET_BYTES) {
  throw new Error('FATAL: JWT_SECRET environment variable is required. Set it in your .env file.');
}
const JWT_SECRET = env.JWT_SECRET_BYTES;
const JWT_ISSUER = env.JWT_ISSUER;
const JWT_AUDIENCE = env.JWT_AUDIENCE;
const JWT_EXPIRY = env.JWT_EXPIRY;

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

/**
 * Authentication middleware - requires valid JWT
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
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

// Internal service authentication
if (!env.INTERNAL_SERVICE_KEY_BUFFER) {
  throw new Error('FATAL: INTERNAL_SERVICE_KEY environment variable is required. Set it in your .env file.');
}
const INTERNAL_SERVICE_KEY_BUFFER = env.INTERNAL_SERVICE_KEY_BUFFER;

/**
 * Internal service middleware - for service-to-service calls (orchestrator -> gateway)
 * Uses a shared secret key instead of JWT
 */
export async function requireInternalService(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const serviceKey = request.headers['x-internal-service-key'] as string | undefined;

  if (!serviceKey) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing internal service key',
    });
  }

  // Use timing-safe comparison to prevent timing attacks
  const serviceKeyBuffer = Buffer.from(serviceKey);
  const isValidLength = serviceKeyBuffer.length === INTERNAL_SERVICE_KEY_BUFFER.length;
  const isValidKey = isValidLength && timingSafeEqual(serviceKeyBuffer, INTERNAL_SERVICE_KEY_BUFFER);

  if (!isValidKey) {
    logger.warn({ ip: request.ip }, 'Invalid internal service key attempt');
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid internal service key',
    });
  }

  // Internal services are trusted - no user context needed
  logger.debug({ path: request.url }, 'Internal service request authenticated');
}
