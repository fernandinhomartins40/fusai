import { defineConfig } from 'tsup';

export default defineConfig({
  // The seed is bundled too, so the production image runs it with plain `node` (no tsx).
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker.ts',
    seed: '../../packages/db/prisma/seed.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript sources, so they are bundled into the output.
  noExternal: [/^@fusai\//],
  // Prisma's client is CommonJS and resolves its generated engine at runtime: it must stay in
  // node_modules (bundling it into the ESM output breaks with "Dynamic require of fs").
  external: ['@prisma/client', /^\.prisma\//],
});
