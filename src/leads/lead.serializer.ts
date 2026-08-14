import type {
  Lead,
  LeadActivity,
  LeadActivityDirection,
  LeadActivityType,
  LeadChannel,
  LeadSource,
  LeadStage,
  LeadStageType,
  LeadStatus,
  Prisma,
} from '@prisma/client';
import { nextExpectedStep } from './lead.milestones';
import type { ActivityWithActor, LeadWithRelations } from './lead.repository';

/**
 * The only lead shapes that may cross the API boundary.
 *
 * Fields are picked explicitly rather than spread, so a column added later —
 * an internal score, a scraped enrichment blob — is excluded by default and
 * has to be opted in to.
 */

export interface LeadSourceSummary {
  id: string;
  key: string;
  name: string;
  channel: LeadChannel;
}

export interface PublicLeadSource extends LeadSourceSummary {
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
  leadCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadStageSummary {
  id: string;
  key: string;
  name: string;
  position: number;
  type: LeadStageType;
}

export interface PublicLeadStage extends LeadStageSummary {
  description: string | null;
  isSystem: boolean;
  leadCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadOwnerSummary {
  id: string;
  name: string | null;
  email: string;
}

/** The journey, as the UI renders it — one flag per milestone, in order. */
export interface LeadJourney {
  capturedAt: Date;
  assignedAt: Date | null;
  firstContactAt: Date | null;
  firstReplyAt: Date | null;
  meetingBookedAt: Date | null;
  quotationSentAt: Date | null;
  lastFollowUpAt: Date | null;
  followUpCount: number;
  closedAt: Date | null;
  /** The step this lead has not reached yet. `null` once it is closed. */
  nextStep: { key: string; label: string } | null;
  /** Capture → first outbound touch, in hours. The number that predicts wins. */
  hoursToFirstContact: number | null;
  /** First contact → first reply, in hours. */
  hoursToFirstReply: number | null;
  /** Capture → close, in days. */
  daysToClose: number | null;
}

export interface PublicLead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  company: string | null;
  jobTitle: string | null;
  website: string | null;

  source: LeadSourceSummary | null;
  channel: LeadChannel | null;
  campaign: string | null;
  landingPage: string | null;
  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    term: string | null;
    content: string | null;
  };
  referrer: string | null;
  externalId: string | null;

  estimatedValue: number | null;
  currency: string;

  stage: LeadStageSummary | null;
  status: LeadStatus;
  lostReason: string | null;
  notes: string | null;

  assignedTo: LeadOwnerSummary | null;
  journey: LeadJourney;
  lastActivityAt: Date | null;
  activityCount?: number;

  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicLeadActivity {
  id: string;
  leadId: string;
  type: LeadActivityType;
  direction: LeadActivityDirection;
  subject: string | null;
  body: string | null;
  occurredAt: Date;
  durationMinutes: number | null;
  metadata: Prisma.JsonValue | null;
  /** True for entries the system wrote — a UI usually renders these differently. */
  isSystem: boolean;
  actor: LeadOwnerSummary | null;
  createdAt: Date;
}

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

/** Rounded to one decimal — false precision helps nobody read a report. */
function elapsed(from: Date | null, to: Date | null, unit: number): number | null {
  if (!from || !to) return null;
  return Math.round(((to.getTime() - from.getTime()) / unit) * 10) / 10;
}

/**
 * Prisma returns `Decimal` for money columns. `Number` is exact for every value
 * a 14,2 column can hold below 2^53, which covers any deal value that is not a
 * typo, and gives clients a plain JSON number instead of an object they would
 * have to know how to parse.
 */
function toAmount(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

function fullName(lead: Pick<Lead, 'firstName' | 'lastName'>): string | null {
  const parts = [lead.firstName, lead.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

export function toLeadSourceSummary(source: LeadSource): LeadSourceSummary {
  return { id: source.id, key: source.key, name: source.name, channel: source.channel };
}

export function toPublicLeadSource(
  source: LeadSource & { _count?: { leads: number } },
): PublicLeadSource {
  return {
    ...toLeadSourceSummary(source),
    description: source.description,
    isActive: source.isActive,
    isSystem: source.isSystem,
    ...(source._count ? { leadCount: source._count.leads } : {}),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

export function toLeadStageSummary(stage: LeadStage): LeadStageSummary {
  return {
    id: stage.id,
    key: stage.key,
    name: stage.name,
    position: stage.position,
    type: stage.type,
  };
}

export function toPublicLeadStage(
  stage: LeadStage & { _count?: { leads: number } },
): PublicLeadStage {
  return {
    ...toLeadStageSummary(stage),
    description: stage.description,
    isSystem: stage.isSystem,
    ...(stage._count ? { leadCount: stage._count.leads } : {}),
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };
}

function toOwnerSummary(
  user: { id: string; name: string | null; email: string } | null | undefined,
): LeadOwnerSummary | null {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

function toJourney(lead: Lead): LeadJourney {
  return {
    capturedAt: lead.capturedAt,
    assignedAt: lead.assignedAt,
    firstContactAt: lead.firstContactAt,
    firstReplyAt: lead.firstReplyAt,
    meetingBookedAt: lead.meetingBookedAt,
    quotationSentAt: lead.quotationSentAt,
    lastFollowUpAt: lead.lastFollowUpAt,
    followUpCount: lead.followUpCount,
    closedAt: lead.closedAt,
    nextStep: nextExpectedStep(lead),
    hoursToFirstContact: elapsed(lead.capturedAt, lead.firstContactAt, MS_PER_HOUR),
    hoursToFirstReply: elapsed(lead.firstContactAt, lead.firstReplyAt, MS_PER_HOUR),
    daysToClose: elapsed(lead.capturedAt, lead.closedAt, MS_PER_DAY),
  };
}

export function toPublicLead(lead: LeadWithRelations): PublicLead {
  return {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    fullName: fullName(lead),
    email: lead.email,
    phone: lead.phone,
    whatsapp: lead.whatsapp,
    company: lead.company,
    jobTitle: lead.jobTitle,
    website: lead.website,

    source: lead.source ? toLeadSourceSummary(lead.source) : null,
    channel: lead.source?.channel ?? null,
    campaign: lead.campaign,
    landingPage: lead.landingPage,
    utm: {
      source: lead.utmSource,
      medium: lead.utmMedium,
      campaign: lead.utmCampaign,
      term: lead.utmTerm,
      content: lead.utmContent,
    },
    referrer: lead.referrer,
    externalId: lead.externalId,

    estimatedValue: toAmount(lead.estimatedValue),
    currency: lead.currency,

    stage: lead.stage ? toLeadStageSummary(lead.stage) : null,
    status: lead.status,
    lostReason: lead.lostReason,
    notes: lead.notes,

    assignedTo: toOwnerSummary(lead.assignedTo),
    journey: toJourney(lead),
    lastActivityAt: lead.lastActivityAt,
    ...(lead._count ? { activityCount: lead._count.activities } : {}),

    organizationId: lead.organizationId,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

export function toPublicLeads(leads: LeadWithRelations[]): PublicLead[] {
  return leads.map(toPublicLead);
}

export function toPublicActivity(
  activity: ActivityWithActor,
  systemTypes: readonly LeadActivityType[],
): PublicLeadActivity {
  return {
    id: activity.id,
    leadId: activity.leadId,
    type: activity.type,
    direction: activity.direction,
    subject: activity.subject,
    body: activity.body,
    occurredAt: activity.occurredAt,
    durationMinutes: activity.durationMinutes,
    metadata: activity.metadata ?? null,
    isSystem: systemTypes.includes(activity.type),
    actor: toOwnerSummary(activity.createdBy),
    createdAt: activity.createdAt,
  };
}

export function toPublicActivities(
  activities: ActivityWithActor[],
  systemTypes: readonly LeadActivityType[],
): PublicLeadActivity[] {
  return activities.map((activity) => toPublicActivity(activity, systemTypes));
}
