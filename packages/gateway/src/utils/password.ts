/**
 * Password Hashing Utilities
 * Uses bcrypt for secure password hashing.
 */

import bcrypt from 'bcrypt';

// Cost factor for bcrypt (12 is recommended for production - provides good security/performance balance)
const SALT_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a bcrypt hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
