import type { Permission, Prisma, Role } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * All roles/permissions table access.
 *
 * Every write that touches more than one row runs inside a transaction, so a
 * partially applied grant change can never be observed.
 */

/** A role with its granted permissions resolved. */
export type RoleWithPermissions = Role & {
  permissions: { permission: Permission }[];
};

const withPermissions = {
  permissions: { include: { permission: true }, orderBy: { permission: { action: 'asc' } } },
} satisfies Prisma.RoleInclude;

// --- Roles -------------------------------------------------------------------

export async function findRoleById(id: string): Promise<RoleWithPermissions | null> {
  return prisma.role.findUnique({ where: { id }, include: withPermissions });
}

export async function findRoleByName(name: string): Promise<RoleWithPermissions | null> {
  return prisma.role.findUnique({ where: { name }, include: withPermissions });
}

export async function findRolesByNames(names: string[]): Promise<Role[]> {
  return prisma.role.findMany({ where: { name: { in: names } } });
}

export async function listRoles(options: {
  skip: number;
  take: number;
  search?: string | undefined;
}): Promise<{ roles: RoleWithPermissions[]; total: number }> {
  const where: Prisma.RoleWhereInput = options.search
    ? {
        OR: [
          { name: { contains: options.search, mode: 'insensitive' } },
          { displayName: { contains: options.search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [roles, total] = await prisma.$transaction([
    prisma.role.findMany({
      where,
      include: withPermissions,
      orderBy: { name: 'asc' },
      skip: options.skip,
      take: options.take,
    }),
    prisma.role.count({ where }),
  ]);

  return { roles, total };
}

/**
 * Creates a role and its initial grants atomically. If any permission id is
 * invalid the whole create rolls back, so a half-configured role never exists.
 */
export async function createRole(input: {
  name: string;
  displayName: string;
  description?: string | undefined;
  permissionIds: string[];
}): Promise<RoleWithPermissions> {
  return prisma.role.create({
    data: {
      name: input.name,
      displayName: input.displayName,
      description: input.description ?? null,
      isSystem: false,
      permissions: {
        create: input.permissionIds.map((permissionId) => ({ permissionId })),
      },
    },
    include: withPermissions,
  });
}

export async function updateRole(
  id: string,
  data: { displayName?: string | undefined; description?: string | null | undefined },
): Promise<RoleWithPermissions> {
  return prisma.role.update({
    where: { id },
    data: {
      ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
    include: withPermissions,
  });
}

export async function deleteRole(id: string): Promise<void> {
  // user_roles and role_permissions cascade from the schema.
  await prisma.role.delete({ where: { id } });
}

export async function countUsersWithRole(roleId: string): Promise<number> {
  return prisma.userRole.count({ where: { roleId } });
}

// --- Role ↔ permission grants ------------------------------------------------

/**
 * Replaces a role's grants wholesale.
 *
 * Delete-then-insert inside one transaction: an observer either sees the old
 * set or the new one, never an empty window in which the role grants nothing.
 */
export async function setRolePermissions(
  roleId: string,
  permissionIds: string[],
): Promise<RoleWithPermissions> {
  const [, , role] = await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    }),
    prisma.role.findUniqueOrThrow({ where: { id: roleId }, include: withPermissions }),
  ]);

  return role;
}

/** Adds grants without disturbing existing ones. */
export async function addRolePermissions(
  roleId: string,
  permissionIds: string[],
): Promise<RoleWithPermissions> {
  const [, role] = await prisma.$transaction([
    prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      // Re-granting an existing permission is a no-op, not an error.
      skipDuplicates: true,
    }),
    prisma.role.findUniqueOrThrow({ where: { id: roleId }, include: withPermissions }),
  ]);

  return role;
}

export async function removeRolePermissions(
  roleId: string,
  permissionIds: string[],
): Promise<RoleWithPermissions> {
  const [, role] = await prisma.$transaction([
    prisma.rolePermission.deleteMany({
      where: { roleId, permissionId: { in: permissionIds } },
    }),
    prisma.role.findUniqueOrThrow({ where: { id: roleId }, include: withPermissions }),
  ]);

  return role;
}

// --- Permissions -------------------------------------------------------------

export async function findPermissionById(id: string): Promise<Permission | null> {
  return prisma.permission.findUnique({ where: { id } });
}

export async function findPermissionsByActions(actions: string[]): Promise<Permission[]> {
  return prisma.permission.findMany({ where: { action: { in: actions } } });
}

export async function listPermissions(options: {
  skip: number;
  take: number;
  search?: string | undefined;
  resource?: string | undefined;
}): Promise<{ permissions: Permission[]; total: number }> {
  const where: Prisma.PermissionWhereInput = {
    ...(options.resource ? { resource: options.resource } : {}),
    ...(options.search
      ? {
          OR: [
            { action: { contains: options.search, mode: 'insensitive' } },
            { description: { contains: options.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [permissions, total] = await prisma.$transaction([
    prisma.permission.findMany({
      where,
      orderBy: [{ resource: 'asc' }, { operation: 'asc' }],
      skip: options.skip,
      take: options.take,
    }),
    prisma.permission.count({ where }),
  ]);

  return { permissions, total };
}

export async function createPermission(input: {
  action: string;
  resource: string;
  operation: string;
  description?: string | undefined;
}): Promise<Permission> {
  return prisma.permission.create({
    data: {
      action: input.action,
      resource: input.resource,
      operation: input.operation,
      description: input.description ?? null,
      isSystem: false,
    },
  });
}

export async function updatePermission(
  id: string,
  data: { description: string | null },
): Promise<Permission> {
  return prisma.permission.update({ where: { id }, data });
}

export async function deletePermission(id: string): Promise<void> {
  await prisma.permission.delete({ where: { id } });
}

export async function countRolesWithPermission(permissionId: string): Promise<number> {
  return prisma.rolePermission.count({ where: { permissionId } });
}

// --- User ↔ role assignment --------------------------------------------------

/**
 * Replaces a user's roles and drops their refresh tokens in one transaction.
 *
 * Deleting the sessions is what makes the change take effect: the user's signed
 * access token still carries the old permissions until it expires, so forcing a
 * re-authentication closes that window immediately.
 */
export async function setUserRoles(
  userId: string,
  roleIds: string[],
  assignedById: string | null,
): Promise<void> {
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.createMany({
      data: roleIds.map((roleId) => ({ roleId, userId, assignedById })),
      skipDuplicates: true,
    }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);
}

export async function addUserRoles(
  userId: string,
  roleIds: string[],
  assignedById: string | null,
): Promise<void> {
  await prisma.$transaction([
    prisma.userRole.createMany({
      data: roleIds.map((roleId) => ({ roleId, userId, assignedById })),
      skipDuplicates: true,
    }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);
}

export async function removeUserRoles(userId: string, roleIds: string[]): Promise<number> {
  const [removed] = await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId, roleId: { in: roleIds } } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);

  return removed.count;
}
