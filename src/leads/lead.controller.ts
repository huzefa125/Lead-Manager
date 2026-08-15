import type { Request, Response } from 'express';
import { ApiError } from '../utils/api-error';
import { sendSuccess } from '../utils/api-response';
import type { AuthenticatedUser } from '../users/user.types';
import * as activityService from './activity.service';
import * as catalogService from './catalog.service';
import * as followUpService from './follow-up.service';
import * as funnelService from './funnel.service';
import * as leakageService from './leakage.service';
import * as responseTimeService from './response-time.service';
import { SYSTEM_ACTIVITY_TYPES } from './lead.constants';
import * as leadService from './lead.service';
import {
  toPublicActivities,
  toPublicActivity,
  toPublicLead,
  toPublicLeadSource,
  toPublicLeadStage,
  toPublicLeads,
} from './lead.serializer';
import type {
  AnalyticsQuery,
  AssignLeadInput,
  CaptureLeadInput,
  ChangeStageInput,
  CreateActivityInput,
  CreateLeadInput,
  CreateLeadSourceInput,
  CreateLeadStageInput,
  FollowUpQuery,
  LeakageQuery,
  ListActivitiesQuery,
  ListLeadSourcesQuery,
  ListLeadsQuery,
  ResponseTimeQuery,
  UpdateLeadInput,
  UpdateLeadSourceInput,
  UpdateLeadStageInput,
} from './lead.validation';

/** Controllers hold no business logic — they translate HTTP to service calls. */

function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

function params<T>(req: Request): T {
  return req.validated?.params as T;
}

function query<T>(req: Request): T {
  return req.validated?.query as T;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/** GET /api/leads */
export async function listLeads(req: Request, res: Response): Promise<void> {
  const result = await leadService.listLeads(currentUser(req), query<ListLeadsQuery>(req));

  sendSuccess(res, {
    leads: toPublicLeads(result.leads),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  });
}

/** GET /api/leads/:id */
export async function getLead(req: Request, res: Response): Promise<void> {
  const lead = await leadService.getLeadById(currentUser(req), params<{ id: string }>(req).id);
  sendSuccess(res, { lead: toPublicLead(lead) });
}

/**
 * POST /api/leads
 *
 * Returns 200 rather than 201 when an `externalId` matched an existing lead —
 * the caller's retry succeeded, but nothing was created, and saying 201 would
 * make an import report twice as many new leads as it added.
 */
export async function createLead(req: Request, res: Response): Promise<void> {
  const result = await leadService.createLead(currentUser(req), req.body as CreateLeadInput);
  sendSuccess(res, { lead: toPublicLead(result.lead), created: result.created }, result.created ? 201 : 200);
}

/**
 * POST /api/leads/capture
 *
 * The integration endpoint. `outcome` tells the caller which of the three
 * things happened, so a webhook's own logs can distinguish a genuine new lead
 * from a redelivery or a repeat enquiry.
 */
export async function captureLead(req: Request, res: Response): Promise<void> {
  const result = await leadService.captureLead(currentUser(req), req.body as CaptureLeadInput);
  sendSuccess(
    res,
    { lead: toPublicLead(result.lead), outcome: result.outcome },
    result.outcome === 'created' ? 201 : 200,
  );
}

/** PATCH /api/leads/:id */
export async function updateLead(req: Request, res: Response): Promise<void> {
  const lead = await leadService.updateLead(
    currentUser(req),
    params<{ id: string }>(req).id,
    req.body as UpdateLeadInput,
  );
  sendSuccess(res, { lead: toPublicLead(lead) });
}

/** DELETE /api/leads/:id */
export async function deleteLead(req: Request, res: Response): Promise<void> {
  await leadService.deleteLead(currentUser(req), params<{ id: string }>(req).id);
  sendSuccess(res, { message: 'Lead deleted' });
}

/** PUT /api/leads/:id/assignment */
export async function assignLead(req: Request, res: Response): Promise<void> {
  const lead = await leadService.assignLead(
    currentUser(req),
    params<{ id: string }>(req).id,
    req.body as AssignLeadInput,
  );
  sendSuccess(res, { lead: toPublicLead(lead) });
}

/** PUT /api/leads/:id/stage */
export async function changeStage(req: Request, res: Response): Promise<void> {
  const lead = await leadService.changeStage(
    currentUser(req),
    params<{ id: string }>(req).id,
    req.body as ChangeStageInput,
  );
  sendSuccess(res, { lead: toPublicLead(lead) });
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** GET /api/leads/:id/timeline */
export async function listTimeline(req: Request, res: Response): Promise<void> {
  const result = await activityService.listTimeline(
    currentUser(req),
    params<{ id: string }>(req).id,
    query<ListActivitiesQuery>(req),
  );

  sendSuccess(res, {
    activities: toPublicActivities(result.activities, SYSTEM_ACTIVITY_TYPES),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  });
}

/**
 * POST /api/leads/:id/activities
 *
 * `advanced` names the milestones this entry moved, so the client can tell the
 * user "this lead is now counted as contacted" instead of leaving them to
 * infer it from a funnel that changed somewhere else on the screen.
 */
export async function createActivity(req: Request, res: Response): Promise<void> {
  const result = await activityService.logActivity(
    currentUser(req),
    params<{ id: string }>(req).id,
    req.body as CreateActivityInput,
  );

  sendSuccess(
    res,
    {
      activity: toPublicActivity(
        { ...result.activity, createdBy: null },
        SYSTEM_ACTIVITY_TYPES,
      ),
      lead: toPublicLead(result.lead),
      advanced: result.advanced,
    },
    201,
  );
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/** GET /api/leads/funnel */
export async function getFunnel(req: Request, res: Response): Promise<void> {
  const report = await funnelService.getFunnel(currentUser(req), query<AnalyticsQuery>(req));
  sendSuccess(res, report);
}

/** GET /api/leads/leakage */
export async function getLeakageReport(req: Request, res: Response): Promise<void> {
  const report = await leakageService.getLeakageReport(currentUser(req), query<LeakageQuery>(req));
  sendSuccess(res, report);
}

/** GET /api/leads/response-times */
export async function getResponseTimeReport(req: Request, res: Response): Promise<void> {
  const report = await responseTimeService.getResponseTimeReport(
    currentUser(req),
    query<ResponseTimeQuery>(req),
  );
  sendSuccess(res, report);
}

/** GET /api/leads/follow-ups */
export async function getFollowUpDashboard(req: Request, res: Response): Promise<void> {
  const dashboard = await followUpService.getFollowUpDashboard(
    currentUser(req),
    query<FollowUpQuery>(req),
  );
  sendSuccess(res, dashboard);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** GET /api/lead-sources */
export async function listSources(req: Request, res: Response): Promise<void> {
  const sources = await catalogService.listSources(
    currentUser(req),
    query<ListLeadSourcesQuery>(req),
  );
  sendSuccess(res, { sources: sources.map(toPublicLeadSource) });
}

/** GET /api/lead-sources/:id */
export async function getSource(req: Request, res: Response): Promise<void> {
  const source = await catalogService.getSourceById(
    currentUser(req),
    params<{ id: string }>(req).id,
  );
  sendSuccess(res, { source: toPublicLeadSource(source) });
}

/** POST /api/lead-sources */
export async function createSource(req: Request, res: Response): Promise<void> {
  const source = await catalogService.createSource(
    currentUser(req),
    req.body as CreateLeadSourceInput,
  );
  sendSuccess(res, { source: toPublicLeadSource(source) }, 201);
}

/** PATCH /api/lead-sources/:id */
export async function updateSource(req: Request, res: Response): Promise<void> {
  const source = await catalogService.updateSource(
    currentUser(req),
    params<{ id: string }>(req).id,
    req.body as UpdateLeadSourceInput,
  );
  sendSuccess(res, { source: toPublicLeadSource(source) });
}

/** DELETE /api/lead-sources/:id */
export async function deleteSource(req: Request, res: Response): Promise<void> {
  await catalogService.deleteSource(currentUser(req), params<{ id: string }>(req).id);
  sendSuccess(res, { message: 'Lead source deleted' });
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/** GET /api/lead-stages */
export async function listStages(req: Request, res: Response): Promise<void> {
  const stages = await catalogService.listStages(currentUser(req));
  sendSuccess(res, { stages: stages.map(toPublicLeadStage) });
}

/** GET /api/lead-stages/:id */
export async function getStage(req: Request, res: Response): Promise<void> {
  const stage = await catalogService.getStageById(currentUser(req), params<{ id: string }>(req).id);
  sendSuccess(res, { stage: toPublicLeadStage(stage) });
}

/** POST /api/lead-stages */
export async function createStage(req: Request, res: Response): Promise<void> {
  const stage = await catalogService.createStage(
    currentUser(req),
    req.body as CreateLeadStageInput,
  );
  sendSuccess(res, { stage: toPublicLeadStage(stage) }, 201);
}

/** PATCH /api/lead-stages/:id */
export async function updateStage(req: Request, res: Response): Promise<void> {
  const stage = await catalogService.updateStage(
    currentUser(req),
    params<{ id: string }>(req).id,
    req.body as UpdateLeadStageInput,
  );
  sendSuccess(res, { stage: toPublicLeadStage(stage) });
}

/** DELETE /api/lead-stages/:id */
export async function deleteStage(req: Request, res: Response): Promise<void> {
  await catalogService.deleteStage(currentUser(req), params<{ id: string }>(req).id);
  sendSuccess(res, { message: 'Pipeline stage deleted' });
}
