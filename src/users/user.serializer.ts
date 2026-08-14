import type { Role } from '@prisma/client';
import { toOrganizationSummary } from '../organizations/organization.serializer';
import type { PublicRole, PublicUser, UserRecord, UserWithRoles } from './user.types';

/**
 * The single place a User row becomes API output.
 *
 * Fields are picked explicitly rather than deleted from a spread, so a column
 * added to the schema later (a TOTP secret, a reset token) is excluded by
 * default instead of silently shipping to clients.
 */
export function toPublicUser(user: UserRecord | UserWithRoles): PublicUser {
  const roles = 'roles' in user && Array.isArray(user.roles) ? user.roles : [];

  const organization = 'organization' in user ? user.organization : undefined;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isActive: user.isActive,
    organizationId: user.organizationId,
    ...(organization ? { organization: toOrganizationSummary(organization) } : {}),
    roles: roles.map((assignment) => toPublicRole(assignment.role)),
    permissions: extractPermissions(user),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toPublicUsers(users: (UserRecord | UserWithRoles)[]): PublicUser[] {
  return users.map(toPublicUser);
}

export function toPublicRole(role: Role): PublicRole {
  return {
    id: role.id,
    name: role.name,
    displayName: role.displayName,
    description: role.description,
    isSystem: role.isSystem,
  };
}

/**
 * A user's effective permissions: the union across every role they hold,
 * de-duplicated and sorted so the value is stable between calls (which keeps
 * signed tokens byte-identical for an unchanged user).
 */
export function extractPermissions(user: UserRecord | UserWithRoles): string[] {
  if (!('roles' in user) || !Array.isArray(user.roles)) return [];

  const actions = new Set<string>();
  for (const assignment of user.roles) {
    for (const grant of assignment.role.permissions) {
      actions.add(grant.permission.action);
    }
  }

  return [...actions].sort();
}

/** Role names held by a user, sorted for stability. */
export function extractRoleNames(user: UserRecord | UserWithRoles): string[] {
  if (!('roles' in user) || !Array.isArray(user.roles)) return [];
  return user.roles.map((assignment) => assignment.role.name).sort();
}
