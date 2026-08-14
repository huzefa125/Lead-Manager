import { describe, expect, it } from 'vitest';
import { extractPermissions, extractRoleNames, toPublicUser } from '../../src/users/user.serializer';
import type { UserWithRoles } from '../../src/users/user.types';

/** Builds the nested shape Prisma returns for a user with roles included. */
function buildUser(
  roles: { name: string; permissions: string[] }[],
  overrides: Partial<UserWithRoles> = {},
): UserWithRoles {
  const now = new Date('2026-01-01T00:00:00Z');

  return {
    id: 'a3f1c2d4-0000-4000-8000-000000000001',
    email: 'user@example.com',
    passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
    name: 'Ada',
    isActive: true,
    organizationId: 'b4e2d3c5-0000-4000-8000-0000000000ff',
    createdAt: now,
    updatedAt: now,
    roles: roles.map((role, index) => ({
      userId: 'a3f1c2d4-0000-4000-8000-000000000001',
      roleId: `role-${index}`,
      assignedAt: now,
      assignedById: null,
      role: {
        id: `role-${index}`,
        name: role.name,
        displayName: role.name,
        description: null,
        isSystem: true,
        createdAt: now,
        updatedAt: now,
        permissions: role.permissions.map((action) => ({
          permission: {
            id: `perm-${action}`,
            action,
            resource: action.split('.')[0] ?? action,
            operation: action.split('.')[1] ?? '*',
            description: null,
            isSystem: true,
            createdAt: now,
            updatedAt: now,
          },
        })),
      },
    })),
    ...overrides,
  } as UserWithRoles;
}

describe('user serialization', () => {
  const user = buildUser([{ name: 'user', permissions: ['employee.view'] }]);

  it('never exposes the password hash', () => {
    const publicUser = toPublicUser(user);

    expect(publicUser).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(publicUser)).not.toContain('$2b$');
  });

  it('exposes exactly the intended fields', () => {
    // Pinned deliberately: a column added to the schema later must not appear
    // here without someone updating this test on purpose.
    expect(Object.keys(toPublicUser(user)).sort()).toEqual(
      [
        'createdAt',
        'email',
        'id',
        'isActive',
        'name',
        'organizationId',
        'permissions',
        'roles',
        'updatedAt',
      ].sort(),
    );
  });

  it('drops unknown fields rather than passing them through', () => {
    const withSecret = buildUser([], { totpSecret: 'SHOULD-NOT-LEAK' } as Partial<UserWithRoles>);
    expect(JSON.stringify(toPublicUser(withSecret))).not.toContain('SHOULD-NOT-LEAK');
  });

  it('reports roles without their join-table metadata', () => {
    const [role] = toPublicUser(user).roles;
    expect(role).toMatchObject({ name: 'user', isSystem: true });
    expect(role).not.toHaveProperty('assignedById');
  });
});

describe('effective permissions', () => {
  it('unions permissions across every role held', () => {
    const user = buildUser([
      { name: 'manager', permissions: ['employee.view', 'employee.create'] },
      { name: 'auditor', permissions: ['report.view'] },
    ]);

    expect(extractPermissions(user)).toEqual(['employee.create', 'employee.view', 'report.view']);
  });

  it('de-duplicates permissions granted by more than one role', () => {
    const user = buildUser([
      { name: 'manager', permissions: ['employee.view'] },
      { name: 'lead', permissions: ['employee.view'] },
    ]);

    expect(extractPermissions(user)).toEqual(['employee.view']);
  });

  it('sorts output so an unchanged user yields byte-identical tokens', () => {
    const user = buildUser([{ name: 'admin', permissions: ['user.view', 'department.view'] }]);
    expect(extractPermissions(user)).toEqual(['department.view', 'user.view']);
  });

  it('returns empty arrays for a user with no roles', () => {
    const user = buildUser([]);
    expect(extractPermissions(user)).toEqual([]);
    expect(extractRoleNames(user)).toEqual([]);
  });

  it('preserves the wildcard verbatim', () => {
    const user = buildUser([{ name: 'super_admin', permissions: ['*'] }]);
    expect(extractPermissions(user)).toEqual(['*']);
  });
});
