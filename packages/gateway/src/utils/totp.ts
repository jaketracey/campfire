/**
 * TOTP (Time-based One-Time Password) Utilities
 * Uses otplib for RFC 6238 compliant TOTP verification
 */

import { generateSecret, generateSync, verifySync, generateURI } from 'otplib';

// TOTP configuration constants
const TOTP_CONFIG = {
  algorithm: 'sha1' as const,
  digits: 6 as const,
  period: 30, // 30-second time step (standard)
  epochTolerance: 30, // Allow 30 seconds tolerance for clock drift (1 step before/after)
};

/**
 * Generate a new TOTP secret
 */
export function generateTOTPSecret(): string {
  return generateSecret();
}

/**
 * Generate the provisioning URI for QR code
 */
export function generateTOTPUri(secret: string, accountName: string, issuer: string = 'Campfire'): string {
  return generateURI({
    issuer,
    label: accountName,
    secret,
    algorithm: TOTP_CONFIG.algorithm,
    digits: TOTP_CONFIG.digits,
    period: TOTP_CONFIG.period,
  });
}

/**
 * Verify a TOTP code against a secret
 * @param code - The 6-digit code to verify
 * @param secret - The TOTP secret (base32 encoded)
 * @returns true if valid, false otherwise
 */
export function verifyTOTPCode(code: string, secret: string): boolean {
  try {
    const result = verifySync({
      token: code,
      secret,
      algorithm: TOTP_CONFIG.algorithm,
      digits: TOTP_CONFIG.digits,
      period: TOTP_CONFIG.period,
      epochTolerance: TOTP_CONFIG.epochTolerance,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Generate current TOTP code (for testing only)
 */
export function generateTOTPCode(secret: string): string {
  return generateSync({
    secret,
    algorithm: TOTP_CONFIG.algorithm,
    digits: TOTP_CONFIG.digits,
    period: TOTP_CONFIG.period,
  });
}
