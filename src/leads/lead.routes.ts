import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { Permissions } from '../rbac/permission.constants';
import { asyncHandler } from '../utils/async-handler';
import * as controller from './lead.controller';
import {
  analyticsQuerySchema,
  assignLeadSchema,
  captureLeadSchema,
  changeStageSchema,
  createActivitySchema,
  createLeadSchema,
  createLeadSourceSchema,
  createLeadStageSchema,
  leadIdParamSchema,
  listActivitiesQuerySchema,
  listLeadSourcesQuerySchema,
  listLeadsQuerySchema,
  updateLeadSchema,
  updateLeadSourceSchema,
  updateLeadStageSchema,
} from './lead.validation';

export const leadRouter = Router();

leadRouter.use(authenticate);

/**
 * Declared before `/:id` so the literal paths are not captured as UUID params.
 */
leadRouter.get(
  '/funnel',
  authorize(Permissions.LEAD_VIEW),
  validate({ query: analyticsQuerySchema }),
  asyncHandler(controller.getFunnel),
);

/**
 * The integration endpoint, gated on its own permission.
 *
 * A service account forwarding website forms should be able to do exactly one
 * thing. `lead.capture` grants that and nothing else — it cannot read the
 * pipeline, cannot assign, cannot see what anyone else captured. A leaked
 * integration credential is then worth almost nothing.
 */
leadRouter.post(
  '/capture',
  authorize(Permissions.LEAD_CAPTURE, Permissions.LEAD_CREATE),
  validate({ body: captureLeadSchema }),
  asyncHandler(controller.captureLead),
);

leadRouter.get(
  '/',
  authorize(Permissions.LEAD_VIEW),
  validate({ query: listLeadsQuerySchema }),
  asyncHandler(controller.listLeads),
);

leadRouter.post(
  '/',
  authorize(Permissions.LEAD_CREATE),
  validate({ body: createLeadSchema }),
  asyncHandler(controller.createLead),
);

leadRouter.get(
  '/:id',
  authorize(Permissions.LEAD_VIEW),
  validate({ params: leadIdParamSchema }),
  asyncHandler(controller.getLead),
);

leadRouter.patch(
  '/:id',
  authorize(Permissions.LEAD_UPDATE),
  validate({ params: leadIdParamSchema, body: updateLeadSchema }),
  asyncHandler(controller.updateLead),
);

leadRouter.delete(
  '/:id',
  authorize(Permissions.LEAD_DELETE),
  validate({ params: leadIdParamSchema }),
  asyncHandler(controller.deleteLead),
);

// Deciding who owns a lead is a separate call from `lead.update`: reassigning
// work is a manager's job, editing a phone number is not.
leadRouter.put(
  '/:id/assignment',
  authorize(Permissions.LEAD_ASSIGN),
  validate({ params: leadIdParamSchema, body: assignLeadSchema }),
  asyncHandler(controller.assignLead),
);

leadRouter.put(
  '/:id/stage',
  authorize(Permissions.LEAD_UPDATE),
  validate({ params: leadIdParamSchema, body: changeStageSchema }),
  asyncHandler(controller.changeStage),
);

leadRouter.get(
  '/:id/timeline',
  authorize(Permissions.LEAD_VIEW),
  validate({ params: leadIdParamSchema, query: listActivitiesQuerySchema }),
  asyncHandler(controller.listTimeline),
);

// Logging work against a lead is an update to it — the milestone columns move
// as a direct result, which is the whole point of the endpoint.
leadRouter.post(
  '/:id/activities',
  authorize(Permissions.LEAD_UPDATE),
  validate({ params: leadIdParamSchema, body: createActivitySchema }),
  asyncHandler(controller.createActivity),
);

export const leadSourceRouter = Router();

leadSourceRouter.use(authenticate);

leadSourceRouter.get(
  '/',
  authorize(Permissions.LEAD_SOURCE_VIEW),
  validate({ query: listLeadSourcesQuerySchema }),
  asyncHandler(controller.listSources),
);

leadSourceRouter.post(
  '/',
  authorize(Permissions.LEAD_SOURCE_CREATE),
  validate({ body: createLeadSourceSchema }),
  asyncHandler(controller.createSource),
);

leadSourceRouter.get(
  '/:id',
  authorize(Permissions.LEAD_SOURCE_VIEW),
  validate({ params: leadIdParamSchema }),
  asyncHandler(controller.getSource),
);

leadSourceRouter.patch(
  '/:id',
  authorize(Permissions.LEAD_SOURCE_UPDATE),
  validate({ params: leadIdParamSchema, body: updateLeadSourceSchema }),
  asyncHandler(controller.updateSource),
);

leadSourceRouter.delete(
  '/:id',
  authorize(Permissions.LEAD_SOURCE_DELETE),
  validate({ params: leadIdParamSchema }),
  asyncHandler(controller.deleteSource),
);

export const leadStageRouter = Router();

leadStageRouter.use(authenticate);

leadStageRouter.get(
  '/',
  authorize(Permissions.LEAD_STAGE_VIEW),
  asyncHandler(controller.listStages),
);

leadStageRouter.post(
  '/',
  authorize(Permissions.LEAD_STAGE_CREATE),
  validate({ body: createLeadStageSchema }),
  asyncHandler(controller.createStage),
);

leadStageRouter.get(
  '/:id',
  authorize(Permissions.LEAD_STAGE_VIEW),
  validate({ params: leadIdParamSchema }),
  asyncHandler(controller.getStage),
);

leadStageRouter.patch(
  '/:id',
  authorize(Permissions.LEAD_STAGE_UPDATE),
  validate({ params: leadIdParamSchema, body: updateLeadStageSchema }),
  asyncHandler(controller.updateStage),
);

leadStageRouter.delete(
  '/:id',
  authorize(Permissions.LEAD_STAGE_DELETE),
  validate({ params: leadIdParamSchema }),
  asyncHandler(controller.deleteStage),
);
