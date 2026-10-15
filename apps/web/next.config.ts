import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// The monorepo keeps a single .env at the root (see docs/DECISIONS.md D-006).
const rootEnv = path.join(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Standalone output needs symlinks, which Windows blocks without Developer Mode.
  // Production images are built on Linux (Docker), where it is always enabled.
  output: process.platform === 'win32' ? undefined : 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  transpilePackages: ['@fuseai/ui', '@fuseai/shared', '@fuseai/docs'],
  poweredByHeader: false,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.API_URL ?? 'http://localhost:4000',
    NEXT_PUBLIC_APP_URL: process.env.APP_URL ?? 'http://localhost:3000',
  },
  // Docs pages as Markdown for AIs: /docs/chat.md -> app/docs-md/[slug].
  async rewrites() {
    return [{ source: '/docs/:slug.md', destination: '/docs-md/:slug' }];
  },
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
