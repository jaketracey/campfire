/**
 * Base API Client
 * Handles HTTP requests to the gateway API.
 */

import { getAccessToken } from '@/stores/auth-store';

const API_BASE_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3002';

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body?: unknown
  ) {
    super(ApiError.extractMessage(status, body));
    this.name = 'ApiError';
  }

  /**
   * Extract a human-readable message from the API response
   */
  private static extractMessage(status: number, body: unknown): string {
    // Try to get message from response body
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      // Check for error.message in response
      if (b.error && typeof b.error === 'object') {
        const err = b.error as Record<string, unknown>;
        if (typeof err.message === 'string') {
          return err.message;
        }
      }
      // Check for direct message
      if (typeof b.message === 'string') {
        return b.message;
      }
    }

    // Fallback to friendly status messages
    switch (status) {
      case 400:
        return 'Please check your input and try again';
      case 401:
        return 'Invalid email or password';
      case 403:
        return 'You don\'t have permission to do that';
      case 404:
        return 'The requested resource was not found';
      case 409:
        return 'This email is already registered';
      case 429:
        return 'Too many attempts. Please wait and try again';
      case 500:
        return 'Something went wrong. Please try again later';
      default:
        return 'An unexpected error occurred';
    }
  }
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Make an API request
 */
export async function apiClient<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, ...fetchOptions } = options;

  // Build URL with query params
  let url = `${API_BASE_URL}/api/v1${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  // Default headers
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...fetchOptions.headers,
  };

  // Auto-include auth token if available
  const accessToken = getAccessToken();
  if (accessToken && !('Authorization' in headers)) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Response might not be JSON
    }
    throw new ApiError(response.status, response.statusText, body);
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/**
 * GET request helper
 */
export function get<T>(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  return apiClient<T>(endpoint, { method: 'GET', params });
}

/**
 * POST request helper
 */
export function post<T>(endpoint: string, body?: unknown): Promise<T> {
  return apiClient<T>(endpoint, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * PATCH request helper
 */
export function patch<T>(endpoint: string, body?: unknown): Promise<T> {
  return apiClient<T>(endpoint, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * DELETE request helper
 */
export function del<T>(endpoint: string): Promise<T> {
  return apiClient<T>(endpoint, { method: 'DELETE' });
}

/**
 * Make an authenticated API request
 */
export async function authenticatedApiClient<T>(
  endpoint: string,
  options: RequestOptions = {},
  accessToken: string
): Promise<T> {
  return apiClient<T>(endpoint, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

/**
 * Authenticated GET request helper
 */
export function authGet<T>(
  endpoint: string,
  accessToken: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  return authenticatedApiClient<T>(endpoint, { method: 'GET', params }, accessToken);
}

/**
 * Authenticated POST request helper
 */
export function authPost<T>(
  endpoint: string,
  accessToken: string,
  body?: unknown
): Promise<T> {
  return authenticatedApiClient<T>(
    endpoint,
    {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    },
    accessToken
  );
}

/**
 * Authenticated PATCH request helper
 */
export function authPatch<T>(
  endpoint: string,
  accessToken: string,
  body?: unknown
): Promise<T> {
  return authenticatedApiClient<T>(
    endpoint,
    {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    },
    accessToken
  );
}

/**
 * Authenticated DELETE request helper
 */
export function authDel<T>(endpoint: string, accessToken: string): Promise<T> {
  return authenticatedApiClient<T>(endpoint, { method: 'DELETE' }, accessToken);
}
