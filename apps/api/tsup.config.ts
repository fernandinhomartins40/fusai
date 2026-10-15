import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript sources, so they are bundled into the output.
  noExternal: [/^@fuseai\//],
  // Prisma's client is CommonJS and resolves its generated engine at runtime: it must stay in
  // node_modules (bundling it into the ESM output breaks with "Dynamic require of fs").
  external: ['@prisma/client', /^\.prisma\//],
});
