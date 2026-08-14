import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { ApiError } from '../utils/api-error';
import { hashPassword } from '../utils/password';
import { assertSameOrganization, organizationScope, slugify } from '../utils/tenant';
import { DEFAULT_ROLE, SystemRole } from '../rbac/permission.constants';
import * as organizationRepository from '../organizations/organization.repository';
import * as userRepository from './user.repository';
import type { AuthenticatedUser, UserWithRoles } from './user.types';

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
  /**
   * Names the tenant to create for this account. Omitted, a personal
   * organization is derived from the user's name or email — the invariant is
   * that no account exists outside an organization.
   */
  organizationName?: string | undefined;
}

/** Resolves a role name to its id, tolerating an unseeded database. */
async function findRoleId(name: string): Promise<string | null> {
  const role = await prisma.role.findUnique({ where: { name }, select: { id: true } });
  return role?.id ?? null;
}

/**
 * Registration creates a tenant and its first user together.
 *
 * Self-serve signup deliberately cannot join an existing organization: doing so
 * from an unauthenticated request would let anyone insert themselves into
 * another company's tenant. Adding people to an existing organization is an
 * authenticated, permission-gated operation instead.
 *
 * The first user becomes that organization's admin — otherwise a brand new
 * tenant would have nobody able to administer it.
 */
export async function createUserWithPassword(input: RegisterUserInput): Promise<UserWithRoles> {
  const email = normalizeEmail(input.email);

  // Checked up front for a clean 409; the unique index is still the real
  // guarantee and the race is handled by the P2002 mapping in the error handler.
  if (await userRepository.emailExists(email)) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  const organizationName =
    input.organizationName?.trim() ||
    // Falls back to something recognisable rather than a bare uuid.
    `${input.name?.trim() || email.split('@')[0]}'s Organization`;

  const slug = await organizationRepository.findAvailableSlug(slugify(organizationName));

  // The founder administers their own tenant; ADMIN is scoped to it because it
  // deliberately lacks organization.manage_all.
  const roleId = (await findRoleId(SystemRole.ADMIN)) ?? (await findRoleId(DEFAULT_ROLE));

  if (!roleId) {
    logger.error(
      { role: SystemRole.ADMIN },
      'No system roles found — new accounts will have no permissions. Run `npm run db:seed`.',
    );
  }

  const { userId } = await organizationRepository.createWithOwner({
    organization: { name: organizationName, slug },
    user: { email, passwordHash, name: input.name?.trim() || undefined },
    roleIds: roleId ? [roleId] : [],
  });

  return getUserByIdOrFail(userId);
}

/**
 * Creates a user inside an existing organization. Used by the authenticated
 * user-administration API, never by self-serve registration.
 */
export async function createUserInOrganization(input: {
  email: string;
  password: string;
  name?: string | undefined;
  organizationId: string;
  roleNames?: string[] | undefined;
}): Promise<UserWithRoles> {
  const email = normalizeEmail(input.email);

  if (await userRepository.emailExists(email)) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const organization = await organizationRepository.findById(input.organizationId);
  if (!organization) throw ApiError.notFound('Organization not found');

  const names = input.roleNames?.length ? input.roleNames : [DEFAULT_ROLE];
  const roles = await prisma.role.findMany({ where: { name: { in: names } } });

  if (roles.length !== new Set(names).size) {
    const known = new Set(roles.map((role) => role.name));
    throw ApiError.validation('Unknown roles', [
      {
        field: 'roles',
        message: `These roles do not exist: ${names.filter((name) => !known.has(name)).join(', ')}`,
      },
    ]);
  }

  const passwordHash = await hashPassword(input.password);

  return userRepository.createUser({
    email,
    passwordHash,
    name: input.name?.trim() || undefined,
    organizationId: input.organizationId,
    roleIds: roles.map((role) => role.id),
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

/**
 * Tenant-aware lookup. A user in another organization reads as "not found",
 * so the endpoint cannot be used to probe for accounts elsewhere.
 */
export async function getUserInTenantOrFail(
  actor: AuthenticatedUser,
  id: string,
): Promise<UserWithRoles> {
  const user = await getUserByIdOrFail(id);
  assertSameOrganization(actor, user.organizationId, 'User');
  return user;
}

export interface ListUsersInput {
  page: number;
  limit: number;
  search?: string | undefined;
  role?: string | undefined;
}

export async function listUsers(
  actor: AuthenticatedUser,
  input: ListUsersInput,
): Promise<{
  users: UserWithRoles[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  // Confined to the actor's own organization unless they hold
  // organization.manage_all.
  const scope = organizationScope(actor);

  const { users, total } = await userRepository.listUsers({
    skip: (input.page - 1) * input.limit,
    take: input.limit,
    search: input.search,
    roleName: input.role,
    organizationId: scope.organizationId,
  });

  return {
    users,
    total,
    page: input.page,
    limit: input.limit,
    totalPages: Math.max(1, Math.ceil(total / input.limit)),
  };
}
