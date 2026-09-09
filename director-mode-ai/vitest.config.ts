import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest runs locally via `npm test` (or `npm run test:watch`) and in CI on
 * every push and pull request — see .github/workflows/test.yml.
 */

/*
 * Pin the clock's timezone.
 *
 * OnDeck's wait board does its arithmetic with setHours/getHours, which
 * resolve against whatever timezone the process is in. That is correct where
 * it actually runs: computeWaitBoard is only ever called from the announcer's
 * 'use client' screen, in a browser at the venue, so the machine clock IS the
 * tournament clock. The code is right; it just cannot be tested anywhere but
 * the venue's timezone without saying which one that is.
 *
 * Unpinned, those tests passed on a Pacific laptop and failed everywhere else
 * — CI, a container, a contributor abroad. A test whose result depends on the
 * machine it runs on is not a test.
 *
 * Pacific because that is what the fixtures assume (a -07:00 `now`, and the
 * courtsheet suite's explicit America/Los_Angeles). Set here rather than in
 * the npm script so it holds however the suite is invoked.
 */
process.env.TZ = 'America/Los_Angeles';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    env: { TZ: 'America/Los_Angeles' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
