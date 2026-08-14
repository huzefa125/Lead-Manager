import { defineConfig } from 'vitest/config';

/**
 * Unit suite — no database, no network. Safe to run anywhere, including CI
 * stages that have not provisioned Postgres.
 * Integration tests live in `vitest.integration.config.ts`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
