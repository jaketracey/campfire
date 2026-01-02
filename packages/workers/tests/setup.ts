import { vi } from 'vitest';

// Set test environment variables
process.env['NODE_ENV'] = 'test';
process.env['AWS_REGION'] = 'us-east-1';
process.env['DATABASE_URL'] = 'postgres://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';

// Create mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => mockLogger),
};

export { mockLogger };
