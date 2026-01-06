import { describe, expect, it } from 'vitest';
import { parseWorkersEnv } from '../env.js';

describe('workers env', () => {
  it('requires DATABASE_URL and validates it', () => {
    expect(() => parseWorkersEnv({ NODE_ENV: 'test' })).toThrow();

    const env = parseWorkersEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    });
    expect(env.DATABASE_URL).toContain('postgres://');
  });

  it('parses SES_MAX_SEND_RATE as int', () => {
    const env = parseWorkersEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      SES_MAX_SEND_RATE: '42',
    });
    expect(env.SES_MAX_SEND_RATE).toBe(42);
  });
});

