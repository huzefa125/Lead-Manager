import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/async-handler';
import { Permissions } from '../rbac/permission.constants';
import * as controller from './organization.controller';
import {
  createOrganizationSchema,
  listOrganizationsQuerySchema,
  organizationIdParamSchema,
  updateOrganizationSchema,
} from './organization.validation';

export const organizationRouter = Router();

organizationRouter.use(authenticate);

/**
 * Declared before `/:id` so the literal path is not captured as a UUID param.
 * Needs no permission beyond authentication — every user may see the tenant
 * they belong to.
 */
organizationRouter.get('/current', asyncHandler(controller.getCurrentOrganization));

organizationRouter.get(
  '/',
  authorize(Permissions.ORGANIZATION_VIEW),
  validate({ query: listOrganizationsQuerySchema }),
  asyncHandler(controller.listOrganizations),
);

// Creating a tenant the caller does not belong to is a platform operation.
// Self-serve tenants come from registration instead.
organizationRouter.post(
  '/',
  authorize(Permissions.ORGANIZATION_CREATE),
  validate({ body: createOrganizationSchema }),
  asyncHandler(controller.createOrganization),
);

organizationRouter.get(
  '/:id',
  authorize(Permissions.ORGANIZATION_VIEW),
  validate({ params: organizationIdParamSchema }),
  asyncHandler(controller.getOrganization),
);

organizationRouter.patch(
  '/:id',
  authorize(Permissions.ORGANIZATION_UPDATE),
  validate({ params: organizationIdParamSchema, body: updateOrganizationSchema }),
  asyncHandler(controller.updateOrganization),
);

organizationRouter.delete(
  '/:id',
  authorize(Permissions.ORGANIZATION_DELETE),
  validate({ params: organizationIdParamSchema }),
  asyncHandler(controller.deleteOrganization),
);
