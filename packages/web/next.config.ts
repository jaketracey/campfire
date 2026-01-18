import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  reactCompiler: true,
  devIndicators: false,
  // Disabled to allow request-based (host) branding in layout metadata.
  cacheComponents: false,
  typedRoutes: true,
  transpilePackages: ['@campfire/shared'],
  // Proxy API requests to gateway (needed for ngrok/external access)
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:3002/api/v1/:path*',
      },
    ];
  },
  // Headers for WASM/SharedArrayBuffer support (required for VAD voice calls)
  // COOP/COEP must be set on pages that use voice, not just the resources
  // Using 'same-origin-allow-popups' to allow OAuth popups while enabling SharedArrayBuffer
  // Using 'credentialless' instead of 'require-corp' to allow S3 images without CORS headers
  async headers() {
    // CSP for Flowguard payment + Meta Pixel
    const flowguardCSP = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://flowguard.yoursafe.com https://connect.facebook.net",
      "style-src 'self' 'unsafe-inline'",
      "frame-src https://flowguard.yoursafe.com https://www.facebook.com",
      "connect-src 'self' https://flowguard.yoursafe.com https://www.facebook.com http://localhost:* ws://localhost:*",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
    ].join('; ');

    return [
      {
        // Apply to chat pages where voice calls are used
        source: '/chat/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      {
        // Apply to account pages with Flowguard payment integration
        source: '/account/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: flowguardCSP },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.campfire.app',
      },
      {
        protocol: 'https',
        hostname: '**.ignite.cam',
      },
      {
        protocol: 'https',
        hostname: 'campfire-dev-media.s3.us-east-1.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'campfire-staging-media.s3.us-east-1.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'campfire-prod-media.s3.us-east-1.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'campfire-stealth-media.s3.us-east-1.amazonaws.com',
      },
    ],
  },
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
  turbopack: {
    // Set to monorepo root for shared package access
    // In Docker, monorepo root is /app. Locally, use relative path.
    root: process.env.DOCKER_BUILD === '1' ? '/app' : '../..',
  },
};

export default nextConfig;
