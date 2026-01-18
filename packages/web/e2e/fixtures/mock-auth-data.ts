/**
 * Mock data for Auth E2E tests
 * These fixtures represent deterministic data for testing authentication flows.
 */

// ============================================================================
// User Data Fixtures
// ============================================================================

export const mockUser = {
  id: 'user_test123',
  email: 'test@example.com',
  displayName: 'Test User',
  role: 'user' as const,
  isVerified: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  lastLoginAt: '2024-01-15T10:30:00.000Z',
};

export const mockNewUser = {
  id: 'user_new456',
  email: 'newuser@example.com',
  displayName: 'New User',
  role: 'user' as const,
  isVerified: false,
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
};

// ============================================================================
// Token Fixtures
// ============================================================================

export const mockTokens = {
  accessToken: 'mock_access_token_for_testing_abc123',
  refreshToken: 'mock_refresh_token_for_testing_xyz789',
  expiresIn: 3600,
};

// ============================================================================
// Login Response Fixtures
// ============================================================================

export const mockLoginSuccessResponse = {
  user: mockUser,
  accessToken: mockTokens.accessToken,
  refreshToken: mockTokens.refreshToken,
  expiresIn: mockTokens.expiresIn,
};

export const mockLoginMFARequiredResponse = {
  requiresMFA: true,
  mfaToken: 'mfa_temp_token_123',
  methods: ['authenticator', 'sms'],
};

export const mockLoginErrorResponses = {
  invalidCredentials: {
    error: 'invalid_credentials',
    message: 'Invalid email or password',
    statusCode: 401,
  },
  accountSuspended: {
    error: 'account_suspended',
    message: 'Your account has been suspended. Please contact support.',
    statusCode: 403,
  },
  accountLocked: {
    error: 'account_locked',
    message: 'Your account has been locked due to too many failed login attempts. Try again in 30 minutes.',
    statusCode: 423,
  },
  serverError: {
    error: 'internal_server_error',
    message: 'An unexpected error occurred. Please try again later.',
    statusCode: 500,
  },
};

// ============================================================================
// Signup Response Fixtures
// ============================================================================

export const mockSignupSuccessResponse = {
  user: mockNewUser,
  accessToken: mockTokens.accessToken,
  refreshToken: mockTokens.refreshToken,
  expiresIn: mockTokens.expiresIn,
};

export const mockSignupErrorResponses = {
  emailExists: {
    error: 'email_exists',
    message: 'An account with this email already exists',
    statusCode: 409,
  },
  invalidEmail: {
    error: 'validation_error',
    message: 'Please enter a valid email address',
    statusCode: 400,
  },
  weakPassword: {
    error: 'weak_password',
    message: 'Password does not meet security requirements',
    statusCode: 400,
  },
};

// ============================================================================
// Google OAuth Response Fixtures
// ============================================================================

export const mockGoogleCredential = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock_google_credential';

export const mockGoogleLoginSuccessResponse = {
  user: mockUser,
  accessToken: mockTokens.accessToken,
  refreshToken: mockTokens.refreshToken,
  expiresIn: mockTokens.expiresIn,
  isNewUser: false,
};

export const mockGoogleSignupSuccessResponse = {
  user: mockNewUser,
  accessToken: mockTokens.accessToken,
  refreshToken: mockTokens.refreshToken,
  expiresIn: mockTokens.expiresIn,
  isNewUser: true,
};

export const mockGoogleAuthErrorResponses = {
  invalidToken: {
    error: 'invalid_token',
    message: 'Invalid Google authentication token',
    statusCode: 401,
  },
  accountLinkError: {
    error: 'account_link_error',
    message: 'An account with this email already exists using a different sign-in method',
    statusCode: 409,
  },
};

// ============================================================================
// MFA Response Fixtures
// ============================================================================

export const mockMFAVerifySuccessResponse = {
  user: mockUser,
  accessToken: mockTokens.accessToken,
  refreshToken: mockTokens.refreshToken,
  expiresIn: mockTokens.expiresIn,
};

export const mockMFAErrorResponses = {
  invalidCode: {
    error: 'invalid_code',
    message: 'Invalid verification code. Please try again.',
    statusCode: 401,
  },
  codeExpired: {
    error: 'code_expired',
    message: 'Verification code has expired. Please request a new one.',
    statusCode: 401,
  },
  tooManyAttempts: {
    error: 'too_many_attempts',
    message: 'Too many failed attempts. Please try again later.',
    statusCode: 429,
  },
};

// ============================================================================
// Forgot Password Response Fixtures
// ============================================================================

export const mockForgotPasswordSuccessResponse = {
  success: true,
  message: 'If an account with that email exists, we have sent password reset instructions.',
};

export const mockForgotPasswordErrorResponses = {
  rateLimited: {
    error: 'rate_limited',
    message: 'Too many password reset requests. Please try again later.',
    statusCode: 429,
  },
};

// ============================================================================
// Test Data Helpers
// ============================================================================

export const validLoginCredentials = {
  email: 'test@example.com',
  password: 'ValidPassword123!',
};

export const invalidLoginCredentials = {
  email: 'test@example.com',
  password: 'WrongPassword123!',
};

export const validSignupData = {
  name: 'New User',
  email: 'newuser@example.com',
  password: 'SecurePassword123!',
  confirmPassword: 'SecurePassword123!',
};

export const existingUserEmail = 'existing@example.com';

export const validMFACodes = {
  authenticator: '123456',
  sms: '654321',
};

export const invalidMFACode = '000000';

// ============================================================================
// UTM Parameter Fixtures
// ============================================================================

export const mockUtmParams = {
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'spring_sale',
  utm_term: 'ai_companion',
  utm_content: 'ad_variant_a',
};

// ============================================================================
// Auth State for localStorage
// ============================================================================

export function createMockAuthState(overrides: Partial<typeof mockUser> = {}) {
  return {
    state: {
      user: { ...mockUser, ...overrides },
      accessToken: mockTokens.accessToken,
      refreshToken: mockTokens.refreshToken,
      expiresAt: Date.now() + mockTokens.expiresIn * 1000,
      isImpersonating: false,
      impersonationState: null,
    },
    version: 0,
  };
}
