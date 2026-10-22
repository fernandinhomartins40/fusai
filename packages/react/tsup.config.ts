import { defineConfig } from 'tsup';

/** npm build only (`pnpm build:npm`); inside the monorepo the package is consumed from `src`. */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2022',
  external: ['react', 'react/jsx-runtime', '@fusai/sdk'],
});
