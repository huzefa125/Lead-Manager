import { LeadActivityType, LeadStageType, LeadStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/api-error';
import type { AuthenticatedUser } from '../users/user.types';
import { recordSystemActivity } from './activity.service';
import * as catalog from './catalog.service';
import {
  milestonesForAssignment,
  milestonesForStage,
  type LeadMilestones,
  type MilestonePatch,
} from './lead.milestones';
import * as repository from './lead.repository';
import type { LeadWithRelations } from './lead.repository';
import type {
  AssignLeadInput,
  CaptureLeadInput,
  ChangeStageInput,
  CreateLeadInput,
  ListLeadsQuery,
  UpdateLeadInput,
} from './lead.validation';

/**
 * Leads, and every state change that can happen to one.
 *
 * Each mutation here writes a timeline entry in the same transaction as the
 * change itself. That is the module's central rule: if the pipeline moved and
 * nobody can see who moved it or when, the history is decoration rather than
 * an audit — and the funnel built on top of it cannot be trusted either.
 *
 * Every query is confined to `user.organizationId`; see the tenancy note in
 * `catalog.service.ts` for why the lead engine has no cross-tenant mode.
 */

/** Fields shared by create, capture and update. Explicit, never spread. */
type ContactFields = Pick<
  Prisma.LeadUncheckedCreateInput,
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'whatsapp'
  | 'company'
  | 'jobTitle'
  | 'website'
  | 'campaign'
  | 'landingPage'
  | 'utmSource'
  | 'utmMedium'
  | 'utmCampaign'
  | 'utmTerm'
  | 'utmContent'
  | 'referrer'
>;

function contactFields(input: Partial<CreateLeadInput>): ContactFields {
  return {
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    whatsapp: input.whatsapp ?? null,
    company: input.company ?? null,
    jobTitle: input.jobTitle ?? null,
    website: input.website ?? null,
    campaign: input.campaign ?? null,
    landingPage: input.landingPage ?? null,
    utmSource: input.utmSource ?? null,
    utmMedium: input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
    utmTerm: input.utmTerm ?? null,
    utmContent: input.utmContent ?? null,
    referrer: input.referrer ?? null,
  };
}

/** The milestone state of a lead that does not exist yet. */
function freshMilestones(capturedAt: Date): LeadMilestones {
  return {
    capturedAt,
    assignedAt: null,
    firstContactAt: null,
    firstReplyAt: null,
    meetingBookedAt: null,
    quotationSentAt: null,
    lastFollowUpAt: null,
    followUpCount: 0,
    lastActivityAt: null,
    closedAt: null,
    status: LeadStatus.OPEN,
  };
}

/**
 * Confirms an assignee is a real, active member of the caller's organization.
 *
 * Without this check a caller could assign leads to a user id from another
 * tenant, which both leaks the existence of that account and hands them a
 * lead they will never see.
 */
async function assertAssignable(organizationId: string, userId: string): Promise<void> {
  const user = await repository.findAssignableUser(organizationId, userId);
  if (!user) {
    throw ApiError.validation('Validation failed', [
      { field: 'assignedToId', message: 'No active user in this organization with that id' },
    ]);
  }
}

export async function listLeads(
  user: AuthenticatedUser,
  query: ListLeadsQuery,
): Promise<{
  leads: LeadWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  if (query.assignedToId && query.unassigned) {
    throw ApiError.validation('Validation failed', [
      { field: 'unassigned', message: 'Cannot combine unassigned=true with assignedToId' },
    ]);
  }

  const staleBefore =
    query.staleForDays === undefined
      ? undefined
      : new Date(Date.now() - query.staleForDays * 24 * 60 * 60 * 1000);

  const { leads, total } = await repository.listLeads({
    organizationId: user.organizationId,
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    search: query.search,
    status: query.status,
    channel: query.channel,
    stageId: query.stageId,
    sourceId: query.sourceId,
    assignedToId: query.assignedToId,
    unassigned: query.unassigned,
    capturedFrom: query.capturedFrom,
    capturedTo: query.capturedTo,
    staleBefore,
    sort: query.sort,
    order: query.order,
  });

  return {
    leads,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getLeadById(
  user: AuthenticatedUser,
  id: string,
): Promise<LeadWithRelations> {
  const lead = await repository.findLeadById(user.organizationId, id);
  if (!lead) throw ApiError.notFound('Lead not found');
  return lead;
}

export async function createLead(
  user: AuthenticatedUser,
  input: CreateLeadInput,
): Promise<{ lead: LeadWithRelations; created: boolean }> {
  await repository.ensureDefaults(user.organizationId);

  const source = await catalog.resolveSource(user.organizationId, input);
  const stage = await catalog.resolveStage(user.organizationId, input);

  if (input.externalId) {
    // Same source, same upstream id — the caller is retrying, not adding.
    const existing = await repository.findLeadByExternalId(source.id, input.externalId);
    if (existing) return { lead: existing, created: false };
  }

  if (input.assignedToId) await assertAssignable(user.organizationId, input.assignedToId);

  const capturedAt = input.capturedAt ?? new Date();
  const base = freshMilestones(capturedAt);

  // An import can land a lead directly at "Quotation Sent"; the stage it starts
  // in proves the milestones underneath it.
  const stagePatch = milestonesForStage(stage.key, stage.type, capturedAt, base);
  const assignPatch = input.assignedToId ? milestonesForAssignment(base, capturedAt) : {};

  const lead = await prisma.$transaction(async (tx) => {
    const created = await repository.createLead(
      {
        organizationId: user.organizationId,
        ...contactFields(input),
        sourceId: source.id,
        stageId: stage.id,
        externalId: input.externalId ?? null,
        estimatedValue: input.estimatedValue ?? null,
        ...(input.currency ? { currency: input.currency } : {}),
        notes: input.notes ?? null,
        assignedToId: input.assignedToId ?? null,
        createdById: user.id,
        capturedAt,
        lastActivityAt: capturedAt,
        ...stagePatch,
        ...assignPatch,
      },
      tx,
    );

    await recordSystemActivity(tx, {
      organizationId: user.organizationId,
      leadId: created.id,
      type: LeadActivityType.CREATED,
      subject: `Lead created from ${source.name}`,
      metadata: { sourceKey: source.key, channel: source.channel, stageKey: stage.key },
      createdById: user.id,
      occurredAt: capturedAt,
    });

    if (input.assignedToId) {
      await recordSystemActivity(tx, {
        organizationId: user.organizationId,
        leadId: created.id,
        type: LeadActivityType.ASSIGNED,
        subject: 'Lead assigned',
        metadata: { fromUserId: null, toUserId: input.assignedToId },
        createdById: user.id,
        occurredAt: capturedAt,
      });
    }

    return created;
  });

  return { lead, created: true };
}

export type CaptureOutcome = 'created' | 'duplicate_external_id' | 'merged_into_open_lead';

/**
 * The unified-inbox entry point.
 *
 * Differs from `createLead` in what it refuses to accept: no stage, no owner,
 * no status. Every captured lead starts at the top of the pipeline, because
 * the first number in the funnel only means "leads received" if nothing can
 * enter halfway down.
 *
 * It also refuses to create the same person twice. A prospect who fills the
 * website form on Monday and the WhatsApp form on Thursday is one lead with two
 * touches — counting them as two triples the top of the funnel and puts two
 * salespeople on the same conversation.
 */
export async function captureLead(
  user: AuthenticatedUser,
  input: CaptureLeadInput,
): Promise<{ lead: LeadWithRelations; outcome: CaptureOutcome }> {
  await repository.ensureDefaults(user.organizationId);

  const source = await catalog.resolveSource(user.organizationId, {
    sourceKey: input.sourceKey,
    channel: input.channel,
  });

  if (input.externalId) {
    const existing = await repository.findLeadByExternalId(source.id, input.externalId);
    if (existing) return { lead: existing, outcome: 'duplicate_external_id' };
  }

  const duplicate = await repository.findOpenDuplicate(user.organizationId, {
    email: input.email,
    phone: input.phone,
    whatsapp: input.whatsapp,
  });

  if (duplicate) return { lead: await mergeCapture(duplicate, input, source), outcome: 'merged_into_open_lead' };

  const capturedAt = input.capturedAt ?? new Date();
  const stage = await catalog.resolveStage(user.organizationId, {});

  const lead = await prisma.$transaction(async (tx) => {
    const created = await repository.createLead(
      {
        organizationId: user.organizationId,
        ...contactFields(input),
        sourceId: source.id,
        stageId: stage.id,
        externalId: input.externalId ?? null,
        estimatedValue: input.estimatedValue ?? null,
        ...(input.currency ? { currency: input.currency } : {}),
        notes: input.notes ?? null,
        createdById: user.id,
        capturedAt,
        lastActivityAt: capturedAt,
      },
      tx,
    );

    await recordSystemActivity(tx, {
      organizationId: user.organizationId,
      leadId: created.id,
      type: LeadActivityType.CREATED,
      subject: `Lead captured from ${source.name}`,
      metadata: {
        sourceKey: source.key,
        channel: source.channel,
        campaign: input.campaign ?? null,
        landingPage: input.landingPage ?? null,
        utm: {
          source: input.utmSource ?? null,
          medium: input.utmMedium ?? null,
          campaign: input.utmCampaign ?? null,
          term: input.utmTerm ?? null,
          content: input.utmContent ?? null,
        },
      },
      createdById: user.id,
      occurredAt: capturedAt,
    });

    return created;
  });

  return { lead, outcome: 'created' };
}

/**
 * Folds a repeat submission into the lead that already exists.
 *
 * Fills blanks only — a later form that omits the company must not erase the
 * company someone typed in by hand. The touch is recorded as an internal note
 * rather than an inbound message on purpose: filling a form again is not a
 * reply to our outreach, and counting it as one would inflate the reply rate,
 * which is the funnel's most load-bearing number.
 */
async function mergeCapture(
  existing: LeadWithRelations,
  input: CaptureLeadInput,
  source: { id: string; key: string; name: string },
): Promise<LeadWithRelations> {
  const incoming = contactFields(input);
  const fill: Prisma.LeadUncheckedUpdateInput = {};

  for (const [field, value] of Object.entries(incoming) as [keyof ContactFields, string | null][]) {
    if (value !== null && existing[field] === null) fill[field] = value;
  }

  if (existing.estimatedValue === null && input.estimatedValue !== undefined) {
    fill.estimatedValue = input.estimatedValue;
  }

  const occurredAt = input.capturedAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    await recordSystemActivity(tx, {
      organizationId: existing.organizationId,
      leadId: existing.id,
      type: LeadActivityType.CREATED,
      subject: `Repeat enquiry from ${source.name}`,
      body: 'Matched an open lead with the same email or phone, so it was recorded here instead of creating a duplicate.',
      metadata: {
        sourceKey: source.key,
        campaign: input.campaign ?? null,
        landingPage: input.landingPage ?? null,
        filledFields: Object.keys(fill),
      },
      occurredAt,
    });

    return repository.updateLead(existing.id, { ...fill, lastActivityAt: occurredAt }, tx);
  });
}

export async function updateLead(
  user: AuthenticatedUser,
  id: string,
  input: UpdateLeadInput,
): Promise<LeadWithRelations> {
  const lead = await getLeadById(user, id);

  if (input.sourceId && input.sourceId !== lead.sourceId) {
    // Re-attribution has to stay inside the tenant, and resolveSource is the
    // only place that check lives.
    await catalog.resolveSource(user.organizationId, { sourceId: input.sourceId });
  }

  // Written out rather than looped: every field that reaches the database is
  // visible here, so adding a column to the model does not silently become
  // editable through this endpoint.
  const data: Prisma.LeadUncheckedUpdateInput = {
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.whatsapp !== undefined ? { whatsapp: input.whatsapp } : {}),
    ...(input.company !== undefined ? { company: input.company } : {}),
    ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
    ...(input.website !== undefined ? { website: input.website } : {}),
    ...(input.campaign !== undefined ? { campaign: input.campaign } : {}),
    ...(input.landingPage !== undefined ? { landingPage: input.landingPage } : {}),
    ...(input.utmSource !== undefined ? { utmSource: input.utmSource } : {}),
    ...(input.utmMedium !== undefined ? { utmMedium: input.utmMedium } : {}),
    ...(input.utmCampaign !== undefined ? { utmCampaign: input.utmCampaign } : {}),
    ...(input.utmTerm !== undefined ? { utmTerm: input.utmTerm } : {}),
    ...(input.utmContent !== undefined ? { utmContent: input.utmContent } : {}),
    ...(input.referrer !== undefined ? { referrer: input.referrer } : {}),
    ...(input.estimatedValue !== undefined ? { estimatedValue: input.estimatedValue } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.lostReason !== undefined ? { lostReason: input.lostReason } : {}),
    ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
  };

  return repository.updateLead(id, data);
}

export async function deleteLead(user: AuthenticatedUser, id: string): Promise<void> {
  await getLeadById(user, id);
  // Activities cascade from the schema — a lead's history has no meaning
  // without the lead.
  await repository.deleteLead(id);
}

export async function assignLead(
  user: AuthenticatedUser,
  id: string,
  input: AssignLeadInput,
): Promise<LeadWithRelations> {
  const lead = await getLeadById(user, id);

  if (input.assignedToId) await assertAssignable(user.organizationId, input.assignedToId);
  // Re-assigning to the current owner is a no-op, not a timeline entry. A
  // history full of "assigned to Ada" repeated by an over-eager UI is worse
  // than no history.
  if (lead.assignedToId === input.assignedToId) return lead;

  const now = new Date();
  // Write-once, so it measures time-to-first-owner. Unassigning does not clear
  // it: the lead did once have an owner, and pretending otherwise would reset
  // that clock.
  const patch: MilestonePatch = input.assignedToId ? milestonesForAssignment(lead, now) : {};

  return prisma.$transaction(async (tx) => {
    await recordSystemActivity(tx, {
      organizationId: user.organizationId,
      leadId: lead.id,
      type: LeadActivityType.ASSIGNED,
      subject: input.assignedToId ? 'Lead assigned' : 'Lead unassigned',
      body: input.note ?? undefined,
      metadata: { fromUserId: lead.assignedToId, toUserId: input.assignedToId },
      createdById: user.id,
      occurredAt: now,
    });

    return repository.updateLead(
      lead.id,
      { assignedToId: input.assignedToId, lastActivityAt: now, ...patch },
      tx,
    );
  });
}

export async function changeStage(
  user: AuthenticatedUser,
  id: string,
  input: ChangeStageInput,
): Promise<LeadWithRelations> {
  const lead = await getLeadById(user, id);
  const stage = await catalog.resolveStage(user.organizationId, input);

  if (stage.id === lead.stageId) return lead;

  // A lost lead with no reason is a lost lesson. This is the one field that
  // turns "we lose 40% at quotation" into something a team can act on, so it
  // is required rather than encouraged.
  const lostReason = input.lostReason ?? lead.lostReason;
  if (stage.type === LeadStageType.LOST && !lostReason) {
    throw ApiError.validation('Validation failed', [
      { field: 'lostReason', message: `Moving a lead to "${stage.name}" requires a reason` },
    ]);
  }

  const occurredAt = input.occurredAt ?? new Date();
  const patch = milestonesForStage(stage.key, stage.type, occurredAt, lead);
  const statusChanged = patch.status !== undefined && patch.status !== lead.status;

  return prisma.$transaction(async (tx) => {
    await recordSystemActivity(tx, {
      organizationId: user.organizationId,
      leadId: lead.id,
      type: LeadActivityType.STAGE_CHANGED,
      subject: `Moved to ${stage.name}`,
      body: input.note ?? undefined,
      metadata: {
        fromStageId: lead.stageId,
        fromStageName: lead.stage.name,
        toStageId: stage.id,
        toStageName: stage.name,
      },
      createdById: user.id,
      occurredAt,
    });

    if (statusChanged) {
      await recordSystemActivity(tx, {
        organizationId: user.organizationId,
        leadId: lead.id,
        type: LeadActivityType.STATUS_CHANGED,
        subject: `Marked ${String(patch.status).toLowerCase()}`,
        metadata: {
          fromStatus: lead.status,
          toStatus: patch.status,
          ...(stage.type === LeadStageType.LOST ? { lostReason } : {}),
        },
        createdById: user.id,
        occurredAt,
      });
    }

    return repository.updateLead(
      lead.id,
      {
        stageId: stage.id,
        // Clearing the reason on the way back out keeps a reopened lead from
        // carrying a stale explanation of why it was lost.
        lostReason: stage.type === LeadStageType.LOST ? lostReason : null,
        ...patch,
      },
      tx,
    );
  });
}
