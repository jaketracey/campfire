/**
 * Auth API
 * Functions for authentication endpoints.
 */

import { post } from './client';
import type {
  LoginCredentials,
  SignupCredentials,
  LoginResponse,
  SignupResponse,
  RefreshResponse,
  GoogleAuthCredentials,
  GoogleAuthResponse,
} from '../auth/types';

/**
 * Login with email and password
 */
export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  return post<LoginResponse>('/auth/login', credentials);
}

/**
 * Register a new user
 */
export async function signup(credentials: SignupCredentials): Promise<SignupResponse> {
  return post<SignupResponse>('/auth/signup', credentials);
}

/**
 * Logout (revoke session)
 */
export async function logout(refreshToken: string): Promise<void> {
  await post('/auth/logout', { refreshToken });
}

/**
 * Refresh access token
 */
export async function refresh(refreshToken: string): Promise<RefreshResponse> {
  return post<RefreshResponse>('/auth/refresh', { refreshToken });
}

/**
 * Authenticate with Google OAuth
 */
export async function googleAuth(credentials: GoogleAuthCredentials): Promise<GoogleAuthResponse> {
  return post<GoogleAuthResponse>('/auth/google', credentials);
}
