import { LeadActivityDirection, LeadStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOLLOW_UP_THRESHOLDS,
  evaluateFollowUp,
  type ConversationTurn,
} from '../../src/leads/follow-up';

/**
 * Follow-up failure detection.
 *
 * The state machine: lead replied → salesperson replied → silence for N days
 * → follow-up required. Pure, so the sequencing rules are pinned by a test
 * rather than argued about later.
 */

const NOW = new Date('2026-08-15T12:00:00.000Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const turn = (direction: LeadActivityDirection, days: number): ConversationTurn => ({
  direction,
  occurredAt: daysAgo(days),
});

const T = DEFAULT_FOLLOW_UP_THRESHOLDS;

describe('evaluateFollowUp', () => {
  it('flags a lead where the salesperson made the last move and it has gone quiet', () => {
    const timeline = [
      turn(LeadActivityDirection.OUTBOUND, 10), // first contact
      turn(LeadActivityDirection.INBOUND, 8), // lead replied
      turn(LeadActivityDirection.OUTBOUND, T.followUpAfterDays + 0.5), // salesperson replied, then silence
    ];

    const hit = evaluateFollowUp('lead-1', LeadStatus.OPEN, timeline, NOW, T);
    expect(hit?.leadId).toBe('lead-1');
    expect(hit?.urgency).toBe('today');
  });

  it('does not flag before the silence threshold is reached', () => {
    const timeline = [
      turn(LeadActivityDirection.INBOUND, 5),
      turn(LeadActivityDirection.OUTBOUND, T.followUpAfterDays - 0.5),
    ];

    expect(evaluateFollowUp('lead-1', LeadStatus.OPEN, timeline, NOW, T)).toBeNull();
  });

  it('does not flag when the lead never actually replied — a cold first touch', () => {
    // Only outbound activity ever — leakage's no_followup_after_contact covers this instead.
    const timeline = [turn(LeadActivityDirection.OUTBOUND, T.followUpAfterDays + 5)];
    expect(evaluateFollowUp('lead-1', LeadStatus.OPEN, timeline, NOW, T)).toBeNull();
  });

  it('does not flag when the lead\'s message is the most recent — that is a rep-response problem', () => {
    const timeline = [
      turn(LeadActivityDirection.OUTBOUND, 10),
      turn(LeadActivityDirection.INBOUND, T.followUpAfterDays + 5), // the rep owes a reply, not a follow-up
    ];

    expect(evaluateFollowUp('lead-1', LeadStatus.OPEN, timeline, NOW, T)).toBeNull();
  });

  it('does not flag a closed lead', () => {
    const timeline = [
      turn(LeadActivityDirection.INBOUND, 8),
      turn(LeadActivityDirection.OUTBOUND, T.followUpAfterDays + 5),
    ];

    expect(evaluateFollowUp('lead-1', LeadStatus.WON, timeline, NOW, T)).toBeNull();
    expect(evaluateFollowUp('lead-1', LeadStatus.LOST, timeline, NOW, T)).toBeNull();
  });

  it('does not flag a lead with no timeline at all', () => {
    expect(evaluateFollowUp('lead-1', LeadStatus.OPEN, [], NOW, T)).toBeNull();
  });

  describe('urgency tiers', () => {
    it('is "today" just as the threshold is crossed', () => {
      const timeline = [turn(LeadActivityDirection.INBOUND, 10), turn(LeadActivityDirection.OUTBOUND, T.followUpAfterDays)];
      expect(evaluateFollowUp('lead-1', LeadStatus.OPEN, timeline, NOW, T)?.urgency).toBe('today');
    });

    it('is "overdue" past one extra day, before the critical threshold', () => {
      const timeline = [
        turn(LeadActivityDirection.INBOUND, 10),
        turn(LeadActivityDirection.OUTBOUND, T.followUpAfterDays + 1.5),
      ];
      expect(evaluateFollowUp('lead-1', LeadStatus.OPEN, timeline, NOW, T)?.urgency).toBe('overdue');
    });

    it('is "critical" once criticalOverdueDays past the threshold', () => {
      const timeline = [
        turn(LeadActivityDirection.INBOUND, 10),
        turn(LeadActivityDirection.OUTBOUND, T.followUpAfterDays + T.criticalOverdueDays + 1),
      ];
      expect(evaluateFollowUp('lead-1', LeadStatus.OPEN, timeline, NOW, T)?.urgency).toBe('critical');
    });
  });

  it('computes dueAt as the salesperson\'s last touch plus the threshold', () => {
    const lastTouch = daysAgo(T.followUpAfterDays + 2);
    const timeline: ConversationTurn[] = [
      turn(LeadActivityDirection.INBOUND, 10),
      { direction: LeadActivityDirection.OUTBOUND, occurredAt: lastTouch },
    ];

    const hit = evaluateFollowUp('lead-1', LeadStatus.OPEN, timeline, NOW, T);
    expect(hit?.dueAt.getTime()).toBe(lastTouch.getTime() + T.followUpAfterDays * 24 * 60 * 60 * 1000);
  });

  it('respects custom thresholds', () => {
    const custom = { followUpAfterDays: 1, criticalOverdueDays: 1 };
    const timeline = [turn(LeadActivityDirection.INBOUND, 5), turn(LeadActivityDirection.OUTBOUND, 2.5)];

    const hit = evaluateFollowUp('lead-1', LeadStatus.OPEN, timeline, NOW, custom);
    expect(hit?.urgency).toBe('critical'); // 1.5 days overdue >= criticalOverdueDays of 1
  });
});
