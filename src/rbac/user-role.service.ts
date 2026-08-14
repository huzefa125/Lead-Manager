import { ApiError } from '../utils/api-error';
import * as userService from '../users/user.service';
import type { AuthenticatedUser, UserWithRoles } from '../users/user.types';
import * as rbacRepository from './rbac.repository';
import { SystemRole } from './permission.constants';

/**
 * Assigning roles to users.
 *
 * Every mutation here deletes the target user's refresh tokens (inside the same
 * transaction as the assignment change — see the repository). That is what
 * makes a permission change take effect promptly: their signed access token
 * still carries the old grants until it expires, and dropping the sessions
 * forces a re-authentication rather than waiting out the TTL.
 */

/** Resolves role names to ids, rejecting any that do not exist. */
async function resolveRoleIds(names: string[]): Promise<string[]> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return [];

  const found = await rbacRepository.findRolesByNames(unique);

  if (found.length !== unique.length) {
    const known = new Set(found.map((role) => role.name));
    const unknown = unique.filter((name) => !known.has(name));
    throw ApiError.validation('Unknown roles', [
      { field: 'roles', message: `These roles do not exist: ${unknown.join(', ')}` },
    ]);
  }

  return found.map((role) => role.id);
}

/**
 * Stops an administrator removing their own last privileged role and locking
 * themselves — and possibly everyone — out of the RBAC APIs.
 */
function assertNotSelfDemotion(
  actorId: string,
  targetUserId: string,
  resultingRoles: string[],
): void {
  if (actorId !== targetUserId) return;

  const keepsPrivilege = resultingRoles.some(
    (role) => role === SystemRole.SUPER_ADMIN || role === SystemRole.ADMIN,
  );

  if (!keepsPrivilege) {
    throw ApiError.forbidden(
      'You cannot remove your own administrative roles. Ask another administrator to do it.',
    );
  }
}

/**
 * Every mutation loads the target through the tenant-aware lookup, so an
 * administrator cannot grant roles to a user in another organization — the
 * target simply reads as 404 from outside their tenant.
 */
export async function getUserRoles(
  actor: AuthenticatedUser,
  userId: string,
): Promise<UserWithRoles> {
  return userService.getUserInTenantOrFail(actor, userId);
}

/** Replaces a user's roles entirely. An empty array strips them all. */
export async function setUserRoles(
  actor: AuthenticatedUser,
  userId: string,
  roleNames: string[],
): Promise<UserWithRoles> {
  await userService.getUserInTenantOrFail(actor, userId);
  assertNotSelfDemotion(actor.id, userId, roleNames);

  const roleIds = await resolveRoleIds(roleNames);
  await rbacRepository.setUserRoles(userId, roleIds, actor.id);

  return userService.getUserByIdOrFail(userId);
}

/** Adds roles, leaving existing ones in place. Re-adding is a no-op. */
export async function addUserRoles(
  actor: AuthenticatedUser,
  userId: string,
  roleNames: string[],
): Promise<UserWithRoles> {
  await userService.getUserInTenantOrFail(actor, userId);

  const roleIds = await resolveRoleIds(roleNames);
  await rbacRepository.addUserRoles(userId, roleIds, actor.id);

  return userService.getUserByIdOrFail(userId);
}

/** Removes roles. Removing one the user does not hold is a no-op, not an error. */
export async function removeUserRoles(
  actor: AuthenticatedUser,
  userId: string,
  roleNames: string[],
): Promise<UserWithRoles> {
  const user = await userService.getUserInTenantOrFail(actor, userId);

  const remaining = user.roles
    .map((assignment) => assignment.role.name)
    .filter((name) => !roleNames.includes(name));
  assertNotSelfDemotion(actor.id, userId, remaining);

  const roleIds = await resolveRoleIds(roleNames);
  await rbacRepository.removeUserRoles(userId, roleIds);

  return userService.getUserByIdOrFail(userId);
}
