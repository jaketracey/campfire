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
      async (route, request) => {
        if (method && request.method() !== method) {
          await route.continue();
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
   */
  async mockAnchorStream(
    companionId: string,
    events: Array<{ type: string; data: unknown }>,
    delayMs = 500
  ) {
    await this.page.route(
      (url) => url.href.includes('/imagegen/generate-anchors-stream'),
      async (route, request) => {
        // Capture the request
        this.capturedRequests.push({
          url: request.url(),
          method: request.method(),
          body: this.parseBody(request),
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
   */
  assertRequestMade(pattern: string, method?: string): CapturedRequest {
    const requests = this.getRequestsForEndpoint(pattern);
    const filtered = method
      ? requests.filter((r) => r.method === method)
      : requests;

    if (filtered.length === 0) {
      throw new Error(
        `Expected request to ${pattern}${method ? ` with method ${method}` : ''} but none was made. ` +
        `Captured requests: ${JSON.stringify(this.capturedRequests.map((r) => `${r.method} ${r.url}`))}`
      );
    }

    return filtered[filtered.length - 1];
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
