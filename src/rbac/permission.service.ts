import type { Permission } from '@prisma/client';
import { ApiError } from '../utils/api-error';
import * as rbacRepository from './rbac.repository';
import { parseActionOrFail } from './role.service';
import type {
  CreatePermissionInput,
  ListPermissionsQuery,
  UpdatePermissionInput,
} from './rbac.validation';

export async function listPermissions(query: ListPermissionsQuery): Promise<{
  permissions: Permission[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const { permissions, total } = await rbacRepository.listPermissions({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    search: query.search,
    resource: query.resource,
  });

  return {
    permissions,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getPermissionById(id: string): Promise<Permission> {
  const permission = await rbacRepository.findPermissionById(id);
  if (!permission) throw ApiError.notFound('Permission not found');
  return permission;
}

/**
 * Registers a new capability.
 *
 * This is the entire process for adding a module: insert `invoice.approve`,
 * grant it to a role, and `authorize('invoice.approve')` starts enforcing it.
 * No deployment and no change to the authorization logic.
 */
export async function createPermission(input: CreatePermissionInput): Promise<Permission> {
  const [existing] = await rbacRepository.findPermissionsByActions([input.action]);
  if (existing) {
    throw ApiError.conflict(`The permission "${input.action}" already exists`);
  }

  const { resource, operation } = parseActionOrFail(input.action);

  return rbacRepository.createPermission({
    action: input.action,
    resource,
    operation,
    description: input.description,
  });
}

/**
 * Only the description is mutable. Renaming an action would silently break
 * every `authorize()` call and every role that grants it — callers should
 * create the new action and delete the old one deliberately.
 */
export async function updatePermission(
  id: string,
  input: UpdatePermissionInput,
): Promise<Permission> {
  await getPermissionById(id);
  return rbacRepository.updatePermission(id, { description: input.description });
}

export async function deletePermission(id: string): Promise<void> {
  const permission = await getPermissionById(id);

  if (permission.isSystem) {
    throw ApiError.forbidden(
      `"${permission.action}" is a system permission and cannot be deleted`,
    );
  }

  // The grants would cascade away silently, quietly reducing several roles.
  const grantedToRoles = await rbacRepository.countRolesWithPermission(id);
  if (grantedToRoles > 0) {
    throw ApiError.conflict(
      `This permission is granted to ${grantedToRoles} role(s). Revoke it from them before deleting it.`,
    );
  }

  await rbacRepository.deletePermission(id);
}
