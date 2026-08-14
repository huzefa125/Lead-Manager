import { defineConfig } from 'vitest/config';

/**
 * Integration suite — drives the real Express app against a real Postgres.
 * Requires DATABASE_URL to point at a migrated database.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Suites share one database; parallel files would delete each other's rows.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
