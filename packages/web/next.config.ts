import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  devIndicators: {},
  cacheComponents: true,
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
    return [
      {
        // Apply to chat pages where voice calls are used
        source: '/chat/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
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
    ],
  },
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
};

export default nextConfig;
