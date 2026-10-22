import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// The monorepo keeps a single .env at the root (see docs/DECISIONS.md D-006).
const rootEnv = path.join(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Content Security Policy (PIE S-07), enforced. Validated with Playwright on a production build
 * (public pages, sign-up, onboarding, wallet Pix QR, 2FA QR, admin): zero violations.
 * Next 15 inlines its bootstrap scripts without nonces, hence 'unsafe-inline' (nonces would make
 * every page dynamic); dev also needs 'unsafe-eval'. zod's eval probe is turned off in
 * instrumentation-client.ts.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", // Pix and 2FA QR codes are data: URLs
  "font-src 'self' data:", // Geist is self-hosted
  `connect-src 'self' ${new URL(apiUrl).origin}`,
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

const nextConfig: NextConfig = {
  // Standalone output needs symlinks, which Windows blocks without Developer Mode.
  // Production images are built on Linux (Docker), where it is always enabled.
  output: process.platform === 'win32' ? undefined : 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  transpilePackages: ['@fusai/ui', '@fusai/shared', '@fusai/docs'],
  poweredByHeader: false,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_APP_URL: process.env.APP_URL ?? 'http://localhost:3000',
  },
  // Security headers (PIE S-07). No page is meant to be framed (no iframe use anywhere), so
  // clickjacking is blocked outright.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
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
