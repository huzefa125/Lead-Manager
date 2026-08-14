import { ApiError } from '../utils/api-error';
import { parseAction } from '../utils/permissions';
import * as rbacRepository from './rbac.repository';
import type { RoleWithPermissions } from './rbac.repository';
import { SystemRole } from './permission.constants';
import type {
  CreateRoleInput,
  ListQuery,
  ModifyRolePermissionsInput,
  SetRolePermissionsInput,
  UpdateRoleInput,
} from './rbac.validation';

/**
 * Resolves action strings to permission ids, rejecting any that do not exist.
 *
 * Failing loudly matters: silently dropping an unknown action would create a
 * role that looks correct in the request but grants less than it claims.
 */
async function resolvePermissionIds(actions: string[]): Promise<string[]> {
  if (actions.length === 0) return [];

  const unique = [...new Set(actions)];
  const found = await rbacRepository.findPermissionsByActions(unique);

  if (found.length !== unique.length) {
    const known = new Set(found.map((permission) => permission.action));
    const unknown = unique.filter((action) => !known.has(action));
    throw ApiError.validation('Unknown permissions', [
      {
        field: 'permissions',
        message: `These permissions do not exist: ${unknown.join(', ')}. Create them first via POST /api/permissions.`,
      },
    ]);
  }

  return found.map((permission) => permission.id);
}

export async function listRoles(query: ListQuery): Promise<{
  roles: RoleWithPermissions[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const { roles, total } = await rbacRepository.listRoles({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    search: query.search,
  });

  return {
    roles,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getRoleById(id: string): Promise<RoleWithPermissions> {
  const role = await rbacRepository.findRoleById(id);
  if (!role) throw ApiError.notFound('Role not found');
  return role;
}

export async function createRole(input: CreateRoleInput): Promise<RoleWithPermissions> {
  const existing = await rbacRepository.findRoleByName(input.name);
  if (existing) {
    throw ApiError.conflict(`A role named "${input.name}" already exists`);
  }

  const permissionIds = await resolvePermissionIds(input.permissions ?? []);

  return rbacRepository.createRole({
    name: input.name,
    displayName: input.displayName,
    description: input.description,
    permissionIds,
  });
}

export async function updateRole(
  id: string,
  input: UpdateRoleInput,
): Promise<RoleWithPermissions> {
  const role = await getRoleById(id);

  // System roles are referenced by name in seeds and code paths; their labels
  // may be edited but they cannot be repurposed.
  if (role.isSystem && role.name === SystemRole.SUPER_ADMIN) {
    throw ApiError.forbidden('The Super Admin role cannot be modified');
  }

  return rbacRepository.updateRole(id, input);
}

export async function deleteRole(id: string): Promise<void> {
  const role = await getRoleById(id);

  if (role.isSystem) {
    throw ApiError.forbidden(
      `"${role.name}" is a system role and cannot be deleted. Create a custom role instead.`,
    );
  }

  // Deleting would cascade the assignments away silently; make the caller
  // reassign those users deliberately.
  const assignedUsers = await rbacRepository.countUsersWithRole(id);
  if (assignedUsers > 0) {
    throw ApiError.conflict(
      `This role is assigned to ${assignedUsers} user(s). Remove those assignments before deleting it.`,
    );
  }

  await rbacRepository.deleteRole(id);
}

/** Guards grant edits on roles that must keep their permissions. */
async function assertGrantsEditable(id: string): Promise<RoleWithPermissions> {
  const role = await getRoleById(id);

  if (role.name === SystemRole.SUPER_ADMIN) {
    // Stripping `*` from Super Admin can lock every administrator out of the
    // RBAC APIs, leaving no in-app way to restore access.
    throw ApiError.forbidden(
      'Super Admin permissions cannot be modified — it must retain full access',
    );
  }

  return role;
}

export async function setRolePermissions(
  id: string,
  input: SetRolePermissionsInput,
): Promise<RoleWithPermissions> {
  await assertGrantsEditable(id);
  const permissionIds = await resolvePermissionIds(input.permissions);
  return rbacRepository.setRolePermissions(id, permissionIds);
}

export async function addRolePermissions(
  id: string,
  input: ModifyRolePermissionsInput,
): Promise<RoleWithPermissions> {
  await assertGrantsEditable(id);
  const permissionIds = await resolvePermissionIds(input.permissions);
  return rbacRepository.addRolePermissions(id, permissionIds);
}

export async function removeRolePermissions(
  id: string,
  input: ModifyRolePermissionsInput,
): Promise<RoleWithPermissions> {
  await assertGrantsEditable(id);
  const permissionIds = await resolvePermissionIds(input.permissions);
  return rbacRepository.removeRolePermissions(id, permissionIds);
}

/**
 * Splits an action into resource/operation, rejecting malformed input.
 * Exported for the permission service, which stores the parsed halves.
 */
export function parseActionOrFail(action: string): { resource: string; operation: string } {
  const parsed = parseAction(action);
  if (!parsed) {
    throw ApiError.validation('Invalid permission action', [
      { field: 'action', message: `"${action}" is not a valid "resource.operation" action` },
    ]);
  }
  return parsed;
}
