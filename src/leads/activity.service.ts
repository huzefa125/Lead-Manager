import { type LeadActivity, LeadActivityType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/api-error';
import type { AuthenticatedUser } from '../users/user.types';
import { SYSTEM_ACTIVITY_TYPES } from './lead.constants';
import { milestonesForActivity, type MilestonePatch } from './lead.milestones';
import * as repository from './lead.repository';
import type { ActivityWithActor, LeadWithRelations } from './lead.repository';
import type { CreateActivityInput, ListActivitiesQuery } from './lead.validation';

/**
 * The timeline.
 *
 * Every activity write does two things in one transaction: it appends the
 * entry, and it advances whatever milestones that entry proves. Splitting them
 * would let a crash between the two leave a lead whose history says a meeting
 * happened while its funnel says it never got past first contact — and the
 * only way to detect that afterwards is to replay the whole activity table.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Loads a lead for writing, confined to the caller's tenant. */
async function loadLead(organizationId: string, leadId: string): Promise<LeadWithRelations> {
  const lead = await repository.findLeadById(organizationId, leadId);
  if (!lead) throw ApiError.notFound('Lead not found');
  return lead;
}

/**
 * Appends a system-generated entry — created, assigned, stage moved.
 *
 * Kept separate from `logActivity` because these carry no milestone logic of
 * their own: the caller has already computed the state change and passes the
 * before/after in `metadata`. Clients cannot produce these types; the
 * validation schema rejects them, so the audit trail cannot be forged.
 */
export async function recordSystemActivity(
  db: Db,
  input: {
    organizationId: string;
    leadId: string;
    type: (typeof SYSTEM_ACTIVITY_TYPES)[number];
    subject: string;
    body?: string | undefined;
    metadata?: Prisma.InputJsonValue | undefined;
    createdById?: string | undefined;
    occurredAt?: Date | undefined;
  },
): Promise<LeadActivity> {
  return repository.createActivity(
    {
      organizationId: input.organizationId,
      leadId: input.leadId,
      type: input.type,
      subject: input.subject,
      body: input.body ?? null,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      createdById: input.createdById ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    },
    db,
  );
}

export interface LoggedActivity {
  activity: LeadActivity;
  lead: LeadWithRelations;
  /** The milestones this entry moved — what the UI highlights after logging. */
  advanced: (keyof MilestonePatch)[];
}

/**
 * Logs a call, email, meeting, quotation or note against a lead.
 *
 * This is the endpoint that actually builds the funnel. A salesperson recording
 * an outbound call is what turns a lead from "received" into "contacted"; the
 * reply that follows is what turns it into "replied". Nothing else populates
 * those numbers, which is why the direction field is required rather than
 * inferred.
 */
export async function logActivity(
  user: AuthenticatedUser,
  leadId: string,
  input: CreateActivityInput,
): Promise<LoggedActivity> {
  const lead = await loadLead(user.organizationId, leadId);
  const occurredAt = input.occurredAt ?? new Date();

  const patch = milestonesForActivity(
    { type: input.type, direction: input.direction, occurredAt },
    lead,
  );

  const advanced = (Object.keys(patch) as (keyof MilestonePatch)[]).filter(
    (field) => field !== 'lastActivityAt' && lead[field] !== patch[field],
  );

  const { activity, updated } = await prisma.$transaction(async (tx) => {
    const created = await repository.createActivity(
      {
        organizationId: user.organizationId,
        leadId: lead.id,
        type: input.type,
        direction: input.direction,
        subject: input.subject ?? null,
        body: input.body ?? null,
        durationMinutes: input.durationMinutes ?? null,
        occurredAt,
        createdById: user.id,
      },
      tx,
    );

    const next = await repository.updateLead(lead.id, patch, tx);
    return { activity: created, updated: next };
  });

  return { activity, lead: updated, advanced };
}

export async function listTimeline(
  user: AuthenticatedUser,
  leadId: string,
  query: ListActivitiesQuery,
): Promise<{
  activities: ActivityWithActor[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  // Confirms the lead is in the caller's tenant before exposing its history.
  await loadLead(user.organizationId, leadId);

  const { activities, total } = await repository.listActivities({
    leadId,
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    ...(query.type ? { type: { in: query.type } } : {}),
    ...(query.direction ? { direction: { in: query.direction } } : {}),
    ...(query.excludeSystem ? { excludeTypes: SYSTEM_ACTIVITY_TYPES } : {}),
    order: query.order,
  });

  return {
    activities,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/** Re-exported so the serializer and routes share one definition of "system". */
export const systemActivityTypes: readonly LeadActivityType[] = SYSTEM_ACTIVITY_TYPES;
