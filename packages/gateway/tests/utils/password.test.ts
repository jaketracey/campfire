import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';

describe('Password Utilities', () => {
  describe('hashPassword', () => {
    it('should generate a bcrypt hash', async () => {
      const hash = await hashPassword('testpassword123');
      // bcrypt hashes start with $2b$
      expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('should generate different hashes for the same password (due to salt)', async () => {
      const hash1 = await hashPassword('testpassword123');
      const hash2 = await hashPassword('testpassword123');
      expect(hash1).not.toBe(hash2);
    });

    it('should generate hash of expected length', async () => {
      const hash = await hashPassword('testpassword123');
      // bcrypt hashes are 60 characters
      expect(hash).toHaveLength(60);
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const hash = await hashPassword('testpassword123');
      const result = await verifyPassword('testpassword123', hash);
      expect(result).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hash = await hashPassword('testpassword123');
      const result = await verifyPassword('wrongpassword', hash);
      expect(result).toBe(false);
    });

    it('should reject empty password', async () => {
      const hash = await hashPassword('testpassword123');
      const result = await verifyPassword('', hash);
      expect(result).toBe(false);
    });

    it('should handle special characters in password', async () => {
      const password = 'test@#$%^&*()_+{}|:"<>?';
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should handle unicode characters in password', async () => {
      const password = 'test\u{1F600}password\u4e2d\u6587';
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });
  });
});
