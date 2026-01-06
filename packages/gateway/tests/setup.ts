import { vi } from 'vitest';

// Set test environment variables
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-jwt-secret-for-testing-only-min-32-chars';
process.env['JWT_ISSUER'] = 'campfire-test';
process.env['JWT_AUDIENCE'] = 'campfire-api-test';
process.env['INTERNAL_SERVICE_KEY'] = 'test-internal-service-key';

// Create mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => mockLogger),
};

// Mock the logger module directly
vi.mock('../src/observability/logger.js', () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));
