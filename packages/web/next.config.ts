import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  devIndicators: false,
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
