import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // In your own app, install @fuseai/sdk and @fuseai/react from npm; no transpile needed there.
  transpilePackages: ['@fuseai/sdk', '@fuseai/react'],
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_FUSE_BASE_URL: process.env.FUSE_BASE_URL ?? 'http://localhost:4000/v1',
  },
};

export default nextConfig;
