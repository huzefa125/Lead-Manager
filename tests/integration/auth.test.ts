import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { prisma } from '../../src/config/prisma';
import { env } from '../../src/config/env';

/**
 * Exercises the real HTTP surface against a real database.
 *
 * Requires Postgres on DATABASE_URL with migrations applied:
 *   docker compose up -d
 *   npx prisma migrate deploy
 *   npm test
 */
const CREDENTIALS = { email: 'integration@example.com', password: 'CorrectHorse1', name: 'Ada' };

/** Pulls the refresh cookie out of a Set-Cookie header. */
function refreshCookie(response: request.Response): string | undefined {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  return cookies.find((cookie) => cookie.startsWith(`${env.REFRESH_COOKIE_NAME}=`));
}

function cookieValue(cookie: string): string {
  return cookie.split(';')[0]?.split('=')[1] ?? '';
}

/**
 * Session queries are scoped to this suite's own users.
 *
 * A global `refreshToken.count()` would also pick up sessions opened by the
 * RBAC suite's seeded logins, making assertions depend on the order vitest
 * happens to run the files in.
 */
const OWN_SESSIONS = { user: { email: { contains: 'integration' } } } as const;

const sessionCount = (): Promise<number> =>
  prisma.refreshToken.count({ where: OWN_SESSIONS });

const ownSessions = () => prisma.refreshToken.findMany({ where: OWN_SESSIONS });

describe('auth API', () => {
  let app: Express;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new Error(
        'No database reachable at DATABASE_URL. Start one first:\n' +
          '  docker compose up -d\n' +
          '  npx prisma migrate deploy\n' +
          `Underlying error: ${String(error)}`,
      );
    }
    app = createApp();
  });

  beforeEach(async () => {
    // refresh_tokens and user_roles cascade from users.
    await prisma.user.deleteMany({ where: { email: { contains: 'integration' } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: 'integration' } } });
    await prisma.$disconnect();
  });

  const register = () => request(app).post('/api/auth/register').send(CREDENTIALS);
  const login = () =>
    request(app)
      .post('/api/auth/login')
      .send({ email: CREDENTIALS.email, password: CREDENTIALS.password });

  describe('POST /api/auth/register', () => {
    it('creates a user and opens a session', async () => {
      const response = await register().expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(CREDENTIALS.email);
      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(response.body.data.tokenType).toBe('Bearer');
      expect(response.body.meta.requestId).toEqual(expect.any(String));
    });

    it('never returns the password hash', async () => {
      const response = await register().expect(201);

      expect(response.body.data.user).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(response.body)).not.toContain('$2b$');
    });

    it('delivers the refresh token only as an httpOnly cookie', async () => {
      const response = await register().expect(201);
      const cookie = refreshCookie(response);

      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      // Body must not carry it — the frontend should never be able to read it.
      expect(response.body.data).not.toHaveProperty('refreshToken');
    });

    it('stores only a hash of the refresh token', async () => {
      const response = await register().expect(201);
      const presented = cookieValue(refreshCookie(response) ?? '');
      const secret = decodeURIComponent(presented).split('.')[1] ?? '';

      const rows = await ownSessions();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).not.toContain(secret);
      expect(rows[0]?.tokenHash).toHaveLength(64);
    });

    it('rejects a duplicate email with 409', async () => {
      await register().expect(201);
      const response = await register().expect(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('treats email as case-insensitive', async () => {
      await register().expect(201);
      await request(app)
        .post('/api/auth/register')
        .send({ ...CREDENTIALS, email: CREDENTIALS.email.toUpperCase() })
        .expect(409);
    });

    it('rejects a weak password with 422 and field details', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ email: 'integration2@example.com', password: 'weak' })
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
      );
    });

    it('ignores roles supplied by the caller', async () => {
      // Privilege escalation guard: roles are server-assigned, never taken
      // from the request body.
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...CREDENTIALS, role: 'ADMIN', roles: ['super_admin'] })
        .expect(201);

      const names = response.body.data.user.roles.map((role: { name: string }) => role.name);
      expect(names).toEqual(['user']);
      expect(response.body.data.user.permissions).not.toContain('*');
    });

    it('grants the default role and its permissions', async () => {
      const response = await request(app).post('/api/auth/register').send(CREDENTIALS).expect(201);

      expect(response.body.data.user.roles).toHaveLength(1);
      expect(response.body.data.user.permissions).toEqual(
        expect.arrayContaining(['employee.view', 'department.view']),
      );
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await register().expect(201);
    });

    it('returns an access token for correct credentials', async () => {
      const response = await login().expect(200);
      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(refreshCookie(response)).toBeDefined();
    });

    it('rejects a wrong password with a generic 401', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: CREDENTIALS.email, password: 'WrongPassword1' })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('gives an unknown email the identical response to a wrong password', async () => {
      // Account enumeration guard: the two cases must be indistinguishable.
      const unknown = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody-integration@example.com', password: 'CorrectHorse1' })
        .expect(401);

      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .send({ email: CREDENTIALS.email, password: 'WrongPassword1' })
        .expect(401);

      expect(unknown.body.error).toEqual(wrongPassword.body.error);
    });

    it('opens a separate session per login', async () => {
      await login().expect(200);
      await login().expect(200);
      // One from register, two from the logins.
      expect(await sessionCount()).toBe(3);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the current user for a valid token', async () => {
      const { body } = await register().expect(201);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${body.data.accessToken}`)
        .expect(200);

      expect(response.body.data.user.email).toBe(CREDENTIALS.email);
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
    });

    it.each([
      ['no header', undefined],
      ['empty bearer', 'Bearer '],
      ['wrong scheme', 'Basic abc123'],
      ['garbage token', 'Bearer not.a.jwt'],
    ])('rejects %s with 401', async (_label, header) => {
      const call = request(app).get('/api/auth/me');
      if (header) call.set('Authorization', header);
      await call.expect(401);
    });

    it('accepts a lowercase bearer scheme', async () => {
      const { body } = await register().expect(201);
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `bearer ${body.data.accessToken}`)
        .expect(200);
    });

    it('authorizes without touching the database', async () => {
      const { body } = await register().expect(201);

      // Deleting every session must not affect access-token authorization —
      // that is what "stateless" means here.
      await prisma.refreshToken.deleteMany();

      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${body.data.accessToken}`)
        .expect(200);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('issues a new access token from the cookie alone', async () => {
      const registered = await register().expect(201);
      const cookie = refreshCookie(registered) ?? '';

      const response = await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(200);

      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(response.body.data.user.email).toBe(CREDENTIALS.email);
      // No Authorization header was sent — an expired access token is exactly
      // the situation this endpoint exists for.
      expect(response.body.data).not.toHaveProperty('refreshToken');
    });

    it('returns a token that works on a protected route', async () => {
      const registered = await register().expect(201);
      const cookie = refreshCookie(registered) ?? '';

      const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(200);

      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.data.accessToken}`)
        .expect(200);
    });

    it('rotates the refresh token — a new cookie replaces the old one', async () => {
      const registered = await register().expect(201);
      const original = refreshCookie(registered) ?? '';

      const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', original).expect(200);
      const rotated = refreshCookie(refreshed) ?? '';

      expect(rotated).toBeTruthy();
      expect(cookieValue(rotated)).not.toBe(cookieValue(original));
      expect(rotated).toContain('HttpOnly');
      // Still exactly one session — rotation replaces, it does not accumulate.
      expect(await sessionCount()).toBe(1);
    });

    it('makes the previous refresh token single-use', async () => {
      const registered = await register().expect(201);
      const original = refreshCookie(registered) ?? '';

      await request(app).post('/api/auth/refresh').set('Cookie', original).expect(200);
      // Replaying the consumed token must fail.
      await request(app).post('/api/auth/refresh').set('Cookie', original).expect(401);
    });

    it('does not extend the session past the original expiry', async () => {
      const registered = await register().expect(201);
      const before = await prisma.refreshToken.findFirst({ where: OWN_SESSIONS });

      await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', refreshCookie(registered) ?? '')
        .expect(200);

      const after = await prisma.refreshToken.findFirst({ where: OWN_SESSIONS });
      // Refreshing in a loop must not keep a session alive forever.
      expect(after?.expiresAt.getTime()).toBe(before?.expiresAt.getTime());
      expect(after?.id).not.toBe(before?.id);
    });

    it('rejects a request with no refresh token', async () => {
      await request(app).post('/api/auth/refresh').expect(401);
    });

    it('rejects a forged token whose id does not exist', async () => {
      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: '3f2504e0-4f89-41d3-9a0c-0305e82c3301.forgedsecret' })
        .expect(401);
    });

    it('rejects a real token id paired with a wrong secret', async () => {
      const registered = await register().expect(201);
      const id = decodeURIComponent(cookieValue(refreshCookie(registered) ?? '')).split('.')[0];

      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: `${id}.wrong-secret-entirely` })
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('deletes the refresh token row and clears the cookie', async () => {
      const registered = await register().expect(201);
      const cookie = refreshCookie(registered) ?? '';

      expect(await sessionCount()).toBe(1);

      const response = await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);

      expect(await sessionCount()).toBe(0);
      expect(refreshCookie(response)).toContain(`${env.REFRESH_COOKIE_NAME}=;`);
    });

    it('makes the old refresh token unusable', async () => {
      const registered = await register().expect(201);
      const cookie = refreshCookie(registered) ?? '';

      await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
      // This is the guarantee that storing refresh tokens buys.
      await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('is idempotent', async () => {
      const registered = await register().expect(201);
      const cookie = refreshCookie(registered) ?? '';

      await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
      await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
      await request(app).post('/api/auth/logout').expect(200);
    });

    it('leaves other sessions alone', async () => {
      await register().expect(201);
      const second = await login().expect(200);

      await request(app)
        .post('/api/auth/logout')
        .set('Cookie', refreshCookie(second) ?? '')
        .expect(200);

      expect(await sessionCount()).toBe(1);
    });
  });

  describe('POST /api/auth/logout-all', () => {
    it('deletes every session for the user', async () => {
      const registered = await register().expect(201);
      await login().expect(200);
      await login().expect(200);
      expect(await sessionCount()).toBe(3);

      const response = await request(app)
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${registered.body.data.accessToken}`)
        .expect(200);

      expect(response.body.data.revokedCount).toBe(3);
      expect(await sessionCount()).toBe(0);
    });

    it('requires authentication', async () => {
      await request(app).post('/api/auth/logout-all').expect(401);
    });
  });

  describe('error handling', () => {
    it('returns a consistent envelope for 404s', async () => {
      const response = await request(app).get('/api/does-not-exist').expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.meta.requestId).toEqual(expect.any(String));
    });

    it('rejects malformed JSON with 400, not 500', async () => {
      await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ')
        .expect(400);
    });

    it('echoes the request id back', async () => {
      const response = await request(app).get('/health').set('X-Request-Id', 'my-trace-id').expect(200);
      expect(response.headers['x-request-id']).toBe('my-trace-id');
      expect(response.body.meta.requestId).toBe('my-trace-id');
    });

    it('does not advertise the framework', async () => {
      const response = await request(app).get('/health').expect(200);
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('API documentation', () => {
    it('serves a valid OpenAPI document', async () => {
      const response = await request(app).get('/api/docs.json').expect(200);

      expect(response.body.openapi).toBe('3.0.3');
      expect(response.body.info.title).toBe('Auth Service API');
      expect(Object.keys(response.body.paths)).toEqual(
        expect.arrayContaining([
          '/auth/register',
          '/auth/login',
          '/auth/refresh',
          '/auth/me',
          '/auth/logout',
          '/auth/logout-all',
        ]),
      );
    });

    it('documents both security schemes', async () => {
      const response = await request(app).get('/api/docs.json').expect(200);
      const schemes = response.body.components.securitySchemes;

      expect(schemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
      expect(schemes.refreshCookie).toMatchObject({ type: 'apiKey', in: 'cookie' });
    });

    it('never shows a refreshToken in a documented response body', async () => {
      const response = await request(app).get('/api/docs.json').expect(200);
      // The spec must not teach clients to read a token that is cookie-only.
      expect(response.body.components.schemas.AuthSession.properties).not.toHaveProperty(
        'refreshToken',
      );
    });

    it('serves the Swagger UI page', async () => {
      const response = await request(app).get('/api/docs/').expect(200);
      expect(response.text).toContain('swagger-ui');
    });
  });
});
