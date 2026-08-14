#!/usr/bin/env node
/**
 * Prepares the integration-test database: applies migrations, then seeds.
 *
 * Integration tests delete rows, so they must never run against the development
 * database. This points Prisma at TEST_DATABASE_URL (defaulting to the same
 * server with an `auth_test` database) for the duration of the two commands.
 *
 * Cross-platform on purpose — inline `VAR=value cmd` does not work in PowerShell.
 */
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';

config();

const DEFAULT_TEST_URL = 'postgresql://postgres:postgres@localhost:5432/auth_test?schema=public';

const url =
  process.env.TEST_DATABASE_URL ??
  // Reuse the dev connection's credentials/host, swapping the database name.
  (process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/\/([^/?]+)(\?|$)/, '/auth_test$2')
    : DEFAULT_TEST_URL);

if (!/auth_test/.test(url)) {
  console.error(
    `Refusing to run: the resolved test database URL does not look like a test database.\n  ${url}\n` +
      'Set TEST_DATABASE_URL explicitly.',
  );
  process.exit(1);
}

console.log(`Preparing test database: ${url.replace(/:[^:@/]+@/, ':****@')}\n`);

const env = { ...process.env, DATABASE_URL: url };
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

for (const args of [
  ['prisma', 'migrate', 'deploy'],
  ['tsx', 'prisma/seed.ts'],
]) {
  const result = spawnSync(npx, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });

  if (result.status !== 0) {
    console.error(`\n"${args.join(' ')}" failed. Is the database created?`);
    console.error('  createdb auth_test    (or: CREATE DATABASE auth_test;)');
    process.exit(result.status ?? 1);
  }
}

console.log('\nTest database ready. Run: npm run test:integration');
