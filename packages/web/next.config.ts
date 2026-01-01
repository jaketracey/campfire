import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  cacheComponents: true,
  typedRoutes: true,
  transpilePackages: ['@campfire/shared'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.campfire.app',
      },
    ],
  },
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
};

export default nextConfig;
