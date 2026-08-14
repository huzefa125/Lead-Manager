import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { UserRecord, UserWithRoles } from './user.types';

/**
 * All User table access lives here. Services depend on this module rather than
 * on Prisma directly, which keeps queries in one place and makes the data layer
 * swappable in tests.
 */

/**
 * Loads roles and each role's permissions in one query.
 *
 * Used wherever a token is minted, since the token must carry the user's
 * effective permissions. Prisma resolves this as a small number of joined
 * lookups, not an N+1.
 */
export const withRoles = {
  roles: {
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name?: string | undefined;
  /** Role names to assign at creation. Resolved to ids by the caller's service. */
  roleIds?: string[] | undefined;
}

/**
 * Creates the user and its role assignments in a single transaction, so a
 * failure part-way cannot leave an account with no roles.
 */
export async function createUser(input: CreateUserInput): Promise<UserWithRoles> {
  const data: Prisma.UserCreateInput = {
    email: input.email,
    passwordHash: input.passwordHash,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.roleIds && input.roleIds.length > 0
      ? { roles: { create: input.roleIds.map((roleId) => ({ roleId })) } }
      : {}),
  };

  return prisma.user.create({ data, include: withRoles });
}

export async function findUserByEmail(email: string): Promise<UserWithRoles | null> {
  return prisma.user.findUnique({ where: { email }, include: withRoles });
}

export async function findUserById(id: string): Promise<UserWithRoles | null> {
  return prisma.user.findUnique({ where: { id }, include: withRoles });
}

/** Lighter lookup for callers that do not need permissions. */
export async function findUserRecordById(id: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({ where: { id } });
}

export async function emailExists(email: string): Promise<boolean> {
  const found = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return found !== null;
}

export interface ListUsersOptions {
  skip: number;
  take: number;
  search?: string | undefined;
  roleName?: string | undefined;
}

/** Paginated listing for the user-administration API. */
export async function listUsers(
  options: ListUsersOptions,
): Promise<{ users: UserWithRoles[]; total: number }> {
  const where: Prisma.UserWhereInput = {
    ...(options.search
      ? {
          OR: [
            { email: { contains: options.search, mode: 'insensitive' } },
            { name: { contains: options.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(options.roleName ? { roles: { some: { role: { name: options.roleName } } } } : {}),
  };

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      include: withRoles,
      orderBy: { createdAt: 'desc' },
      skip: options.skip,
      take: options.take,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total };
}
