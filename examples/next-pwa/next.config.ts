import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // In your own app, install @fusai/sdk and @fusai/react from npm; no transpile needed there.
  transpilePackages: ['@fusai/sdk', '@fusai/react'],
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_FUSAI_BASE_URL: process.env.FUSAI_BASE_URL ?? 'http://localhost:4000/v1',
  },
};

export default nextConfig;
