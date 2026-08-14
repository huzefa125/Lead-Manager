/**
 * Loaded before any test file. Supplies the configuration `src/config/env.ts`
 * validates at import time, so unit tests can run without a real .env.
 *
 * A DATABASE_URL already in the environment wins, which is how the integration
 * suite points at a real test database.
 */
process.env['NODE_ENV'] = 'test';
process.env['JWT_ACCESS_SECRET'] ??= 'test-access-secret-that-is-at-least-32-characters-long';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-secret-that-is-at-least-32-characters-long';
process.env['DATABASE_URL'] ??= 'postgresql://postgres:postgres@localhost:5432/auth_test?schema=public';
// Keep bcrypt at its floor: the suite hashes a lot of passwords and cost 12
// would dominate the runtime without testing anything extra.
process.env['BCRYPT_SALT_ROUNDS'] ??= '10';
process.env['ACCESS_TOKEN_TTL'] ??= '15m';
process.env['REFRESH_TOKEN_TTL_DAYS'] ??= '7';
