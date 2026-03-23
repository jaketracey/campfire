import { useEffect, useCallback } from 'react';
import * as Linking from 'expo-linking';
import type { WebView } from 'react-native-webview';

/**
 * Deep link URL patterns:
 * - ignite://chat/{sessionId}    -> /chat/{sessionId}
 * - ignite://onboarding          -> /onboard
 * - ignite://account             -> /account
 * - ignite://account/tokens      -> /account/tokens
 * - ignite://account/media       -> /account/media
 *
 * Universal links:
 * - https://ignite.cam/chat/{id}
 * - https://ignite.cam/onboard
 * - https://ignite.cam/account/*
 */

export interface UseDeepLinkingOptions {
  baseUrl: string;
}

/**
 * Parse a deep link URL into a web app path
 */
export function parseDeepLinkToPath(url: string, baseUrl: string): string | null {
  try {
    const parsed = Linking.parse(url);

    // Handle ignite:// scheme
    if (parsed.scheme === 'ignite') {
      const path = parsed.path || '';
      const queryString = parsed.queryParams
        ? '?' + new URLSearchParams(parsed.queryParams as Record<string, string>).toString()
        : '';

      // Map paths
      if (path.startsWith('chat/')) {
        return `/${path}${queryString}`;
      }
      if (path === 'onboarding' || path === 'onboard') {
        return `/onboard${queryString}`;
      }
      if (path.startsWith('account')) {
        return `/${path}${queryString}`;
      }

      // Default: try the path as-is
      return `/${path}${queryString}`;
    }

    // Handle universal links (https://)
    if (parsed.scheme === 'https' || parsed.scheme === 'http') {
      const urlObj = new URL(url);
      const baseUrlObj = new URL(baseUrl);

      // Only handle links from our domain
      if (urlObj.host === baseUrlObj.host) {
        return urlObj.pathname + urlObj.search;
      }
    }

    return null;
  } catch (error) {
    console.error('[DeepLinking] Parse error:', error);
    return null;
  }
}

/**
 * Hook for handling deep links
 */
export function useDeepLinking(
  webViewRef: React.RefObject<WebView | null>,
  options: UseDeepLinkingOptions
): void {
  const { baseUrl } = options;

  /**
   * Navigate the WebView to a path
   */
  const navigateWebView = useCallback(
    (path: string) => {
      console.log('[DeepLinking] Navigating to:', path);
      webViewRef.current?.injectJavaScript(`
        window.location.href = ${JSON.stringify(path)};
        true;
      `);
    },
    [webViewRef]
  );

  /**
   * Handle an incoming URL
   */
  const handleUrl = useCallback(
    (url: string) => {
      const path = parseDeepLinkToPath(url, baseUrl);
      if (path) {
        navigateWebView(path);
      }
    },
    [baseUrl, navigateWebView]
  );

  useEffect(() => {
    // Handle the URL that opened the app (cold start)
    const handleInitialUrl = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        console.log('[DeepLinking] Initial URL:', initialUrl);
        handleUrl(initialUrl);
      }
    };

    handleInitialUrl();

    // Handle URLs while the app is running (warm start)
    const subscription = Linking.addEventListener('url', ({ url }) => {
      console.log('[DeepLinking] URL event:', url);
      handleUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleUrl]);
}

/**
 * Create a deep link URL for sharing
 */
export function createDeepLink(path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `ignite://${cleanPath}`;
}

/**
 * Create a universal link URL for sharing
 */
export function createUniversalLink(path: string, baseUrl: string): string {
  // Ensure path starts with /
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
}
