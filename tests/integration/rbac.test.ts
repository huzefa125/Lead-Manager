import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { prisma } from '../../src/config/prisma';

/**
 * RBAC over the real HTTP surface and a real database.
 *
 * Requires the seed to have run:
 *   npx prisma migrate deploy && npm run db:seed
 */

const SEEDED = {
  superAdmin: { email: 'superadmin@example.com', password: 'SuperAdmin123!' },
  admin: { email: 'admin@example.com', password: 'Admin123!' },
  manager: { email: 'manager@example.com', password: 'Manager123!' },
  user: { email: 'user@example.com', password: 'User1234!' },
};

/** Marks rows this suite creates so cleanup never touches seeded data. */
const TEST_PREFIX = 'itest_';

describe('RBAC', () => {
  let app: Express;
  let acmeOrganizationId: string;
  const tokens: Record<keyof typeof SEEDED, string> = {} as Record<keyof typeof SEEDED, string>;

  const login = async (creds: { email: string; password: string }): Promise<string> => {
    const response = await request(app).post('/api/auth/login').send(creds).expect(200);
    return response.body.data.accessToken;
  };

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new Error(
        'No database reachable at DATABASE_URL. Start one first:\n' +
          '  npx prisma migrate deploy && npm run db:seed\n' +
          `Underlying error: ${String(error)}`,
      );
    }

    const seededRoles = await prisma.role.count({ where: { name: 'super_admin' } });
    if (seededRoles === 0) {
      throw new Error('Database is not seeded. Run `npm run db:seed` before this suite.');
    }

    const acme = await prisma.organization.findUnique({ where: { slug: 'acme' } });
    if (!acme) throw new Error('Seed organization "acme" is missing. Run `npm run db:seed`.');
    acmeOrganizationId = acme.id;

    app = createApp();

    for (const key of Object.keys(SEEDED) as (keyof typeof SEEDED)[]) {
      tokens[key] = await login(SEEDED[key]);
    }
  });

  /** Registration creates an organization per account; orphans must not accumulate. */
  const cleanup = async (): Promise<void> => {
    await prisma.role.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
    await prisma.permission.deleteMany({ where: { resource: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { contains: TEST_PREFIX } } });
    await prisma.organization.deleteMany({
      where: { slug: { notIn: ['platform', 'acme', 'globex', 'default'] }, users: { none: {} } },
    });
  };

  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // --- The core guarantee ----------------------------------------------------

  describe('authorize() enforcement', () => {
    it('allows a user holding the required permission', async () => {
      await request(app).get('/api/roles').set(auth(tokens.admin)).expect(200);
    });

    it('returns 403 when the user lacks the permission', async () => {
      const response = await request(app).get('/api/roles').set(auth(tokens.user)).expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
      // The message names the missing permission so an admin knows what to grant.
      expect(response.body.error.message).toContain('role.view');
    });

    it('returns 401, not 403, when unauthenticated', async () => {
      // The distinction tells a client whether to re-authenticate.
      await request(app).get('/api/roles').expect(401);
    });

    it('distinguishes operations on the same resource', async () => {
      // Manager may create employees but must not manage roles.
      await request(app).get('/api/users').set(auth(tokens.manager)).expect(200);
      await request(app)
        .post('/api/roles')
        .set(auth(tokens.manager))
        .send({ name: `${TEST_PREFIX}x`, displayName: 'X' })
        .expect(403);
    });
  });

  describe('super admin wildcard', () => {
    it('reaches every endpoint without an enumerated grant', async () => {
      await request(app).get('/api/roles').set(auth(tokens.superAdmin)).expect(200);
      await request(app).get('/api/permissions').set(auth(tokens.superAdmin)).expect(200);
      await request(app).get('/api/users').set(auth(tokens.superAdmin)).expect(200);
    });

    it('holds only the "*" permission', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set(auth(tokens.superAdmin))
        .expect(200);

      expect(response.body.data.user.permissions).toEqual(['*']);
    });

    it('covers a permission created after the role was seeded', async () => {
      // The dynamic-module guarantee: no reseed, no code change.
      const created = await request(app)
        .post('/api/permissions')
        .set(auth(tokens.superAdmin))
        .send({ action: `${TEST_PREFIX}invoice.approve`, description: 'Approve invoices' })
        .expect(201);

      expect(created.body.data.permission.resource).toBe(`${TEST_PREFIX}invoice`);
      expect(created.body.data.permission.operation).toBe('approve');

      // Super Admin's stored grant is unchanged, yet the new action is covered.
      const me = await request(app).get('/api/auth/me').set(auth(tokens.superAdmin)).expect(200);
      expect(me.body.data.user.permissions).toEqual(['*']);
    });
  });

  // --- Role management -------------------------------------------------------

  describe('roles', () => {
    const newRole = {
      name: `${TEST_PREFIX}auditor`,
      displayName: 'Auditor',
      description: 'Read-only auditor',
      permissions: ['employee.view', 'department.view'],
    };

    it('creates a role with grants', async () => {
      const response = await request(app)
        .post('/api/roles')
        .set(auth(tokens.superAdmin))
        .send(newRole)
        .expect(201);

      expect(response.body.data.role.name).toBe(newRole.name);
      expect(response.body.data.role.isSystem).toBe(false);
      expect(response.body.data.role.permissions.sort()).toEqual(
        ['department.view', 'employee.view'].sort(),
      );
    });

    it('rejects a duplicate role name', async () => {
      await request(app).post('/api/roles').set(auth(tokens.superAdmin)).send(newRole).expect(201);
      await request(app).post('/api/roles').set(auth(tokens.superAdmin)).send(newRole).expect(409);
    });

    it('rejects grants that do not exist, naming them', async () => {
      const response = await request(app)
        .post('/api/roles')
        .set(auth(tokens.superAdmin))
        .send({ ...newRole, permissions: ['employee.view', 'nope.invented'] })
        .expect(422);

      expect(response.body.error.details[0].message).toContain('nope.invented');
    });

    it('enforces lower_snake_case role names', async () => {
      await request(app)
        .post('/api/roles')
        .set(auth(tokens.superAdmin))
        .send({ ...newRole, name: 'Not Valid Name' })
        .expect(422);
    });

    it('replaces a role\'s grants transactionally', async () => {
      const created = await request(app)
        .post('/api/roles')
        .set(auth(tokens.superAdmin))
        .send(newRole)
        .expect(201);

      const response = await request(app)
        .put(`/api/roles/${created.body.data.role.id}/permissions`)
        .set(auth(tokens.superAdmin))
        .send({ permissions: ['employee.create'] })
        .expect(200);

      expect(response.body.data.role.permissions).toEqual(['employee.create']);
    });

    it('adds and removes grants incrementally', async () => {
      const created = await request(app)
        .post('/api/roles')
        .set(auth(tokens.superAdmin))
        .send({ ...newRole, permissions: [] })
        .expect(201);
      const id = created.body.data.role.id;

      const added = await request(app)
        .post(`/api/roles/${id}/permissions`)
        .set(auth(tokens.superAdmin))
        .send({ permissions: ['employee.view', 'employee.create'] })
        .expect(200);
      expect(added.body.data.role.permissions).toHaveLength(2);

      const removed = await request(app)
        .delete(`/api/roles/${id}/permissions`)
        .set(auth(tokens.superAdmin))
        .send({ permissions: ['employee.create'] })
        .expect(200);
      expect(removed.body.data.role.permissions).toEqual(['employee.view']);
    });

    it('re-granting an existing permission is a no-op, not an error', async () => {
      const created = await request(app)
        .post('/api/roles')
        .set(auth(tokens.superAdmin))
        .send(newRole)
        .expect(201);

      const response = await request(app)
        .post(`/api/roles/${created.body.data.role.id}/permissions`)
        .set(auth(tokens.superAdmin))
        .send({ permissions: ['employee.view'] })
        .expect(200);

      expect(response.body.data.role.permissions.sort()).toEqual(
        ['department.view', 'employee.view'].sort(),
      );
    });

    it('refuses to delete a system role', async () => {
      const roles = await request(app).get('/api/roles').set(auth(tokens.superAdmin)).expect(200);
      const systemRole = roles.body.data.roles.find((r: { name: string }) => r.name === 'admin');

      const response = await request(app)
        .delete(`/api/roles/${systemRole.id}`)
        .set(auth(tokens.superAdmin))
        .expect(403);

      expect(response.body.error.message).toContain('system role');
    });

    it('refuses to strip Super Admin of its permissions', async () => {
      // Doing so could lock every administrator out with no in-app recovery.
      const roles = await request(app).get('/api/roles').set(auth(tokens.superAdmin)).expect(200);
      const superAdmin = roles.body.data.roles.find(
        (r: { name: string }) => r.name === 'super_admin',
      );

      await request(app)
        .put(`/api/roles/${superAdmin.id}/permissions`)
        .set(auth(tokens.superAdmin))
        .send({ permissions: [] })
        .expect(403);
    });

    it('refuses to delete a role that is still assigned', async () => {
      const created = await request(app)
        .post('/api/roles')
        .set(auth(tokens.superAdmin))
        .send(newRole)
        .expect(201);

      const user = await prisma.user.create({
        data: {
          email: `${TEST_PREFIX}holder@example.com`,
          passwordHash: 'x',
          organizationId: acmeOrganizationId,
          roles: { create: { roleId: created.body.data.role.id } },
        },
      });
      expect(user.id).toBeTruthy();

      const response = await request(app)
        .delete(`/api/roles/${created.body.data.role.id}`)
        .set(auth(tokens.superAdmin))
        .expect(409);

      expect(response.body.error.message).toContain('assigned to 1 user');
    });

    it('returns 404 for an unknown role id', async () => {
      await request(app)
        .get('/api/roles/3f2504e0-4f89-41d3-9a0c-0305e82c3399')
        .set(auth(tokens.superAdmin))
        .expect(404);
    });

    it('returns 422 for a malformed id', async () => {
      await request(app).get('/api/roles/not-a-uuid').set(auth(tokens.superAdmin)).expect(422);
    });
  });

  // --- Permission management -------------------------------------------------

  describe('permissions', () => {
    it('lists permissions grouped by resource', async () => {
      const response = await request(app)
        .get('/api/permissions?limit=100')
        .set(auth(tokens.superAdmin))
        .expect(200);

      expect(response.body.data.permissions.length).toBeGreaterThan(0);
      expect(response.body.data.byResource).toHaveProperty('employee');
    });

    it('filters by resource', async () => {
      const response = await request(app)
        .get('/api/permissions?resource=employee')
        .set(auth(tokens.superAdmin))
        .expect(200);

      const resources: string[] = response.body.data.permissions.map(
        (p: { resource: string }) => p.resource,
      );
      expect(new Set(resources)).toEqual(new Set(['employee']));
    });

    it('creates a permission and derives resource/operation', async () => {
      const response = await request(app)
        .post('/api/permissions')
        .set(auth(tokens.superAdmin))
        .send({ action: `${TEST_PREFIX}report.export` })
        .expect(201);

      expect(response.body.data.permission).toMatchObject({
        action: `${TEST_PREFIX}report.export`,
        resource: `${TEST_PREFIX}report`,
        operation: 'export',
        isSystem: false,
      });
    });

    it('rejects a malformed action', async () => {
      await request(app)
        .post('/api/permissions')
        .set(auth(tokens.superAdmin))
        .send({ action: 'NoDotHere' })
        .expect(422);
    });

    it('rejects a duplicate action', async () => {
      await request(app)
        .post('/api/permissions')
        .set(auth(tokens.superAdmin))
        .send({ action: 'employee.view' })
        .expect(409);
    });

    it('refuses to delete a system permission', async () => {
      const list = await request(app)
        .get('/api/permissions?resource=employee')
        .set(auth(tokens.superAdmin))
        .expect(200);
      const target = list.body.data.permissions[0];

      await request(app)
        .delete(`/api/permissions/${target.id}`)
        .set(auth(tokens.superAdmin))
        .expect(403);
    });
  });

  // --- Assigning roles to users ---------------------------------------------

  describe('user role assignment', () => {
    let subjectId: string;

    beforeEach(async () => {
      // Created inside Acme so the Acme admin can act on them; cross-tenant
      // isolation is covered separately in the organizations suite.
      const subject = await prisma.user.create({
        data: {
          email: `${TEST_PREFIX}subject@example.com`,
          passwordHash: 'x',
          organizationId: acmeOrganizationId,
        },
      });
      subjectId = subject.id;
    });

    it('supports multiple roles on one user', async () => {
      const response = await request(app)
        .put(`/api/users/${subjectId}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: ['manager', 'user'] })
        .expect(200);

      const names = response.body.data.user.roles
        .map((r: { name: string }) => r.name)
        .sort();
      expect(names).toEqual(['manager', 'user']);
    });

    it('unions permissions across every assigned role', async () => {
      const response = await request(app)
        .put(`/api/users/${subjectId}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: ['manager', 'user'] })
        .expect(200);

      expect(response.body.data.user.permissions).toEqual(
        expect.arrayContaining(['employee.view', 'employee.create', 'department.view']),
      );
    });

    it('replaces roles with PUT and adds with POST', async () => {
      await request(app)
        .put(`/api/users/${subjectId}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: ['user'] })
        .expect(200);

      const added = await request(app)
        .post(`/api/users/${subjectId}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: ['manager'] })
        .expect(200);
      expect(added.body.data.user.roles).toHaveLength(2);

      const replaced = await request(app)
        .put(`/api/users/${subjectId}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: ['user'] })
        .expect(200);
      expect(replaced.body.data.user.roles).toHaveLength(1);
    });

    it('removes roles', async () => {
      await request(app)
        .put(`/api/users/${subjectId}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: ['manager', 'user'] })
        .expect(200);

      const response = await request(app)
        .delete(`/api/users/${subjectId}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: ['manager'] })
        .expect(200);

      expect(response.body.data.user.roles.map((r: { name: string }) => r.name)).toEqual(['user']);
    });

    it('revokes the target user\'s sessions so new grants take effect', async () => {
      await prisma.refreshToken.create({
        data: {
          id: '3f2504e0-4f89-41d3-9a0c-0305e82c3355',
          userId: subjectId,
          tokenHash: 'a'.repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await request(app)
        .put(`/api/users/${subjectId}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: ['manager'] })
        .expect(200);

      expect(await prisma.refreshToken.count({ where: { userId: subjectId } })).toBe(0);
    });

    it('rejects unknown role names, naming them', async () => {
      const response = await request(app)
        .put(`/api/users/${subjectId}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: ['does_not_exist'] })
        .expect(422);

      expect(response.body.error.details[0].message).toContain('does_not_exist');
    });

    it('stops an admin removing their own administrative roles', async () => {
      const self = await prisma.user.findUnique({ where: { email: SEEDED.admin.email } });

      const response = await request(app)
        .put(`/api/users/${self?.id}/roles`)
        .set(auth(tokens.admin))
        .send({ roles: ['user'] })
        .expect(403);

      expect(response.body.error.message).toContain('your own administrative roles');
    });

    it('requires role.assign — plain users cannot promote themselves', async () => {
      const self = await prisma.user.findUnique({ where: { email: SEEDED.user.email } });

      await request(app)
        .put(`/api/users/${self?.id}/roles`)
        .set(auth(tokens.user))
        .send({ roles: ['super_admin'] })
        .expect(403);
    });
  });

  // --- End-to-end: a brand new module ---------------------------------------

  describe('adding a module with no code change', () => {
    it('creates a permission, grants it, and enforces it', async () => {
      const action = `${TEST_PREFIX}invoice.approve`;

      await request(app)
        .post('/api/permissions')
        .set(auth(tokens.superAdmin))
        .send({ action, description: 'Approve invoices' })
        .expect(201);

      const role = await request(app)
        .post('/api/roles')
        .set(auth(tokens.superAdmin))
        .send({
          name: `${TEST_PREFIX}approver`,
          displayName: 'Invoice Approver',
          permissions: [action],
        })
        .expect(201);

      expect(role.body.data.role.permissions).toEqual([action]);

      // A user given the role carries the new permission in their next token.
      const account = await request(app)
        .post('/api/auth/register')
        .send({ email: `${TEST_PREFIX}approver@example.com`, password: 'CorrectHorse1' })
        .expect(201);

      const subject = await prisma.user.findUnique({
        where: { email: `${TEST_PREFIX}approver@example.com` },
      });

      await request(app)
        .post(`/api/users/${subject?.id}/roles`)
        .set(auth(tokens.superAdmin))
        .send({ roles: [`${TEST_PREFIX}approver`] })
        .expect(200);

      // Their old token predates the grant; a fresh login carries it.
      expect(account.body.data.user.permissions).not.toContain(action);

      const relogin = await request(app)
        .post('/api/auth/login')
        .send({ email: `${TEST_PREFIX}approver@example.com`, password: 'CorrectHorse1' })
        .expect(200);

      expect(relogin.body.data.user.permissions).toContain(action);
    });
  });
});
