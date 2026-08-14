import { ApiError } from '../utils/api-error';
import * as userService from '../users/user.service';
import type { UserWithRoles } from '../users/user.types';
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
function assertNotSelfDemotion(actorId: string, targetUserId: string, resultingRoles: string[]): void {
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

export async function getUserRoles(userId: string): Promise<UserWithRoles> {
  return userService.getUserByIdOrFail(userId);
}

/** Replaces a user's roles entirely. An empty array strips them all. */
export async function setUserRoles(
  userId: string,
  roleNames: string[],
  actorId: string,
): Promise<UserWithRoles> {
  await userService.getUserByIdOrFail(userId);
  assertNotSelfDemotion(actorId, userId, roleNames);

  const roleIds = await resolveRoleIds(roleNames);
  await rbacRepository.setUserRoles(userId, roleIds, actorId);

  return userService.getUserByIdOrFail(userId);
}

/** Adds roles, leaving existing ones in place. Re-adding is a no-op. */
export async function addUserRoles(
  userId: string,
  roleNames: string[],
  actorId: string,
): Promise<UserWithRoles> {
  await userService.getUserByIdOrFail(userId);

  const roleIds = await resolveRoleIds(roleNames);
  await rbacRepository.addUserRoles(userId, roleIds, actorId);

  return userService.getUserByIdOrFail(userId);
}

/** Removes roles. Removing one the user does not hold is a no-op, not an error. */
export async function removeUserRoles(
  userId: string,
  roleNames: string[],
  actorId: string,
): Promise<UserWithRoles> {
  const user = await userService.getUserByIdOrFail(userId);

  const remaining = user.roles
    .map((assignment) => assignment.role.name)
    .filter((name) => !roleNames.includes(name));
  assertNotSelfDemotion(actorId, userId, remaining);

  const roleIds = await resolveRoleIds(roleNames);
  await rbacRepository.removeUserRoles(userId, roleIds);

  return userService.getUserByIdOrFail(userId);
}
