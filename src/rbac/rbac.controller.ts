import type { Request, Response } from 'express';
import { ApiError } from '../utils/api-error';
import { sendSuccess } from '../utils/api-response';
import { toPublicUser, toPublicUsers } from '../users/user.serializer';
import * as userService from '../users/user.service';
import * as permissionService from './permission.service';
import * as roleService from './role.service';
import * as userRoleService from './user-role.service';
import {
  groupByResource,
  toPublicPermission,
  toPublicPermissions,
  toPublicRoleDetail,
  toPublicRoleDetails,
} from './rbac.serializer';
import type {
  AssignRolesInput,
  CreatePermissionInput,
  CreateRoleInput,
  ListPermissionsQuery,
  ListQuery,
  ListUsersQuery,
  ModifyRolePermissionsInput,
  SetRolePermissionsInput,
  SetUserRolesInput,
  UpdatePermissionInput,
  UpdateRoleInput,
} from './rbac.validation';

/**
 * `validate()` stores parsed params and query on `req.validated`, because
 * Express 5 exposes `req.query`/`req.params` as getters. These readers keep the
 * casts in one place instead of scattering them through the handlers.
 */
function params<T>(req: Request): T {
  return req.validated?.params as T;
}

function query<T>(req: Request): T {
  return req.validated?.query as T;
}

/** The acting administrator, guaranteed present by `authenticate`. */
function actorId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.id;
}

// --- Roles -------------------------------------------------------------------

/** GET /api/roles */
export async function listRoles(req: Request, res: Response): Promise<void> {
  const result = await roleService.listRoles(query<ListQuery>(req));

  sendSuccess(res, {
    roles: toPublicRoleDetails(result.roles),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  });
}

/** GET /api/roles/:id */
export async function getRole(req: Request, res: Response): Promise<void> {
  const role = await roleService.getRoleById(params<{ id: string }>(req).id);
  sendSuccess(res, { role: toPublicRoleDetail(role) });
}

/** POST /api/roles */
export async function createRole(req: Request, res: Response): Promise<void> {
  const role = await roleService.createRole(req.body as CreateRoleInput);
  sendSuccess(res, { role: toPublicRoleDetail(role) }, 201);
}

/** PATCH /api/roles/:id */
export async function updateRole(req: Request, res: Response): Promise<void> {
  const role = await roleService.updateRole(
    params<{ id: string }>(req).id,
    req.body as UpdateRoleInput,
  );
  sendSuccess(res, { role: toPublicRoleDetail(role) });
}

/** DELETE /api/roles/:id */
export async function deleteRole(req: Request, res: Response): Promise<void> {
  await roleService.deleteRole(params<{ id: string }>(req).id);
  sendSuccess(res, { message: 'Role deleted' });
}

// --- Role grants -------------------------------------------------------------

/** PUT /api/roles/:id/permissions — replaces the whole grant set. */
export async function setRolePermissions(req: Request, res: Response): Promise<void> {
  const role = await roleService.setRolePermissions(
    params<{ id: string }>(req).id,
    req.body as SetRolePermissionsInput,
  );
  sendSuccess(res, { role: toPublicRoleDetail(role) });
}

/** POST /api/roles/:id/permissions — adds grants. */
export async function addRolePermissions(req: Request, res: Response): Promise<void> {
  const role = await roleService.addRolePermissions(
    params<{ id: string }>(req).id,
    req.body as ModifyRolePermissionsInput,
  );
  sendSuccess(res, { role: toPublicRoleDetail(role) });
}

/** DELETE /api/roles/:id/permissions — revokes grants. */
export async function removeRolePermissions(req: Request, res: Response): Promise<void> {
  const role = await roleService.removeRolePermissions(
    params<{ id: string }>(req).id,
    req.body as ModifyRolePermissionsInput,
  );
  sendSuccess(res, { role: toPublicRoleDetail(role) });
}

// --- Permissions -------------------------------------------------------------

/** GET /api/permissions */
export async function listPermissions(req: Request, res: Response): Promise<void> {
  const result = await permissionService.listPermissions(query<ListPermissionsQuery>(req));

  sendSuccess(res, {
    permissions: toPublicPermissions(result.permissions),
    // Grouped view saves admin UIs from re-bucketing by module client-side.
    byResource: groupByResource(result.permissions),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  });
}

/** GET /api/permissions/:id */
export async function getPermission(req: Request, res: Response): Promise<void> {
  const permission = await permissionService.getPermissionById(params<{ id: string }>(req).id);
  sendSuccess(res, { permission: toPublicPermission(permission) });
}

/** POST /api/permissions */
export async function createPermission(req: Request, res: Response): Promise<void> {
  const permission = await permissionService.createPermission(
    req.body as CreatePermissionInput,
  );
  sendSuccess(res, { permission: toPublicPermission(permission) }, 201);
}

/** PATCH /api/permissions/:id */
export async function updatePermission(req: Request, res: Response): Promise<void> {
  const permission = await permissionService.updatePermission(
    params<{ id: string }>(req).id,
    req.body as UpdatePermissionInput,
  );
  sendSuccess(res, { permission: toPublicPermission(permission) });
}

/** DELETE /api/permissions/:id */
export async function deletePermission(req: Request, res: Response): Promise<void> {
  await permissionService.deletePermission(params<{ id: string }>(req).id);
  sendSuccess(res, { message: 'Permission deleted' });
}

// --- Users and their roles ---------------------------------------------------

/** GET /api/users */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const result = await userService.listUsers(query<ListUsersQuery>(req));

  sendSuccess(res, {
    users: toPublicUsers(result.users),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  });
}

/** GET /api/users/:id */
export async function getUser(req: Request, res: Response): Promise<void> {
  const user = await userService.getUserByIdOrFail(params<{ id: string }>(req).id);
  sendSuccess(res, { user: toPublicUser(user) });
}

/** PUT /api/users/:id/roles — replaces the user's roles. */
export async function setUserRoles(req: Request, res: Response): Promise<void> {
  const user = await userRoleService.setUserRoles(
    params<{ id: string }>(req).id,
    (req.body as SetUserRolesInput).roles,
    actorId(req),
  );
  sendSuccess(res, { user: toPublicUser(user), message: 'Roles updated; user sessions revoked' });
}

/** POST /api/users/:id/roles — adds roles. */
export async function addUserRoles(req: Request, res: Response): Promise<void> {
  const user = await userRoleService.addUserRoles(
    params<{ id: string }>(req).id,
    (req.body as AssignRolesInput).roles,
    actorId(req),
  );
  sendSuccess(res, { user: toPublicUser(user), message: 'Roles assigned; user sessions revoked' });
}

/** DELETE /api/users/:id/roles — removes roles. */
export async function removeUserRoles(req: Request, res: Response): Promise<void> {
  const user = await userRoleService.removeUserRoles(
    params<{ id: string }>(req).id,
    (req.body as AssignRolesInput).roles,
    actorId(req),
  );
  sendSuccess(res, { user: toPublicUser(user), message: 'Roles removed; user sessions revoked' });
}
