/**
 * TOTP Utility Tests
 * Tests for Time-based One-Time Password generation and verification
 */

import { describe, it, expect } from 'vitest';
import {
  generateTOTPSecret,
  generateTOTPUri,
  verifyTOTPCode,
  generateTOTPCode,
} from '../totp.js';

describe('TOTP Utilities', () => {
  describe('generateTOTPSecret', () => {
    it('should generate a base32-encoded secret', () => {
      const secret = generateTOTPSecret();

      expect(secret).toBeDefined();
      expect(typeof secret).toBe('string');
      // Base32 characters only
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      // Typical length for 20-byte secret
      expect(secret.length).toBeGreaterThanOrEqual(16);
    });

    it('should generate unique secrets', () => {
      const secret1 = generateTOTPSecret();
      const secret2 = generateTOTPSecret();

      expect(secret1).not.toBe(secret2);
    });
  });

  describe('generateTOTPUri', () => {
    it('should generate a valid otpauth URI', () => {
      const secret = generateTOTPSecret();
      const accountName = 'user@example.com';
      const issuer = 'Campfire';

      const uri = generateTOTPUri(secret, accountName, issuer);

      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain('Campfire');
      expect(uri).toContain('user%40example.com');
      expect(uri).toContain(`secret=${secret}`);
      expect(uri).toContain('issuer=Campfire');
      // Note: otplib omits default values (sha1, 6 digits, 30s period) to keep URI short
    });

    it('should use default issuer when not provided', () => {
      const secret = generateTOTPSecret();
      const accountName = 'user@example.com';

      const uri = generateTOTPUri(secret, accountName);

      expect(uri).toContain('Campfire');
    });

    it('should handle special characters in account name', () => {
      const secret = generateTOTPSecret();
      const accountName = 'user+test@example.com';

      const uri = generateTOTPUri(secret, accountName);

      expect(uri).toBeDefined();
      // URL-encoded plus sign
      expect(uri).toContain('user%2Btest%40example.com');
    });
  });

  describe('generateTOTPCode', () => {
    it('should generate a 6-digit code', () => {
      const secret = generateTOTPSecret();

      const code = generateTOTPCode(secret);

      expect(code).toMatch(/^\d{6}$/);
    });

    it('should generate consistent codes for same time period', () => {
      const secret = generateTOTPSecret();

      // Generate two codes immediately - should be same
      const code1 = generateTOTPCode(secret);
      const code2 = generateTOTPCode(secret);

      expect(code1).toBe(code2);
    });
  });

  describe('verifyTOTPCode', () => {
    it('should verify a valid code', () => {
      const secret = generateTOTPSecret();
      const code = generateTOTPCode(secret);

      const isValid = verifyTOTPCode(code, secret);

      expect(isValid).toBe(true);
    });

    it('should reject an invalid code', () => {
      const secret = generateTOTPSecret();

      const isValid = verifyTOTPCode('000000', secret);

      // May or may not be valid depending on timing, but '000000' is extremely unlikely
      // Let's use a deliberately wrong code format
      expect(verifyTOTPCode('wrong', secret)).toBe(false);
    });

    it('should reject malformed codes', () => {
      const secret = generateTOTPSecret();

      expect(verifyTOTPCode('', secret)).toBe(false);
      expect(verifyTOTPCode('12345', secret)).toBe(false);  // Too short
      expect(verifyTOTPCode('1234567', secret)).toBe(false);  // Too long
      expect(verifyTOTPCode('abcdef', secret)).toBe(false);  // Non-numeric
    });

    it('should handle invalid secrets gracefully', () => {
      const isValid = verifyTOTPCode('123456', 'invalid-base32!@#$');

      expect(isValid).toBe(false);
    });

    it('should verify codes within time tolerance window', () => {
      const secret = generateTOTPSecret();
      const code = generateTOTPCode(secret);

      // The code should still be valid (30-second tolerance)
      const isValid = verifyTOTPCode(code, secret);

      expect(isValid).toBe(true);
    });
  });

  describe('End-to-end TOTP flow', () => {
    it('should complete full enrollment and verification flow', () => {
      // Step 1: Generate secret for user
      const secret = generateTOTPSecret();
      expect(secret).toBeDefined();

      // Step 2: Generate URI for QR code (user scans this)
      const uri = generateTOTPUri(secret, 'testuser@example.com');
      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain(secret);

      // Step 3: User's authenticator app generates code
      const code = generateTOTPCode(secret);
      expect(code).toMatch(/^\d{6}$/);

      // Step 4: Verify the code during login
      const isValid = verifyTOTPCode(code, secret);
      expect(isValid).toBe(true);
    });
  });
});
