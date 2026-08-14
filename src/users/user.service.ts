import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { ApiError } from '../utils/api-error';
import { hashPassword } from '../utils/password';
import { DEFAULT_ROLE } from '../rbac/permission.constants';
import * as userRepository from './user.repository';
import type { UserWithRoles } from './user.types';

/**
 * Emails are compared case-insensitively, so they are normalised on the way in
 * and the normalised form is what the unique index protects.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface RegisterUserInput {
  email: string;
  password: string;
  name?: string | undefined;
}

/**
 * Creates an account and grants it the default role.
 *
 * The role is resolved by name and never taken from the request, so a caller
 * cannot escalate at registration. If the default role is missing (an unseeded
 * database) the account is still created — with no permissions — rather than
 * registration failing outright.
 */
export async function createUserWithPassword(input: RegisterUserInput): Promise<UserWithRoles> {
  const email = normalizeEmail(input.email);

  // Checked up front for a clean 409; the unique index is still the real
  // guarantee and the race is handled by the P2002 mapping in the error handler.
  if (await userRepository.emailExists(email)) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  const defaultRole = await prisma.role.findUnique({
    where: { name: DEFAULT_ROLE },
    select: { id: true },
  });

  if (!defaultRole) {
    logger.error(
      { role: DEFAULT_ROLE },
      'Default role is missing — new accounts will have no permissions. Run `npm run db:seed`.',
    );
  }

  return userRepository.createUser({
    email,
    passwordHash,
    name: input.name?.trim() || undefined,
    roleIds: defaultRole ? [defaultRole.id] : undefined,
  });
}

export async function getUserByEmail(email: string): Promise<UserWithRoles | null> {
  return userRepository.findUserByEmail(normalizeEmail(email));
}

export async function getUserById(id: string): Promise<UserWithRoles | null> {
  return userRepository.findUserById(id);
}

/** Throws 404 instead of returning null, for callers that require a user. */
export async function getUserByIdOrFail(id: string): Promise<UserWithRoles> {
  const user = await userRepository.findUserById(id);
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

export interface ListUsersInput {
  page: number;
  limit: number;
  search?: string | undefined;
  role?: string | undefined;
}

export async function listUsers(input: ListUsersInput): Promise<{
  users: UserWithRoles[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const { users, total } = await userRepository.listUsers({
    skip: (input.page - 1) * input.limit,
    take: input.limit,
    search: input.search,
    roleName: input.role,
  });

  return {
    users,
    total,
    page: input.page,
    limit: input.limit,
    totalPages: Math.max(1, Math.ceil(total / input.limit)),
  };
}
