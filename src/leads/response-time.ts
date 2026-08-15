import type { LeadStatus } from '@prisma/client';
import { LeadStatus as Status } from '@prisma/client';

/**
 * Response time intelligence.
 *
 * Six gaps in a lead's journey, each measured in hours, plus one correlation:
 * does contacting a lead late actually cost the deal. Everything here is a
 * pure function over plain values — no Prisma, no I/O — for the same reason
 * `lead.milestones.ts` and `lead-leakage.ts` are: these are numbers a sales
 * manager will hold a rep accountable to, so the arithmetic needs to be
 * settled by a test, not eyeballed off a dashboard.
 */

export type ResponseMetricKey =
  | 'captured_to_assigned'
  | 'assigned_to_first_contact'
  | 'first_contact_to_reply'
  | 'reply_to_salesperson_response'
  | 'meeting_to_follow_up'
  | 'quote_to_follow_up';

export interface ResponseMetricDefinition {
  key: ResponseMetricKey;
  label: string;
  /**
   * Whether a gap belongs to a salesperson's own performance. `false` for
   * gaps a rep does not control — who gets assigned a lead is a routing
   * decision, and how fast a lead replies is the lead's behaviour, not the
   * rep's. Ranking "best"/"worst" salesperson on either would score people
   * for someone else's speed.
   */
  attributedToSalesperson: boolean;
}

export const RESPONSE_METRICS: Record<ResponseMetricKey, ResponseMetricDefinition> = {
  captured_to_assigned: {
    key: 'captured_to_assigned',
    label: 'Lead received → assigned',
    attributedToSalesperson: false,
  },
  assigned_to_first_contact: {
    key: 'assigned_to_first_contact',
    label: 'Assigned → first contact',
    attributedToSalesperson: true,
  },
  first_contact_to_reply: {
    key: 'first_contact_to_reply',
    label: 'First contact → reply',
    attributedToSalesperson: false,
  },
  reply_to_salesperson_response: {
    key: 'reply_to_salesperson_response',
    label: 'Reply → salesperson response',
    attributedToSalesperson: true,
  },
  meeting_to_follow_up: {
    key: 'meeting_to_follow_up',
    label: 'Meeting → follow-up',
    attributedToSalesperson: true,
  },
  quote_to_follow_up: {
    key: 'quote_to_follow_up',
    label: 'Quote → follow-up',
    attributedToSalesperson: true,
  },
};

/** Reported as "Average first response" in headlines — the classic speed-to-lead SLA. */
export const FIRST_RESPONSE_METRIC: ResponseMetricKey = 'assigned_to_first_contact';

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Hours between two instants, or `null` when the gap cannot be measured:
 * either end is missing, or `to` precedes `from`.
 *
 * A negative gap is not "fast" — it means the two timestamps do not describe
 * the sequence this metric assumes (contact logged before assignment was
 * recorded, say). Reporting it as zero would hide that; reporting it as
 * negative would be worse. Excluding it is the honest option.
 */
export function intervalHours(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  const hours = (to.getTime() - from.getTime()) / MS_PER_HOUR;
  return hours < 0 ? null : hours;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

/** "4h 17m" / "18m" / "11h 42m" — the way a sales team actually says it, not "4.283h". */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return wholeHours === 0 ? `${minutes}m` : `${wholeHours}h ${minutes}m`;
}

// ---------------------------------------------------------------------------
// Salesperson ranking
// ---------------------------------------------------------------------------

export interface SalespersonStat {
  userId: string;
  count: number;
  averageHours: number;
}

export interface SalespersonRanking {
  /** Every salesperson with at least one measured lead, fastest first. */
  all: SalespersonStat[];
  /** `null` unless someone has at least `minSampleSize` measured leads. */
  best: SalespersonStat | null;
  worst: SalespersonStat | null;
}

/**
 * Ranks salespeople by average response time, fastest first.
 *
 * `minSampleSize` keeps a rep with one lucky fast lead from being crowned
 * "best salesperson" — `all` still lists everyone, so the report is not
 * silently hiding low-volume reps, but the headline-worthy best/worst only
 * come from people with enough leads for the average to mean something.
 */
export function rankSalespeople(
  rows: { userId: string; hours: number }[],
  minSampleSize: number,
): SalespersonRanking {
  const byUser = new Map<string, number[]>();
  for (const row of rows) {
    const bucket = byUser.get(row.userId) ?? [];
    bucket.push(row.hours);
    byUser.set(row.userId, bucket);
  }

  const all: SalespersonStat[] = [...byUser.entries()]
    .map(([userId, hours]) => ({ userId, count: hours.length, averageHours: average(hours) as number }))
    .sort((a, b) => a.averageHours - b.averageHours);

  const eligible = all.filter((stat) => stat.count >= minSampleSize);

  return {
    all,
    best: eligible[0] ?? null,
    worst: eligible.length > 0 ? (eligible[eligible.length - 1] as SalespersonStat) : null,
  };
}

// ---------------------------------------------------------------------------
// Speed-to-loss correlation
// ---------------------------------------------------------------------------

export interface LossCorrelationInput {
  hoursToFirstContact: number;
  status: LeadStatus;
}

export interface ThresholdSplit {
  count: number;
  lostCount: number;
  /** `lostCount / count`, of leads that reached a decision — 0 when `count` is 0. */
  lossRate: number;
}

export interface LossBucket extends ThresholdSplit {
  label: string;
  minHours: number;
  maxHours: number | null;
}

export interface LossCorrelation {
  thresholdHours: number;
  withinThreshold: ThresholdSplit;
  afterThreshold: ThresholdSplit;
  byBucket: LossBucket[];
}

/** The curve a manager actually wants: does the loss rate climb as contact slows down. */
const BUCKET_BOUNDS: { label: string; minHours: number; maxHours: number | null }[] = [
  { label: '0–1h', minHours: 0, maxHours: 1 },
  { label: '1–2h', minHours: 1, maxHours: 2 },
  { label: '2–4h', minHours: 2, maxHours: 4 },
  { label: '4–8h', minHours: 4, maxHours: 8 },
  { label: '8–24h', minHours: 8, maxHours: 24 },
  { label: '24h+', minHours: 24, maxHours: null },
];

function split(rows: LossCorrelationInput[]): ThresholdSplit {
  const count = rows.length;
  const lostCount = rows.filter((row) => row.status === Status.LOST).length;
  return { count, lostCount, lossRate: count > 0 ? lostCount / count : 0 };
}

/**
 * Only leads that reached a decision (won or lost) carry a real answer to
 * "did contacting this lead late cost the deal" — an open lead has not lost
 * yet, and including it would understate the loss rate for every bucket it
 * fell into.
 */
export function computeLossCorrelation(
  rows: LossCorrelationInput[],
  thresholdHours: number,
): LossCorrelation {
  const decided = rows.filter((row) => row.status === Status.WON || row.status === Status.LOST);

  const withinThreshold = split(decided.filter((row) => row.hoursToFirstContact <= thresholdHours));
  const afterThreshold = split(decided.filter((row) => row.hoursToFirstContact > thresholdHours));

  const byBucket: LossBucket[] = BUCKET_BOUNDS.map((bucket) => ({
    ...bucket,
    ...split(
      decided.filter(
        (row) =>
          row.hoursToFirstContact >= bucket.minHours &&
          (bucket.maxHours === null || row.hoursToFirstContact < bucket.maxHours),
      ),
    ),
  }));

  return { thresholdHours, withinThreshold, afterThreshold, byBucket };
}
