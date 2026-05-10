import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest is installed as a devDependency only — tests run locally via
 * `npm test` (or `npm run test:watch`). There is no CI workflow attached,
 * so this has zero impact on Vercel or GitHub billing. Run manually when
 * you touch bracket / progression math.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
