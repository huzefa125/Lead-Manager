import { z } from 'zod';
import { WILDCARD } from './permission.constants';

/**
 * Role keys are machine identifiers referenced by seeds and code, so they are
 * constrained to lower_snake_case rather than free text.
 */
const roleNameSchema = z
  .string()
  .trim()
  .min(2, 'Role name must be at least 2 characters')
  .max(50, 'Role name must not exceed 50 characters')
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Role name must be lower_snake_case, starting with a letter (e.g. "finance_manager")',
  );

/**
 * A permission action is `resource.operation`, or a wildcard.
 *
 * Accepted: `employee.create`, `employee.*`, `*`.
 * The pattern is intentionally open about the resource and operation names —
 * constraining them to a fixed list would defeat the point of a dynamic system.
 */
const actionSchema = z
  .string()
  .trim()
  .min(1, 'Permission action is required')
  .max(100, 'Permission action must not exceed 100 characters')
  .refine(
    (value) => value === WILDCARD || /^[a-z][a-z0-9_]*\.([a-z][a-z0-9_]*|\*)$/.test(value),
    'Action must be "resource.operation", "resource.*", or "*" — lower_snake_case (e.g. "employee.create")',
  );

const uuidSchema = z.string().uuid('Must be a valid UUID');

// --- Params ------------------------------------------------------------------

export const idParamSchema = z.object({ id: uuidSchema });

export const userRoleParamSchema = z.object({
  id: uuidSchema,
  roleId: uuidSchema,
});

// --- Roles -------------------------------------------------------------------

export const createRoleSchema = z.object({
  name: roleNameSchema,
  displayName: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  /** Optional initial grants, by action string. */
  permissions: z.array(actionSchema).max(200).optional(),
});

export const updateRoleSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  // `name` is deliberately absent: code and seeds reference roles by name, so
  // renaming one would silently break authorization that depends on it.
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field to update',
  );

/** Full replacement of a role's grants. Empty array is valid — it revokes all. */
export const setRolePermissionsSchema = z.object({
  permissions: z.array(actionSchema).max(200),
});

/** Incremental add/remove. Requires at least one entry to be meaningful. */
export const modifyRolePermissionsSchema = z.object({
  permissions: z.array(actionSchema).min(1, 'Provide at least one permission').max(200),
});

// --- Permissions -------------------------------------------------------------

export const createPermissionSchema = z.object({
  action: actionSchema,
  description: z.string().trim().max(500).optional(),
});

export const updatePermissionSchema = z.object({
  description: z.string().trim().max(500).nullable(),
});

// --- User ↔ role assignment --------------------------------------------------

/** Roles are addressed by name here — far more readable than a UUID in a body. */
export const assignRolesSchema = z.object({
  roles: z.array(roleNameSchema).min(1, 'Provide at least one role').max(50),
});

export const setUserRolesSchema = z.object({
  roles: z.array(roleNameSchema).max(50),
});

// --- Listing -----------------------------------------------------------------

export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
});

export const listPermissionsQuerySchema = listQuerySchema.extend({
  /** Filter to one module, e.g. `?resource=employee`. */
  resource: z.string().trim().min(1).max(50).optional(),
});

export const listUsersQuerySchema = listQuerySchema.extend({
  /** Filter to holders of a role, e.g. `?role=admin`. */
  role: roleNameSchema.optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;
export type ModifyRolePermissionsInput = z.infer<typeof modifyRolePermissionsSchema>;
export type CreatePermissionInput = z.infer<typeof createPermissionSchema>;
export type UpdatePermissionInput = z.infer<typeof updatePermissionSchema>;
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;
export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type ListPermissionsQuery = z.infer<typeof listPermissionsQuerySchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
