import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { prisma } from '../../src/config/prisma';

/**
 * Organizations and tenant isolation.
 *
 * The seed creates three tenants — `platform` (Super Admin), `acme` and
 * `globex` — precisely so a broken tenant filter shows up here. With everyone
 * in a single organization these tests would pass regardless.
 */

const SEEDED = {
  superAdmin: { email: 'superadmin@example.com', password: 'SuperAdmin123!' }, // platform
  acmeAdmin: { email: 'admin@example.com', password: 'Admin123!' }, // acme
  acmeUser: { email: 'user@example.com', password: 'User1234!' }, // acme
  globexAdmin: { email: 'globex.admin@example.com', password: 'Globex123!' }, // globex
};

const TEST_PREFIX = 'otest_';

/** Organizations created by the seed, which cleanup must never remove. */
const SEED_SLUGS = ['platform', 'acme', 'globex', 'default'];

/**
 * Each registration creates an organization, so removing only the users would
 * leave orphans behind — and slugs are unique, so the next run would collide.
 */
async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { contains: TEST_PREFIX } } });
  await prisma.organization.deleteMany({
    where: { slug: { notIn: SEED_SLUGS }, users: { none: {} } },
  });
}

describe('organizations', () => {
  let app: Express;
  const tokens = {} as Record<keyof typeof SEEDED, string>;
  const orgIds = {} as Record<'platform' | 'acme' | 'globex', string>;

  const login = async (creds: { email: string; password: string }): Promise<string> => {
    const response = await request(app).post('/api/auth/login').send(creds).expect(200);
    return response.body.data.accessToken;
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new Error(
        'No database reachable at DATABASE_URL. Run `npm run test:db:setup` first.\n' +
          `Underlying error: ${String(error)}`,
      );
    }

    for (const slug of ['platform', 'acme', 'globex'] as const) {
      const organization = await prisma.organization.findUnique({ where: { slug } });
      if (!organization) {
        throw new Error(`Seed organization "${slug}" is missing. Run \`npm run db:seed\`.`);
      }
      orgIds[slug] = organization.id;
    }

    app = createApp();

    for (const key of Object.keys(SEEDED) as (keyof typeof SEEDED)[]) {
      tokens[key] = await login(SEEDED[key]);
    }
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  // --- The invariant ---------------------------------------------------------

  describe('every user belongs to an organization', () => {
    it('has no user without one', async () => {
      // Raw SQL on purpose: Prisma cannot express `organization_id IS NULL` for
      // a non-nullable field, and a `{ organizationId: undefined }` filter is
      // silently dropped — it would count every row and pass for the wrong reason.
      const rows = await prisma.$queryRaw<{ orphans: number }[]>`
        SELECT COUNT(*)::int AS orphans FROM users WHERE organization_id IS NULL
      `;
      expect(Number(rows[0]?.orphans)).toBe(0);
    });

    it('enforces the invariant in the schema, not just in code', async () => {
      const rows = await prisma.$queryRaw<{ is_nullable: string }[]>`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'organization_id'
      `;
      expect(rows[0]?.is_nullable).toBe('NO');
    });

    it('creates an organization at registration', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: `${TEST_PREFIX}founder@example.com`,
          password: 'CorrectHorse1',
          name: 'Founder',
          organizationName: 'Test Ventures',
        })
        .expect(201);

      expect(response.body.data.user.organizationId).toEqual(expect.any(String));
      expect(response.body.data.user.organization).toMatchObject({
        name: 'Test Ventures',
        slug: 'test-ventures',
      });
    });

    it('derives a personal organization when none is named', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ email: `${TEST_PREFIX}solo@example.com`, password: 'CorrectHorse1' })
        .expect(201);

      // No account may exist outside an organization, so one is always made.
      expect(response.body.data.user.organizationId).toEqual(expect.any(String));
      expect(response.body.data.user.organization.name).toContain('Organization');
    });

    it('makes the founder an admin of their own tenant', async () => {
      // A brand new tenant with nobody able to administer it would be useless.
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: `${TEST_PREFIX}boss@example.com`,
          password: 'CorrectHorse1',
          organizationName: 'Boss Co',
        })
        .expect(201);

      expect(response.body.data.user.roles.map((r: { name: string }) => r.name)).toEqual(['admin']);
      // But NOT a platform administrator.
      expect(response.body.data.user.permissions).not.toContain('organization.manage_all');
      expect(response.body.data.user.permissions).not.toContain('*');
    });

    it('gives colliding organization names distinct slugs', async () => {
      const create = (email: string) =>
        request(app)
          .post('/api/auth/register')
          .send({ email, password: 'CorrectHorse1', organizationName: 'Duplicate Name' })
          .expect(201);

      const first = await create(`${TEST_PREFIX}dup1@example.com`);
      const second = await create(`${TEST_PREFIX}dup2@example.com`);

      expect(first.body.data.user.organization.slug).toBe('duplicate-name');
      expect(second.body.data.user.organization.slug).toBe('duplicate-name-2');
    });

    it('rolls back the organization if the user cannot be created', async () => {
      const before = await prisma.organization.count();

      // Duplicate email — the user insert fails inside the transaction.
      await request(app)
        .post('/api/auth/register')
        .send({
          email: SEEDED.acmeUser.email,
          password: 'CorrectHorse1',
          organizationName: 'Should Not Persist',
        })
        .expect(409);

      expect(await prisma.organization.count()).toBe(before);
      expect(await prisma.organization.findUnique({ where: { slug: 'should-not-persist' } })).toBeNull();
    });

    it('cannot join an existing organization from registration', async () => {
      // Unauthenticated self-insertion into another company's tenant would be
      // a serious hole; the field is stripped by the schema.
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: `${TEST_PREFIX}intruder@example.com`,
          password: 'CorrectHorse1',
          organizationId: orgIds.acme,
          organizationSlug: 'acme',
        })
        .expect(201);

      expect(response.body.data.user.organizationId).not.toBe(orgIds.acme);
    });
  });

  // --- Tenant isolation ------------------------------------------------------

  describe('tenant isolation', () => {
    it('confines a user listing to the caller\'s organization', async () => {
      const response = await request(app)
        .get('/api/users?limit=100')
        .set(auth(tokens.acmeAdmin))
        .expect(200);

      const orgs: string[] = response.body.data.users.map(
        (u: { organizationId: string }) => u.organizationId,
      );
      expect(new Set(orgs)).toEqual(new Set([orgIds.acme]));
      expect(response.body.data.users.length).toBeGreaterThan(1);
    });

    it('does not leak users between two tenants', async () => {
      const acme = await request(app)
        .get('/api/users?limit=100')
        .set(auth(tokens.acmeAdmin))
        .expect(200);
      const globex = await request(app)
        .get('/api/users?limit=100')
        .set(auth(tokens.globexAdmin))
        .expect(200);

      const emails = (body: { data: { users: { email: string }[] } }) =>
        body.data.users.map((u) => u.email);

      expect(emails(acme.body)).toContain(SEEDED.acmeUser.email);
      expect(emails(globex.body)).not.toContain(SEEDED.acmeUser.email);
      expect(emails(globex.body)).toContain(SEEDED.globexAdmin.email);
    });

    it('returns 404 — not 403 — for a user in another tenant', async () => {
      // Confirming the record exists would itself be a disclosure.
      const acmeUser = await prisma.user.findUnique({ where: { email: SEEDED.acmeUser.email } });

      const response = await request(app)
        .get(`/api/users/${acmeUser?.id}`)
        .set(auth(tokens.globexAdmin))
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('refuses to assign roles to a user in another tenant', async () => {
      const acmeUser = await prisma.user.findUnique({ where: { email: SEEDED.acmeUser.email } });

      await request(app)
        .put(`/api/users/${acmeUser?.id}/roles`)
        .set(auth(tokens.globexAdmin))
        .send({ roles: ['admin'] })
        .expect(404);

      // And the target's roles are untouched.
      const after = await request(app)
        .get(`/api/users/${acmeUser?.id}`)
        .set(auth(tokens.acmeAdmin))
        .expect(200);
      expect(after.body.data.user.roles.map((r: { name: string }) => r.name)).toEqual(['user']);
    });

    it('shows a tenant admin only their own organization', async () => {
      const response = await request(app)
        .get('/api/organizations')
        .set(auth(tokens.acmeAdmin))
        .expect(200);

      expect(response.body.data.organizations).toHaveLength(1);
      expect(response.body.data.organizations[0].slug).toBe('acme');
    });

    it('returns 404 for another tenant fetched by id', async () => {
      await request(app)
        .get(`/api/organizations/${orgIds.globex}`)
        .set(auth(tokens.acmeAdmin))
        .expect(404);
    });

    it('refuses to rename another tenant', async () => {
      await request(app)
        .patch(`/api/organizations/${orgIds.globex}`)
        .set(auth(tokens.acmeAdmin))
        .send({ name: 'Hijacked' })
        .expect(404);

      const globex = await prisma.organization.findUnique({ where: { id: orgIds.globex } });
      expect(globex?.name).toBe('Globex Industries');
    });
  });

  // --- Cross-tenant administration ------------------------------------------

  describe('organization.manage_all', () => {
    it('lets Super Admin see every organization', async () => {
      const response = await request(app)
        .get('/api/organizations?limit=100')
        .set(auth(tokens.superAdmin))
        .expect(200);

      const slugs: string[] = response.body.data.organizations.map(
        (o: { slug: string }) => o.slug,
      );
      expect(slugs).toEqual(expect.arrayContaining(['platform', 'acme', 'globex']));
    });

    it('lets Super Admin see users across tenants', async () => {
      const response = await request(app)
        .get('/api/users?limit=100')
        .set(auth(tokens.superAdmin))
        .expect(200);

      const orgs = new Set(
        response.body.data.users.map((u: { organizationId: string }) => u.organizationId),
      );
      expect(orgs.size).toBeGreaterThan(1);
    });

    it('is the permission that lifts confinement, not the role name', async () => {
      // Acme's admin is a full administrator of its tenant, yet still confined.
      const me = await request(app).get('/api/auth/me').set(auth(tokens.acmeAdmin)).expect(200);

      expect(me.body.data.user.permissions).not.toContain('organization.manage_all');
      expect(me.body.data.user.roles.map((r: { name: string }) => r.name)).toEqual(['admin']);
    });
  });

  // --- CRUD ------------------------------------------------------------------

  describe('organization management', () => {
    it('creates an organization with a derived slug', async () => {
      const response = await request(app)
        .post('/api/organizations')
        .set(auth(tokens.superAdmin))
        .send({ name: `${TEST_PREFIX} Contoso Ltd`, description: 'A new tenant' })
        .expect(201);

      expect(response.body.data.organization.slug).toMatch(/^otest_?-?contoso-ltd$/);
    });

    it('rejects a slug that is already taken', async () => {
      await request(app)
        .post('/api/organizations')
        .set(auth(tokens.superAdmin))
        .send({ name: 'Anything', slug: 'acme' })
        .expect(409);
    });

    it('refuses creation to a tenant admin', async () => {
      // Making tenants is a platform operation.
      await request(app)
        .post('/api/organizations')
        .set(auth(tokens.acmeAdmin))
        .send({ name: 'Sneaky Org' })
        .expect(403);
    });

    it('lets any user read their own organization', async () => {
      const response = await request(app)
        .get('/api/organizations/current')
        .set(auth(tokens.acmeUser))
        .expect(200);

      expect(response.body.data.organization.slug).toBe('acme');
    });

    it('lets a tenant admin rename their own organization', async () => {
      const created = await prisma.organization.create({
        data: { name: 'Renamable', slug: `${TEST_PREFIX}renamable` },
      });
      const user = await request(app)
        .post('/api/auth/register')
        .send({
          email: `${TEST_PREFIX}renamer@example.com`,
          password: 'CorrectHorse1',
          organizationName: 'Renamer Co',
        })
        .expect(201);

      const response = await request(app)
        .patch(`/api/organizations/${user.body.data.user.organizationId}`)
        .set(auth(user.body.data.accessToken))
        .send({ name: 'Renamed Co' })
        .expect(200);

      expect(response.body.data.organization.name).toBe('Renamed Co');
      expect(created.id).toBeTruthy();
    });

    it('refuses deactivation to a tenant admin', async () => {
      // Deactivating locks every user out, including the caller.
      await request(app)
        .patch(`/api/organizations/${orgIds.acme}`)
        .set(auth(tokens.acmeAdmin))
        .send({ isActive: false })
        .expect(403);
    });

    it('refuses to delete an organization that still has users', async () => {
      const response = await request(app)
        .delete(`/api/organizations/${orgIds.globex}`)
        .set(auth(tokens.superAdmin))
        .expect(409);

      expect(response.body.error.message).toContain('user(s)');
    });

    it('deletes an empty organization', async () => {
      const empty = await prisma.organization.create({
        data: { name: 'Empty', slug: `${TEST_PREFIX}empty` },
      });

      await request(app)
        .delete(`/api/organizations/${empty.id}`)
        .set(auth(tokens.superAdmin))
        .expect(200);

      expect(await prisma.organization.findUnique({ where: { id: empty.id } })).toBeNull();
    });

    it('refuses to delete the organization the caller belongs to', async () => {
      // Even for a platform administrator — it would delete their own account.
      await request(app)
        .delete(`/api/organizations/${orgIds.platform}`)
        .set(auth(tokens.superAdmin))
        .expect(409); // still has users
    });

    it('requires authentication', async () => {
      await request(app).get('/api/organizations').expect(401);
      await request(app).get('/api/organizations/current').expect(401);
    });
  });

  // --- Suspension ------------------------------------------------------------

  describe('deactivating a tenant', () => {
    it('blocks sign-in for every user in it', async () => {
      const founder = await request(app)
        .post('/api/auth/register')
        .send({
          email: `${TEST_PREFIX}suspended@example.com`,
          password: 'CorrectHorse1',
          organizationName: 'Suspended Co',
        })
        .expect(201);

      await request(app)
        .patch(`/api/organizations/${founder.body.data.user.organizationId}`)
        .set(auth(tokens.superAdmin))
        .send({ isActive: false })
        .expect(200);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: `${TEST_PREFIX}suspended@example.com`, password: 'CorrectHorse1' })
        .expect(403);

      expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
      expect(response.body.error.message).toContain('organization');
    });
  });
});
