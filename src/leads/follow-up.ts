import { LeadActivityDirection, type LeadStatus } from '@prisma/client';
import { LeadStatus as Status } from '@prisma/client';

/**
 * Follow-up failure detection.
 *
 * The specific state machine this module checks:
 *
 *   Lead replied → Salesperson replied → no response for N days → follow-up required
 *
 * That sequence matters. A lead that was called once and never replied is a
 * different, earlier failure — `no_followup_after_contact` in
 * `lead-leakage.ts` already covers it. This module is narrower and later in
 * the journey: a real back-and-forth was established, the salesperson made
 * the last move, and the trail has since gone cold. Pure and unit-tested for
 * the same reason every other rule engine in this module is.
 */

export interface FollowUpThresholds {
  /** Days of silence after the salesperson's last touch before a follow-up is due. */
  followUpAfterDays: number;
  /** Additional days overdue, past `followUpAfterDays`, before it is "critical". */
  criticalOverdueDays: number;
}

export const DEFAULT_FOLLOW_UP_THRESHOLDS: FollowUpThresholds = {
  followUpAfterDays: 3,
  criticalOverdueDays: 4, // 3 + 4 = a full week of silence
};

export type FollowUpUrgency = 'today' | 'overdue' | 'critical';

export interface ConversationTurn {
  direction: LeadActivityDirection;
  occurredAt: Date;
}

export interface FollowUpHit {
  leadId: string;
  urgency: FollowUpUrgency;
  /** When the salesperson's last touch was. */
  lastActivityAt: Date;
  /** `lastActivityAt` + `followUpAfterDays` — when this became due. */
  dueAt: Date;
  daysSinceLastActivity: number;
  /** How far past `dueAt` this is, in days. 0 on the day it first becomes due. */
  daysOverdue: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Checks one lead's conversation timeline against the follow-up state
 * machine. `timeline` must be conversation-type activities only
 * (`CONVERSATION_ACTIVITY_TYPES`), ordered oldest first — internal notes and
 * tasks are not "a response", and including them would let a salesperson's
 * private reminder count as chasing the lead.
 *
 * Returns `null` when no follow-up is owed: the lead is closed, there is no
 * timeline to judge, the *lead's* message is the most recent (the rep owes a
 * reply, which is a different problem — see `reply_to_salesperson_response`
 * in `response-time.ts`), the two sides never actually exchanged anything,
 * or the silence has not yet crossed the threshold.
 */
export function evaluateFollowUp(
  leadId: string,
  status: LeadStatus,
  timeline: ConversationTurn[],
  now: Date,
  thresholds: FollowUpThresholds,
): FollowUpHit | null {
  if (status !== Status.OPEN) return null;
  if (timeline.length === 0) return null;

  const last = timeline[timeline.length - 1] as ConversationTurn;
  // The salesperson must have made the last move — an unanswered inbound
  // message is a rep-response-time problem, not a "we forgot to chase" one.
  if (last.direction !== LeadActivityDirection.OUTBOUND) return null;

  const leadHasReplied = timeline.some((turn) => turn.direction === LeadActivityDirection.INBOUND);
  if (!leadHasReplied) return null;

  const daysSinceLastActivity = (now.getTime() - last.occurredAt.getTime()) / MS_PER_DAY;
  if (daysSinceLastActivity < thresholds.followUpAfterDays) return null;

  const daysOverdue = daysSinceLastActivity - thresholds.followUpAfterDays;
  const urgency: FollowUpUrgency =
    daysOverdue < 1 ? 'today' : daysOverdue < thresholds.criticalOverdueDays ? 'overdue' : 'critical';

  return {
    leadId,
    urgency,
    lastActivityAt: last.occurredAt,
    dueAt: addDays(last.occurredAt, thresholds.followUpAfterDays),
    daysSinceLastActivity: round1(daysSinceLastActivity),
    daysOverdue: round1(daysOverdue),
  };
}
