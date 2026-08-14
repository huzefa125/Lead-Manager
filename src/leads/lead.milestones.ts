import { LeadActivityDirection, LeadActivityType, LeadStageType, LeadStatus } from '@prisma/client';

/**
 * The journey engine.
 *
 * Everything here is a pure function over plain values — no Prisma, no I/O —
 * because these rules are the part of the lead engine most likely to be argued
 * about, and an argument is only settled by a test that runs in milliseconds.
 *
 * ## Why milestones exist at all
 *
 * A lead's *stage* moves in both directions: a deal that reaches "Quotation
 * Sent" and goes quiet gets dragged back to "Follow-up". A funnel counted from
 * current stage therefore reports that the quotation was never sent, and the
 * numbers shrink every time a salesperson is honest about where a deal really
 * is.
 *
 * Milestones are the fix. Each is written **once**, the first time a lead
 * reaches that point, and never cleared. Stage answers "where is this lead
 * now"; milestones answer "how far did it ever get". Only the second question
 * produces a funnel.
 *
 * ## Why later milestones backfill earlier ones
 *
 * A lead can book a meeting straight off a Calendly link, with no logged call
 * first. Recording only `meetingBookedAt` would make meetings outnumber
 * contacts, and a funnel that goes *up* in the middle cannot be read — a
 * negative drop-off is not a number anyone can act on.
 *
 * So reaching a milestone implies every earlier one: a lead that booked a
 * meeting has, by definition, been contacted and has engaged. `applyMilestone`
 * backfills the gaps with the same timestamp, which makes the chain monotonic
 * by construction rather than by hoping the data behaves.
 */

/** The milestone fields a lead carries, and the ones this module reasons about. */
export interface LeadMilestones {
  capturedAt: Date;
  assignedAt: Date | null;
  firstContactAt: Date | null;
  firstReplyAt: Date | null;
  meetingBookedAt: Date | null;
  quotationSentAt: Date | null;
  lastFollowUpAt: Date | null;
  followUpCount: number;
  lastActivityAt: Date | null;
  closedAt: Date | null;
  status: LeadStatus;
}

export type MilestonePatch = Partial<Omit<LeadMilestones, 'capturedAt'>>;

/**
 * The write-once chain, earliest first.
 *
 * `assignedAt` is deliberately absent: assignment is an administrative act, not
 * a step of the conversation. A lead can be worked while unassigned and
 * assigned while untouched, so folding it into this chain would let a
 * bookkeeping change fabricate progress. It is reported separately — see
 * `buildFunnel`.
 */
export const MILESTONE_CHAIN = [
  'firstContactAt',
  'firstReplyAt',
  'meetingBookedAt',
  'quotationSentAt',
] as const;

export type MilestoneField = (typeof MILESTONE_CHAIN)[number];

/** Later of two instants, treating `null` as "no value yet". */
function latest(current: Date | null, candidate: Date): Date {
  return current && current > candidate ? current : candidate;
}

/**
 * Milestones may never predate capture.
 *
 * An imported lead can carry activity timestamps from the system it came from,
 * and a clock skewed by a few seconds is enough to produce a lead that was
 * contacted before it existed — which then renders as a negative response time.
 */
function clampToCapture(at: Date, capturedAt: Date): Date {
  return at < capturedAt ? capturedAt : at;
}

/**
 * Records that a lead reached `field` at `at`, filling any earlier milestone
 * still unset.
 *
 * Write-once: a field that already holds a value is left alone, so re-logging
 * an old call cannot rewrite when first contact happened.
 */
export function applyMilestone(
  current: LeadMilestones,
  field: MilestoneField,
  at: Date,
): MilestonePatch {
  const stamp = clampToCapture(at, current.capturedAt);
  const patch: MilestonePatch = {};
  const upTo = MILESTONE_CHAIN.indexOf(field);

  for (let index = 0; index <= upTo; index += 1) {
    const earlier = MILESTONE_CHAIN[index] as MilestoneField;
    if (current[earlier] === null) patch[earlier] = stamp;
  }

  return patch;
}

/** Merges patches left to right; later writes win. */
export function mergePatches(...patches: MilestonePatch[]): MilestonePatch {
  return Object.assign({}, ...patches) as MilestonePatch;
}

export interface ActivitySignal {
  type: LeadActivityType;
  direction: LeadActivityDirection;
  occurredAt: Date;
}

/**
 * Translates a logged activity into the milestones it proves.
 *
 * The `direction` field carries the whole weight of the distinction between
 * "we reached out" and "they answered". Without it those two are the same row
 * and the reply rate — the single most diagnostic number in the funnel —
 * cannot be computed at all.
 */
export function milestonesForActivity(
  signal: ActivitySignal,
  current: LeadMilestones,
): MilestonePatch {
  const stamp = clampToCapture(signal.occurredAt, current.capturedAt);
  const patch: MilestonePatch = { lastActivityAt: latest(current.lastActivityAt, stamp) };

  switch (signal.type) {
    case LeadActivityType.MEETING:
      return mergePatches(patch, applyMilestone(current, 'meetingBookedAt', stamp));

    case LeadActivityType.QUOTATION:
      return mergePatches(patch, applyMilestone(current, 'quotationSentAt', stamp));

    case LeadActivityType.FOLLOW_UP:
      // Unlike the others this one tracks recency, not first occurrence: the
      // question it answers is "when did we last chase", so it always advances.
      return mergePatches(patch, applyMilestone(current, 'firstContactAt', stamp), {
        lastFollowUpAt: latest(current.lastFollowUpAt, stamp),
        followUpCount: current.followUpCount + 1,
      });

    case LeadActivityType.CALL:
    case LeadActivityType.EMAIL:
    case LeadActivityType.WHATSAPP:
    case LeadActivityType.SMS:
      // An inbound message means the lead engaged, which backfills first
      // contact through the chain. That is generous to a lead who wrote in
      // before we ever called — but "they are talking to us" is what the
      // replied step is measuring, and the alternative is a funnel that
      // silently loses every self-starting prospect.
      return mergePatches(
        patch,
        signal.direction === LeadActivityDirection.INBOUND
          ? applyMilestone(current, 'firstReplyAt', stamp)
          : applyMilestone(current, 'firstContactAt', stamp),
      );

    // NOTE and TASK are internal bookkeeping. Counting a note to yourself as
    // contact would inflate the top of the funnel with work that never left
    // the building.
    default:
      return patch;
  }
}

/**
 * Translates a stage move into milestones.
 *
 * Stages are tenant-owned rows and may be renamed, so this matches on the
 * default keys only, plus the stage *type* — which is structural and always
 * present. A customer's bespoke "Negotiation" stage records no milestone,
 * which is correct: the system cannot know what it means.
 */
export function milestonesForStage(
  stageKey: string,
  stageType: LeadStageType,
  at: Date,
  current: LeadMilestones,
): MilestonePatch {
  const stamp = clampToCapture(at, current.capturedAt);

  if (stageType === LeadStageType.WON) {
    // Winning proves the whole chain: you do not close a deal you never
    // quoted, whatever the activity log happens to contain.
    return mergePatches(applyMilestone(current, 'quotationSentAt', stamp), {
      status: LeadStatus.WON,
      closedAt: current.closedAt ?? stamp,
      lastActivityAt: latest(current.lastActivityAt, stamp),
    });
  }

  if (stageType === LeadStageType.LOST) {
    // Losing proves nothing about how far the lead got — a lead can be lost at
    // any point, and that is exactly what the funnel is trying to show.
    return {
      status: LeadStatus.LOST,
      closedAt: current.closedAt ?? stamp,
      lastActivityAt: latest(current.lastActivityAt, stamp),
    };
  }

  const reopened: MilestonePatch = {
    status: LeadStatus.OPEN,
    // Moving a closed lead back into the pipeline clears the close, otherwise
    // it stays counted as won revenue forever.
    closedAt: null,
    lastActivityAt: latest(current.lastActivityAt, stamp),
  };

  const byKey: Partial<Record<string, MilestoneField>> = {
    contacted: 'firstContactAt',
    replied: 'firstReplyAt',
    meeting: 'meetingBookedAt',
    quotation: 'quotationSentAt',
  };

  const field = byKey[stageKey];
  return field ? mergePatches(reopened, applyMilestone(current, field, stamp)) : reopened;
}

/** Records assignment. Write-once, so it measures time-to-first-owner. */
export function milestonesForAssignment(current: LeadMilestones, at: Date): MilestonePatch {
  return current.assignedAt ? {} : { assignedAt: clampToCapture(at, current.capturedAt) };
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

/**
 * The measured funnel.
 *
 * These six steps are what the milestone chain can prove, in order. Assignment
 * is reported alongside rather than inside — see `MILESTONE_CHAIN`.
 */
export const FUNNEL_STEPS = [
  { key: 'captured', label: 'Leads received' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'replied', label: 'Replied' },
  { key: 'meeting', label: 'Meetings booked' },
  { key: 'quotation', label: 'Quotations sent' },
  { key: 'won', label: 'Closed won' },
] as const;

export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]['key'];

export type FunnelCounts = Record<FunnelStepKey, number>;

export interface FunnelStep {
  key: FunnelStepKey;
  label: string;
  count: number;
  /** Share of the leads that entered the funnel at all. */
  conversionFromStart: number;
  /** Share of the previous step that got this far. `1` for the first step. */
  conversionFromPrevious: number;
  /** How many were lost between the previous step and this one. */
  droppedFromPrevious: number;
  /** `droppedFromPrevious` as a share of the previous step. */
  dropOffRate: number;
}

/** Four decimal places — enough to be exact at any realistic volume. */
function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/**
 * Turns raw counts into the funnel, with the loss at each step.
 *
 * Counts are clamped so each step is at most its predecessor. The milestone
 * backfill above should make that a no-op; it is enforced here anyway, because
 * rows written before this module existed — or by a direct SQL fix at 2am —
 * would otherwise surface as a negative drop-off.
 */
export function buildFunnel(counts: FunnelCounts): FunnelStep[] {
  const start = Math.max(0, counts.captured);
  const steps: FunnelStep[] = [];
  let previous = start;

  for (const [index, definition] of FUNNEL_STEPS.entries()) {
    const raw = Math.max(0, counts[definition.key]);
    const count = index === 0 ? start : Math.min(raw, previous);
    const dropped = index === 0 ? 0 : previous - count;

    steps.push({
      key: definition.key,
      label: definition.label,
      count,
      conversionFromStart: ratio(count, start),
      conversionFromPrevious: index === 0 ? (start > 0 ? 1 : 0) : ratio(count, previous),
      droppedFromPrevious: dropped,
      dropOffRate: index === 0 ? 0 : ratio(dropped, previous),
    });

    previous = count;
  }

  return steps;
}

export interface FunnelBreak {
  fromKey: FunnelStepKey;
  fromLabel: string;
  toKey: FunnelStepKey;
  toLabel: string;
  dropped: number;
  dropOffRate: number;
  summary: string;
}

/**
 * Where the journey breaks.
 *
 * Ranked by the *number* of leads lost, not the rate. A 100% drop-off across
 * the two leads that reached quotation is real but not actionable; 38 leads
 * lost between contact and reply is where the work is. Ties go to the earlier
 * step, since fixing an early leak also feeds every step after it.
 *
 * Returns `null` when nothing was lost anywhere — including the empty case,
 * where inventing a break would be worse than saying nothing.
 */
export function findBiggestDropOff(steps: FunnelStep[]): FunnelBreak | null {
  let worst: { index: number; step: FunnelStep } | null = null;

  for (const [index, step] of steps.entries()) {
    if (index === 0 || step.droppedFromPrevious <= 0) continue;
    if (!worst || step.droppedFromPrevious > worst.step.droppedFromPrevious) {
      worst = { index, step };
    }
  }

  if (!worst) return null;

  const previous = steps[worst.index - 1] as FunnelStep;
  const { step } = worst;
  const percent = Math.round(step.dropOffRate * 1000) / 10;

  return {
    fromKey: previous.key,
    fromLabel: previous.label,
    toKey: step.key,
    toLabel: step.label,
    dropped: step.droppedFromPrevious,
    dropOffRate: step.dropOffRate,
    summary:
      `${step.droppedFromPrevious} of ${previous.count} leads (${percent}%) stop between ` +
      `"${previous.label}" and "${step.label}" — the largest loss in the journey.`,
  };
}

/**
 * The next thing that should happen to one lead.
 *
 * The per-lead counterpart of the funnel: it names the step this lead has not
 * reached, which is what a "stalled leads" view sorts by.
 */
export function nextExpectedStep(
  milestones: Pick<
    LeadMilestones,
    'firstContactAt' | 'firstReplyAt' | 'meetingBookedAt' | 'quotationSentAt' | 'status'
  >,
): { key: FunnelStepKey; label: string } | null {
  if (milestones.status !== LeadStatus.OPEN) return null;

  for (const [index, field] of MILESTONE_CHAIN.entries()) {
    if (milestones[field] === null) {
      const step = FUNNEL_STEPS[index + 1];
      return step ? { key: step.key, label: step.label } : null;
    }
  }

  const won = FUNNEL_STEPS[FUNNEL_STEPS.length - 1];
  return won ? { key: won.key, label: won.label } : null;
}
