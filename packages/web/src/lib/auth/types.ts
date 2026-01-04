/**
 * Auth Types
 * Type definitions for authentication flow.
 */

export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  displayName?: string;
  emailVerified: boolean;
  role: UserRole;
  createdAt: string;
  preferences?: Record<string, unknown>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

export interface AuthSession {
  user: User;
  tokens: AuthTokens;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupCredentials {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginResponse {
  success: boolean;
  data?: {
    user: User;
    tokens: AuthTokens;
    requiresMFA?: boolean;
    mfaMethods?: string[];
  } | {
    requiresMFA: true;
    mfaMethods: string[];
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface SignupResponse {
  success: boolean;
  data?: {
    user: User;
    tokens: AuthTokens;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface RefreshResponse {
  success: boolean;
  data?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface SessionResponse {
  success: boolean;
  data?: {
    user: User;
  };
  error?: {
    code: string;
    message: string;
  };
}

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_EXISTS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_SUSPENDED'
  | 'SESSION_EXPIRED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'
  | 'OAUTH_INVALID_TOKEN'
  | 'OAUTH_CANCELLED'
  | 'OAUTH_POPUP_BLOCKED';

export interface GoogleAuthCredentials {
  idToken: string;
}

export interface GoogleAuthResponse {
  success: boolean;
  data?: {
    user: User;
    tokens: AuthTokens;
  };
  error?: {
    code: string;
    message: string;
  };
}
