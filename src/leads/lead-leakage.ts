import type { LeadChannel, LeadStageType, LeadStatus } from '@prisma/client';
import { LeadStatus as Status } from '@prisma/client';

/**
 * Lead leakage detection.
 *
 * The funnel (`lead.milestones.ts`) answers "how far did leads get". This
 * module answers the harder question: "which open leads are quietly rotting
 * right now, and how much pipeline value is sitting behind them". Every rule
 * here is a pure function over plain values, for the same reason the
 * milestone engine is — these are the rules most likely to be argued about,
 * and an argument is only settled by a test that runs in milliseconds.
 *
 * Two leak types named in the product brief — leads lost between systems,
 * and ad-platform leads that never reach the CRM — are **not** implemented
 * here. Detecting them needs data this API does not have: an upstream
 * system's delivery log, or an ad platform's own lead count. Inventing a
 * number without that data would be worse than not reporting one.
 * `detectSilentSources` is the closest honest proxy available from data
 * already inside the CRM: a channel that has gone quiet is the visible
 * symptom of exactly that failure mode, even without visibility into its cause.
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export interface LeakageThresholds {
  /** Assigned but not contacted within this many hours. */
  assignedTooLongHours: number;
  /** Capture-to-first-contact beyond this many hours counts as "too late". */
  lateContactHours: number;
  /** No activity this many days after first contact. */
  noFollowUpDays: number;
  /** No activity this many days after a quotation went out. */
  quoteStaleDays: number;
  /** No activity this many days after a meeting, with no quotation sent. */
  meetingStaleDays: number;
  /** A previously-engaged lead silent this many days. */
  hotInactiveDays: number;
  /** Sitting in the same pipeline stage this many days. */
  stuckInStageDays: number;
  /** An active source with no capture in this many days. */
  silentSourceDays: number;
}

export const DEFAULT_LEAKAGE_THRESHOLDS: LeakageThresholds = {
  assignedTooLongHours: 48,
  lateContactHours: 24,
  noFollowUpDays: 5,
  quoteStaleDays: 3,
  meetingStaleDays: 3,
  hotInactiveDays: 4,
  stuckInStageDays: 10,
  silentSourceDays: 7,
};

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type LeakType =
  | 'assigned_not_contacted'
  | 'late_first_contact'
  | 'no_followup_after_contact'
  | 'quote_sent_no_followup'
  | 'meeting_no_next_step'
  | 'hot_lead_gone_cold'
  | 'stuck_with_salesperson'
  | 'lost_without_reason';

export type LeakSeverity = 'high' | 'medium' | 'low';
export type LeakUnit = 'hours' | 'days';

export interface LeakRuleDefinition {
  type: LeakType;
  label: string;
  severity: LeakSeverity;
  unit: LeakUnit;
  /** Whether this rule's leads count toward at-risk pipeline value. */
  countsTowardRisk: boolean;
}

/**
 * Static metadata, ordered by severity — the order the report lists rules in.
 *
 * `lost_without_reason` counts as `low` and does not contribute to at-risk
 * value: a lost lead is not pipeline anymore. It is still worth surfacing —
 * it means "we lose 40% at quotation" can never be answered — but it is a
 * data-hygiene defect, not money sitting on the table.
 */
export const LEAK_RULES: Record<LeakType, LeakRuleDefinition> = {
  assigned_not_contacted: {
    type: 'assigned_not_contacted',
    label: 'Assigned but never contacted',
    severity: 'high',
    unit: 'hours',
    countsTowardRisk: true,
  },
  no_followup_after_contact: {
    type: 'no_followup_after_contact',
    label: 'No follow-up after first conversation',
    severity: 'high',
    unit: 'days',
    countsTowardRisk: true,
  },
  quote_sent_no_followup: {
    type: 'quote_sent_no_followup',
    label: 'Quote sent, no follow-up',
    severity: 'high',
    unit: 'days',
    countsTowardRisk: true,
  },
  hot_lead_gone_cold: {
    type: 'hot_lead_gone_cold',
    label: 'Hot lead suddenly inactive',
    severity: 'high',
    unit: 'days',
    countsTowardRisk: true,
  },
  meeting_no_next_step: {
    type: 'meeting_no_next_step',
    label: 'Meeting happened, no next step',
    severity: 'medium',
    unit: 'days',
    countsTowardRisk: true,
  },
  stuck_with_salesperson: {
    type: 'stuck_with_salesperson',
    label: 'Stuck with salesperson',
    severity: 'medium',
    unit: 'days',
    countsTowardRisk: true,
  },
  // Historical response-time signals, not live pipeline risk: `status` is not
  // part of either rule, so a lead flagged here may already be won or lost.
  // Worth surfacing for coaching; wrong to add to "pipeline at risk right now".
  late_first_contact: {
    type: 'late_first_contact',
    label: 'Contacted too late',
    severity: 'medium',
    unit: 'hours',
    countsTowardRisk: false,
  },
  lost_without_reason: {
    type: 'lost_without_reason',
    label: 'Marked lost without a reason',
    severity: 'low',
    unit: 'days',
    countsTowardRisk: false,
  },
};

/** The lead fields every rule reasons over. Assembled by the service layer. */
export interface LeakageLeadInput {
  id: string;
  fullName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  estimatedValue: number | null;
  currency: string;
  status: LeadStatus;
  lostReason: string | null;

  capturedAt: Date;
  assignedAt: Date | null;
  assignedToId: string | null;
  assignedTo: { id: string; name: string | null; email: string } | null;

  firstContactAt: Date | null;
  firstReplyAt: Date | null;
  meetingBookedAt: Date | null;
  quotationSentAt: Date | null;
  lastFollowUpAt: Date | null;
  followUpCount: number;
  lastActivityAt: Date | null;
  closedAt: Date | null;

  stage: { id: string; key: string; name: string; type: LeadStageType } | null;
  /** Latest `STAGE_CHANGED` timestamp for this lead, or `capturedAt` if it never moved. */
  stageEnteredAt: Date;

  source: { id: string; key: string; name: string; channel: LeadChannel } | null;
}

export interface LeakHit {
  type: LeakType;
  leadId: string;
  /** Magnitude behind the flag — hours or days, per `LEAK_RULES[type].unit`. */
  magnitude: number;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

function hoursSince(from: Date, now: Date): number {
  return Math.max(0, (now.getTime() - from.getTime()) / MS_PER_HOUR);
}

function daysSince(from: Date, now: Date): number {
  return Math.max(0, (now.getTime() - from.getTime()) / MS_PER_DAY);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The more recent of the lead's last logged activity and a given floor. */
function activitySince(lead: LeakageLeadInput, floor: Date): Date {
  if (!lead.lastActivityAt) return floor;
  return lead.lastActivityAt > floor ? lead.lastActivityAt : floor;
}

// ---------------------------------------------------------------------------
// Per-lead rules
// ---------------------------------------------------------------------------

/** Assigned an owner, but nobody has reached out. */
export function detectAssignedNotContacted(
  lead: LeakageLeadInput,
  now: Date,
  thresholds: LeakageThresholds,
): LeakHit | null {
  if (lead.status !== Status.OPEN) return null;
  if (!lead.assignedAt || lead.firstContactAt) return null;

  const hours = hoursSince(lead.assignedAt, now);
  if (hours < thresholds.assignedTooLongHours) return null;

  return { type: 'assigned_not_contacted', leadId: lead.id, magnitude: round1(hours) };
}

/** First contact happened, but well after capture. Historical — any status. */
export function detectLateFirstContact(
  lead: LeakageLeadInput,
  _now: Date,
  thresholds: LeakageThresholds,
): LeakHit | null {
  if (!lead.firstContactAt) return null;

  const hours = hoursSince(lead.capturedAt, lead.firstContactAt);
  if (hours < thresholds.lateContactHours) return null;

  return { type: 'late_first_contact', leadId: lead.id, magnitude: round1(hours) };
}

/**
 * Contacted at least once, open, and nothing has happened since — not even
 * the reply that would have moved this to a different rule.
 */
export function detectNoFollowUpAfterContact(
  lead: LeakageLeadInput,
  now: Date,
  thresholds: LeakageThresholds,
): LeakHit | null {
  if (lead.status !== Status.OPEN) return null;
  if (!lead.firstContactAt) return null;

  const days = daysSince(activitySince(lead, lead.firstContactAt), now);
  if (days < thresholds.noFollowUpDays) return null;

  return { type: 'no_followup_after_contact', leadId: lead.id, magnitude: round1(days) };
}

/** Pricing went out and the trail goes cold — the highest-value leak. */
export function detectQuoteSentNoFollowUp(
  lead: LeakageLeadInput,
  now: Date,
  thresholds: LeakageThresholds,
): LeakHit | null {
  if (lead.status !== Status.OPEN) return null;
  if (!lead.quotationSentAt) return null;
  if (lead.lastActivityAt && lead.lastActivityAt > lead.quotationSentAt) return null;

  const days = daysSince(lead.quotationSentAt, now);
  if (days < thresholds.quoteStaleDays) return null;

  return { type: 'quote_sent_no_followup', leadId: lead.id, magnitude: round1(days) };
}

/** A meeting happened, no quotation followed, and nothing has since either. */
export function detectMeetingNoNextStep(
  lead: LeakageLeadInput,
  now: Date,
  thresholds: LeakageThresholds,
): LeakHit | null {
  if (lead.status !== Status.OPEN) return null;
  if (!lead.meetingBookedAt || lead.quotationSentAt) return null;
  if (lead.lastActivityAt && lead.lastActivityAt > lead.meetingBookedAt) return null;

  const days = daysSince(lead.meetingBookedAt, now);
  if (days < thresholds.meetingStaleDays) return null;

  return { type: 'meeting_no_next_step', leadId: lead.id, magnitude: round1(days) };
}

/**
 * A lead that was genuinely talking to us — it replied, and was followed up
 * at least once — and has now been silent. Distinct from
 * `detectNoFollowUpAfterContact`: that rule catches a lead that was only ever
 * contacted once and dropped; this one catches momentum that was lost.
 */
export function detectHotLeadGoneCold(
  lead: LeakageLeadInput,
  now: Date,
  thresholds: LeakageThresholds,
): LeakHit | null {
  if (lead.status !== Status.OPEN) return null;
  if (!lead.firstReplyAt || lead.followUpCount < 1) return null;
  if (!lead.lastActivityAt) return null;

  const days = daysSince(lead.lastActivityAt, now);
  if (days < thresholds.hotInactiveDays) return null;

  return { type: 'hot_lead_gone_cold', leadId: lead.id, magnitude: round1(days) };
}

/** Owned, open, and has not moved stage (or been created) in a long time. */
export function detectStuckWithSalesperson(
  lead: LeakageLeadInput,
  now: Date,
  thresholds: LeakageThresholds,
): LeakHit | null {
  if (lead.status !== Status.OPEN) return null;
  if (!lead.assignedToId) return null;

  const days = daysSince(lead.stageEnteredAt, now);
  if (days < thresholds.stuckInStageDays) return null;

  return { type: 'stuck_with_salesperson', leadId: lead.id, magnitude: round1(days) };
}

/** Closed lost with nothing recorded about why. */
export function detectLostWithoutReason(
  lead: LeakageLeadInput,
  now: Date,
  _thresholds: LeakageThresholds,
): LeakHit | null {
  if (lead.status !== Status.LOST) return null;
  if (lead.lostReason && lead.lostReason.trim().length > 0) return null;

  const days = lead.closedAt ? daysSince(lead.closedAt, now) : 0;
  return { type: 'lost_without_reason', leadId: lead.id, magnitude: round1(days) };
}

const DETECTORS: ((
  lead: LeakageLeadInput,
  now: Date,
  thresholds: LeakageThresholds,
) => LeakHit | null)[] = [
  detectAssignedNotContacted,
  detectLateFirstContact,
  detectNoFollowUpAfterContact,
  detectQuoteSentNoFollowUp,
  detectMeetingNoNextStep,
  detectHotLeadGoneCold,
  detectStuckWithSalesperson,
  detectLostWithoutReason,
];

/** Every rule this one lead trips, in `LEAK_RULES` order. */
export function evaluateLead(
  lead: LeakageLeadInput,
  now: Date,
  thresholds: LeakageThresholds,
): LeakHit[] {
  const hits: LeakHit[] = [];
  for (const detect of DETECTORS) {
    const hit = detect(lead, now, thresholds);
    if (hit) hits.push(hit);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Duplicate leads
// ---------------------------------------------------------------------------

export type DuplicateMatchField = 'email' | 'phone' | 'whatsapp';

export interface DuplicateGroup {
  matchField: DuplicateMatchField;
  value: string;
  leadIds: string[];
}

/**
 * Open leads sharing an identity.
 *
 * Capture already merges duplicates on the way in (see `findOpenDuplicate` in
 * `lead.repository.ts`) — this catches what got past it: manual entry,
 * imports, or a race between two simultaneous captures. Closed leads are
 * excluded, matching capture's own rule that a lead lost six months ago and
 * back again is a new opportunity, not a duplicate of the old one.
 */
export function detectDuplicateLeads(
  leads: Pick<LeakageLeadInput, 'id' | 'status' | 'email' | 'phone' | 'whatsapp'>[],
): DuplicateGroup[] {
  const open = leads.filter((lead) => lead.status === Status.OPEN);
  const groups: DuplicateGroup[] = [];

  const groupBy = (field: DuplicateMatchField): void => {
    const byValue = new Map<string, string[]>();
    for (const lead of open) {
      const raw = lead[field];
      if (!raw) continue;
      const value = raw.trim().toLowerCase();
      if (!value) continue;
      const ids = byValue.get(value) ?? [];
      ids.push(lead.id);
      byValue.set(value, ids);
    }
    for (const [value, leadIds] of byValue) {
      if (leadIds.length > 1) groups.push({ matchField: field, value, leadIds });
    }
  };

  groupBy('email');
  groupBy('phone');
  groupBy('whatsapp');

  return groups;
}

// ---------------------------------------------------------------------------
// Silent sources
// ---------------------------------------------------------------------------

export interface SilentSourceInput {
  id: string;
  key: string;
  name: string;
  channel: LeadChannel;
  isActive: boolean;
  lastCapturedAt: Date | null;
  totalCaptured: number;
}

export interface SilentSourceHit {
  sourceId: string;
  daysSinceLastCapture: number;
}

/**
 * An active source that has captured leads before, but not recently.
 *
 * This is the closest signal this API can compute for "ads coming through
 * but never reaching the CRM" or "leads disappearing between systems" —
 * both of those need visibility into an upstream system this service does
 * not have. A channel that has gone quiet is the symptom this data *can*
 * show, even without the cause.
 *
 * `totalCaptured > 0` excludes a source nobody has ever used, which is not a
 * leak — it is a source waiting to be turned on.
 */
export function detectSilentSources(
  sources: SilentSourceInput[],
  now: Date,
  thresholds: LeakageThresholds,
): SilentSourceHit[] {
  const hits: SilentSourceHit[] = [];

  for (const source of sources) {
    if (!source.isActive || source.totalCaptured === 0 || !source.lastCapturedAt) continue;

    const days = daysSince(source.lastCapturedAt, now);
    if (days < thresholds.silentSourceDays) continue;

    hits.push({ sourceId: source.id, daysSinceLastCapture: round1(days) });
  }

  return hits;
}
