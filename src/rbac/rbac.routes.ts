import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/async-handler';
import * as controller from './rbac.controller';
import { Permissions } from './permission.constants';
import {
  assignRolesSchema,
  createPermissionSchema,
  createRoleSchema,
  idParamSchema,
  listPermissionsQuerySchema,
  listQuerySchema,
  listUsersQuerySchema,
  modifyRolePermissionsSchema,
  setRolePermissionsSchema,
  setUserRolesSchema,
  updatePermissionSchema,
  updateRoleSchema,
} from './rbac.validation';

/**
 * Every route follows the same shape:
 *
 *   authenticate  → who is this?      (verifies the JWT, no DB)
 *   authorize(..) → may they do it?   (checks token claims, no DB)
 *   validate(..)  → is the input sane?
 *   handler
 *
 * The RBAC endpoints are themselves permission-gated, so administering roles is
 * a capability that can be delegated like any other.
 */

// --- /api/roles --------------------------------------------------------------

export const roleRouter = Router();

roleRouter.use(authenticate);

roleRouter.get(
  '/',
  authorize(Permissions.ROLE_VIEW),
  validate({ query: listQuerySchema }),
  asyncHandler(controller.listRoles),
);

roleRouter.post(
  '/',
  authorize(Permissions.ROLE_CREATE),
  validate({ body: createRoleSchema }),
  asyncHandler(controller.createRole),
);

roleRouter.get(
  '/:id',
  authorize(Permissions.ROLE_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(controller.getRole),
);

roleRouter.patch(
  '/:id',
  authorize(Permissions.ROLE_UPDATE),
  validate({ params: idParamSchema, body: updateRoleSchema }),
  asyncHandler(controller.updateRole),
);

roleRouter.delete(
  '/:id',
  authorize(Permissions.ROLE_DELETE),
  validate({ params: idParamSchema }),
  asyncHandler(controller.deleteRole),
);

// Grant management. PUT replaces the set, POST adds, DELETE revokes —
// all transactional in the repository.
roleRouter.put(
  '/:id/permissions',
  authorize(Permissions.ROLE_UPDATE),
  validate({ params: idParamSchema, body: setRolePermissionsSchema }),
  asyncHandler(controller.setRolePermissions),
);

roleRouter.post(
  '/:id/permissions',
  authorize(Permissions.ROLE_UPDATE),
  validate({ params: idParamSchema, body: modifyRolePermissionsSchema }),
  asyncHandler(controller.addRolePermissions),
);

roleRouter.delete(
  '/:id/permissions',
  authorize(Permissions.ROLE_UPDATE),
  validate({ params: idParamSchema, body: modifyRolePermissionsSchema }),
  asyncHandler(controller.removeRolePermissions),
);

// --- /api/permissions --------------------------------------------------------

export const permissionRouter = Router();

permissionRouter.use(authenticate);

permissionRouter.get(
  '/',
  authorize(Permissions.PERMISSION_VIEW),
  validate({ query: listPermissionsQuerySchema }),
  asyncHandler(controller.listPermissions),
);

permissionRouter.post(
  '/',
  authorize(Permissions.PERMISSION_CREATE),
  validate({ body: createPermissionSchema }),
  asyncHandler(controller.createPermission),
);

permissionRouter.get(
  '/:id',
  authorize(Permissions.PERMISSION_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(controller.getPermission),
);

permissionRouter.patch(
  '/:id',
  authorize(Permissions.PERMISSION_UPDATE),
  validate({ params: idParamSchema, body: updatePermissionSchema }),
  asyncHandler(controller.updatePermission),
);

permissionRouter.delete(
  '/:id',
  authorize(Permissions.PERMISSION_DELETE),
  validate({ params: idParamSchema }),
  asyncHandler(controller.deletePermission),
);

// --- /api/users --------------------------------------------------------------

export const userRouter = Router();

userRouter.use(authenticate);

userRouter.get(
  '/',
  authorize(Permissions.USER_VIEW),
  validate({ query: listUsersQuerySchema }),
  asyncHandler(controller.listUsers),
);

userRouter.get(
  '/:id',
  authorize(Permissions.USER_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(controller.getUser),
);

// Assigning roles is gated on `role.assign`, separate from `role.update`: a
// team lead may need to grant existing roles without being able to redefine them.
userRouter.put(
  '/:id/roles',
  authorize(Permissions.ROLE_ASSIGN),
  validate({ params: idParamSchema, body: setUserRolesSchema }),
  asyncHandler(controller.setUserRoles),
);

userRouter.post(
  '/:id/roles',
  authorize(Permissions.ROLE_ASSIGN),
  validate({ params: idParamSchema, body: assignRolesSchema }),
  asyncHandler(controller.addUserRoles),
);

userRouter.delete(
  '/:id/roles',
  authorize(Permissions.ROLE_ASSIGN),
  validate({ params: idParamSchema, body: assignRolesSchema }),
  asyncHandler(controller.removeUserRoles),
);
