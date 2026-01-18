/**
 * API Interceptor Helper
 * Captures and validates API calls made during E2E tests.
 */

import { Page, Route, Request } from '@playwright/test';

export interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
  timestamp: number;
}

/**
 * API Interceptor class for capturing and mocking API calls
 */
export class ApiInterceptor {
  private page: Page;
  private capturedRequests: CapturedRequest[] = [];
  private baseUrl: string;

  constructor(page: Page, baseUrl = 'http://localhost:3002/api/v1') {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  /**
   * Start intercepting API calls
   */
  async setup() {
    await this.page.route(`${this.baseUrl}/**`, async (route) => {
      const request = route.request();

      // Capture the request
      this.capturedRequests.push({
        url: request.url(),
        method: request.method(),
        body: this.parseBody(request),
        timestamp: Date.now(),
      });

      // Continue with the request (or mock it if needed)
      await route.continue();
    });
  }

  /**
   * Mock a specific endpoint
   */
  async mockEndpoint(
    pathPattern: string,
    response: unknown,
    options: {
      method?: string;
      status?: number;
      captureRequest?: boolean;
    } = {}
  ) {
    const { method = 'GET', status = 200, captureRequest = true } = options;

    await this.page.route(
      (url) => url.href.includes(pathPattern),
      async (route) => {
        const request = route.request();

        if (method && request.method() !== method) {
          // Use fallback() instead of continue() to let other handlers process this request
          await route.fallback();
          return;
        }

        if (captureRequest) {
          this.capturedRequests.push({
            url: request.url(),
            method: request.method(),
            body: this.parseBody(request),
            timestamp: Date.now(),
          });
        }

        await route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(response),
        });
      }
    );
  }

  /**
   * Mock SSE endpoint for anchor image streaming
   * Note: The anchor stream uses GET with query parameters (not POST with body)
   */
  async mockAnchorStream(
    companionId: string,
    events: Array<{ type: string; data: unknown }>,
    delayMs = 500
  ) {
    await this.page.route(
      (url) => url.href.includes('/imagegen/generate-anchors-stream'),
      async (route) => {
        const request = route.request();

        // Parse query parameters from the URL (since it's a GET request)
        const requestUrl = new URL(request.url());
        const params: Record<string, unknown> = {};
        requestUrl.searchParams.forEach((value, key) => {
          try {
            // Try to parse JSON values (appearance, personality are JSON strings)
            params[key] = JSON.parse(value);
          } catch {
            params[key] = value;
          }
        });

        // Capture the request with parsed params as body
        this.capturedRequests.push({
          url: request.url(),
          method: request.method(),
          body: { appearance: params.appearance, personality: params.personality, companionId: params.companionId },
          timestamp: Date.now(),
        });

        // Build SSE response
        const sseBody = events
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
          .join('');

        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: {
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
          body: sseBody,
        });
      }
    );
  }

  /**
   * Get all captured requests
   */
  getCapturedRequests(): CapturedRequest[] {
    return [...this.capturedRequests];
  }

  /**
   * Get requests for a specific endpoint pattern
   */
  getRequestsForEndpoint(pattern: string): CapturedRequest[] {
    return this.capturedRequests.filter((req) => req.url.includes(pattern));
  }

  /**
   * Get the last request for a specific endpoint
   */
  getLastRequestForEndpoint(pattern: string): CapturedRequest | undefined {
    const requests = this.getRequestsForEndpoint(pattern);
    return requests[requests.length - 1];
  }

  /**
   * Clear captured requests
   */
  clearCapturedRequests() {
    this.capturedRequests = [];
  }

  /**
   * Assert that a request was made to a specific endpoint
   * @param pattern URL pattern to match (substring match)
   * @param method HTTP method to filter by
   * @param exactEnd If true, the URL path must END with the pattern (useful for /companions vs /companions/id)
   */
  assertRequestMade(pattern: string, method?: string, exactEnd: boolean = false): CapturedRequest {
    let requests = this.getRequestsForEndpoint(pattern);

    // If exactEnd is true, filter to only URLs where the path ends with the pattern
    if (exactEnd) {
      requests = requests.filter((req) => {
        const url = new URL(req.url);
        return url.pathname.endsWith(pattern);
      });
    }

    const filtered = method
      ? requests.filter((r) => r.method === method)
      : requests;

    if (filtered.length === 0) {
      throw new Error(
        `Expected request to ${pattern}${method ? ` with method ${method}` : ''}${exactEnd ? ' (exact end)' : ''} but none was made. ` +
        `Captured requests: ${JSON.stringify(this.capturedRequests.map((r) => `${r.method} ${r.url}`))}`
      );
    }

    // Return the first match (most likely the intended request)
    return filtered[0];
  }

  /**
   * Get the first request matching the pattern
   */
  getFirstRequestForEndpoint(pattern: string, method?: string): CapturedRequest | undefined {
    const requests = this.getRequestsForEndpoint(pattern);
    const filtered = method
      ? requests.filter((r) => r.method === method)
      : requests;
    return filtered[0];
  }

  /**
   * Parse request body safely
   */
  private parseBody(request: Request): unknown {
    try {
      const postData = request.postData();
      if (postData) {
        return JSON.parse(postData);
      }
    } catch {
      // Return raw string if not JSON
      return request.postData();
    }
    return null;
  }
}

/**
 * Create an API interceptor for the page
 */
export function createApiInterceptor(page: Page, baseUrl?: string): ApiInterceptor {
  return new ApiInterceptor(page, baseUrl);
}

/**
 * Mock user data for authentication
 */
export const mockUser = {
  id: 'user_test123',
  email: 'test@example.com',
  displayName: 'Test User',
  role: 'user',
  isVerified: true,
  createdAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
};

/**
 * Mock auth tokens
 */
export const mockTokens = {
  accessToken: 'mock_access_token_for_testing',
  refreshToken: 'mock_refresh_token_for_testing',
  expiresIn: 3600,
};

/**
 * Set up mock authentication state in localStorage before navigating
 * This must be called after page is created but before navigating to app pages
 */
export async function setupMockAuth(page: Page): Promise<void> {
  // Set up localStorage with mock auth state
  const authState = {
    state: {
      user: mockUser,
      accessToken: mockTokens.accessToken,
      refreshToken: mockTokens.refreshToken,
      expiresAt: Date.now() + mockTokens.expiresIn * 1000,
      isImpersonating: false,
      impersonationState: null,
    },
    version: 0,
  };

  // Use addInitScript to set localStorage BEFORE the app loads
  await page.addInitScript((authStateStr) => {
    localStorage.setItem('campfire-auth', authStateStr);
  }, JSON.stringify(authState));
}

/**
 * Set up mock authentication state directly in the Zustand store
 * This must be called AFTER page.goto() and before interacting with the page
 */
export async function injectMockAuth(page: Page): Promise<void> {
  await page.evaluate((auth) => {
    // Set localStorage for persistence
    const authState = {
      state: {
        user: auth.user,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        expiresAt: Date.now() + 3600 * 1000,
        isImpersonating: false,
        impersonationState: null,
      },
      version: 0,
    };
    localStorage.setItem('campfire-auth', JSON.stringify(authState));

    // Also directly update the Zustand store if it's exposed
    const authStore = (window as unknown as { useAuthStore?: { setState: (state: Record<string, unknown>) => void } }).useAuthStore;
    if (authStore) {
      authStore.setState({
        user: auth.user,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        expiresAt: Date.now() + 3600 * 1000,
        isLoading: false,
        isInitialized: true,
      });
    }
  }, { user: mockUser, accessToken: mockTokens.accessToken, refreshToken: mockTokens.refreshToken });
}
