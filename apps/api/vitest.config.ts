import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** Integration tests run against a separate database: TEST_DATABASE_URL or `<DATABASE_URL>_test`. */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgresql://fuseai:fuseai@localhost:5432/fuseai',
  );
  url.pathname = `${url.pathname.replace(/_test$/, '')}_test`;
  return url.toString();
}

// Also set on the main process so globalSetup migrates the test database, not the dev one.
process.env.DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL },
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
