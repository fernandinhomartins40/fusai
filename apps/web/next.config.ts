import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  transpilePackages: ['@fuseai/ui', '@fuseai/shared'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
