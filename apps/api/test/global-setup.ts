import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Applies migrations to the test database once per run (creates it if missing). */
export default function setup() {
  const dbDir = fileURLToPath(new URL('../../../packages/db', import.meta.url));
  execSync('pnpm exec prisma migrate deploy', {
    cwd: dbDir,
    env: process.env,
    stdio: 'pipe',
  });
}
