/**
 * Affiliate Authentication Middleware
 * Separate JWT-based authentication for affiliate portal.
 * Uses distinct issuer to prevent token confusion with user authentication.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import { logger } from '../observability/logger.js';
import { getAffiliatesService } from '../services/affiliates.js';

// Affiliate JWT configuration - uses separate issuer from user JWT
const JWT_SECRET = new TextEncoder().encode(
  process.env['JWT_AFFILIATE_SECRET'] ?? process.env['JWT_SECRET'] ?? 'development-secret-change-in-production'
);
const JWT_ISSUER = 'campfire-affiliate'; // Different from user JWT issuer
const JWT_AUDIENCE = 'campfire-affiliate-portal';
const JWT_EXPIRY = '30d'; // Longer expiry for affiliates

/**
 * Authenticated affiliate attached to request
 */
export interface AuthenticatedAffiliate {
  affiliateId: string;
  email: string;
  code: string;
}

/**
 * Extend FastifyRequest with affiliate property
 */
declare module 'fastify' {
  interface FastifyRequest {
    affiliate?: AuthenticatedAffiliate;
  }
}

/**
 * Affiliate JWT payload structure
 */
interface AffiliateJWTPayload extends jose.JWTPayload {
  affiliateId: string;
  email: string;
  code: string;
}

/**
 * Create a JWT token for an affiliate
 */
export async function createAffiliateToken(affiliate: AuthenticatedAffiliate): Promise<string> {
  const token = await new jose.SignJWT({
    affiliateId: affiliate.affiliateId,
    email: affiliate.email,
    code: affiliate.code,
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
 * Verify and decode an affiliate JWT token
 */
export async function verifyAffiliateToken(token: string): Promise<AffiliateJWTPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    // Validate required fields
    if (!payload.affiliateId || !payload.email || !payload.code) {
      return null;
    }

    return payload as AffiliateJWTPayload;
  } catch (error) {
    logger.debug({ err: error }, 'Affiliate JWT verification failed');
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
 * Affiliate authentication middleware - requires valid affiliate JWT
 */
export async function requireAffiliateAuth(
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

  const payload = await verifyAffiliateToken(token);

  if (!payload) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired affiliate token',
    });
  }

  // Verify affiliate still exists and is active
  const affiliatesService = getAffiliatesService();
  const affiliate = await affiliatesService.getAffiliate(payload.affiliateId);

  if (!affiliate) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Affiliate account not found',
    });
  }

  if (affiliate.status !== 'active') {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Affiliate account is not active',
    });
  }

  // Attach affiliate to request
  request.affiliate = {
    affiliateId: payload.affiliateId,
    email: payload.email,
    code: payload.code,
  };
}

/**
 * Optional affiliate authentication - attaches affiliate if token present but doesn't require it
 */
export async function optionalAffiliateAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    return;
  }

  const payload = await verifyAffiliateToken(token);

  if (payload) {
    // Verify affiliate still exists and is active
    const affiliatesService = getAffiliatesService();
    const affiliate = await affiliatesService.getAffiliate(payload.affiliateId);

    if (affiliate && affiliate.status === 'active') {
      request.affiliate = {
        affiliateId: payload.affiliateId,
        email: payload.email,
        code: payload.code,
      };
    }
  }
}

/**
 * Create affiliate token hash for session storage
 * Used to identify sessions without storing the raw token
 */
export function hashAffiliateToken(token: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}
