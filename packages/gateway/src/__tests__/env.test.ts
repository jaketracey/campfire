import { describe, expect, it } from 'vitest';
import { parseGatewayEnv } from '../env.js';

describe('gateway env', () => {
  it('parses required secrets when provided', () => {
    const env = parseGatewayEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret',
      INTERNAL_SERVICE_KEY: 'test-internal-service-key',
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.JWT_SECRET_BYTES).toBeInstanceOf(Uint8Array);
    expect(env.INTERNAL_SERVICE_KEY_BUFFER).toBeInstanceOf(Buffer);
    expect(env.JWT_AFFILIATE_SECRET_BYTES).toBeInstanceOf(Uint8Array);
  });

  it('does not require secrets during parsing (bytes stay undefined)', () => {
    const env = parseGatewayEnv({ NODE_ENV: 'test' });
    expect(env.JWT_SECRET_BYTES).toBeUndefined();
    expect(env.INTERNAL_SERVICE_KEY_BUFFER).toBeUndefined();
    expect(env.JWT_AFFILIATE_SECRET_BYTES).toBeUndefined();
  });

  it('parses csv CORS origins', () => {
    const env = parseGatewayEnv({
      NODE_ENV: 'test',
      CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects invalid numeric values', () => {
    expect(() =>
      parseGatewayEnv({
        NODE_ENV: 'test',
        PORT: 'not-a-number',
      })
    ).toThrow();
  });
});

