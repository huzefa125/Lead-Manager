import type { Permission } from '@prisma/client';
import type { RoleWithPermissions } from './rbac.repository';

export interface PublicPermission {
  id: string;
  action: string;
  resource: string;
  operation: string;
  description: string | null;
  isSystem: boolean;
}

export interface PublicRoleDetail {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicPermission(permission: Permission): PublicPermission {
  return {
    id: permission.id,
    action: permission.action,
    resource: permission.resource,
    operation: permission.operation,
    description: permission.description,
    isSystem: permission.isSystem,
  };
}

export function toPublicPermissions(permissions: Permission[]): PublicPermission[] {
  return permissions.map(toPublicPermission);
}

/**
 * Roles expose their grants as a flat list of action strings — that is the form
 * clients compare against and the form the write endpoints accept, so the API
 * round-trips without translation.
 */
export function toPublicRoleDetail(role: RoleWithPermissions): PublicRoleDetail {
  return {
    id: role.id,
    name: role.name,
    displayName: role.displayName,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map((grant) => grant.permission.action),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export function toPublicRoleDetails(roles: RoleWithPermissions[]): PublicRoleDetail[] {
  return roles.map(toPublicRoleDetail);
}

/** Groups permissions by resource — the shape an admin UI needs to render modules. */
export function groupByResource(
  permissions: Permission[],
): Record<string, PublicPermission[]> {
  const grouped: Record<string, PublicPermission[]> = {};

  for (const permission of permissions) {
    const bucket = grouped[permission.resource] ?? [];
    bucket.push(toPublicPermission(permission));
    grouped[permission.resource] = bucket;
  }

  return grouped;
}
