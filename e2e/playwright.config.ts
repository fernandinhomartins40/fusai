import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { PORTS, stackEnv, WEB_URL } from './support/env';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * Smoke E2E of the real web + API against an own database (E2E_DATABASE_URL, name ending in _e2e),
 * a fake Asaas and an SMTP sink. Run: `pnpm test:e2e`.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './.tmp/results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: './.tmp/report', open: 'never' }]]
    : [['list']],
  use: {
    baseURL: WEB_URL,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 90_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @fusai/api exec tsx ../../e2e/support/services.ts',
      cwd: root,
      port: PORTS.asaas,
      env: stackEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command:
        'pnpm --filter @fusai/db exec prisma migrate deploy && pnpm --filter @fusai/db exec tsx prisma/seed.ts && pnpm --filter @fusai/api exec tsx src/server.ts',
      cwd: root,
      url: `${stackEnv.API_URL}/health`,
      env: stackEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
    {
      command: `pnpm --filter @fusai/web exec next dev --port ${PORTS.web}`,
      cwd: root,
      url: WEB_URL,
      env: stackEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
