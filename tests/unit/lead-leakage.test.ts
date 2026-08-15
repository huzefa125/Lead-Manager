import { LeadStageType, LeadStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAKAGE_THRESHOLDS,
  detectAssignedNotContacted,
  detectDuplicateLeads,
  detectHotLeadGoneCold,
  detectLateFirstContact,
  detectLostWithoutReason,
  detectMeetingNoNextStep,
  detectNoFollowUpAfterContact,
  detectQuoteSentNoFollowUp,
  detectSilentSources,
  detectStuckWithSalesperson,
  evaluateLead,
  type LeakageLeadInput,
  type SilentSourceInput,
} from '../../src/leads/lead-leakage';

/**
 * The leakage rule engine.
 *
 * Pure, like the journey engine in `lead.milestones.ts` — these are the rules
 * a sales manager will argue about first, so they are pinned by tests that
 * run in milliseconds rather than by a demo someone eyeballed once.
 */

const NOW = new Date('2026-08-15T12:00:00.000Z');
const CAPTURED_AT = new Date('2026-07-26T09:00:00.000Z'); // 20 days before NOW

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

function lead(overrides: Partial<LeakageLeadInput> = {}): LeakageLeadInput {
  return {
    id: 'lead-1',
    fullName: 'Ada Sharma',
    company: 'Sharma Textiles',
    email: 'ada@sharmatextiles.example.com',
    phone: '+91 98765 43210',
    whatsapp: null,
    estimatedValue: 100_000,
    currency: 'INR',
    status: LeadStatus.OPEN,
    lostReason: null,

    capturedAt: CAPTURED_AT,
    assignedAt: null,
    assignedToId: null,
    assignedTo: null,

    firstContactAt: null,
    firstReplyAt: null,
    meetingBookedAt: null,
    quotationSentAt: null,
    lastFollowUpAt: null,
    followUpCount: 0,
    lastActivityAt: null,
    closedAt: null,

    stage: { id: 'stage-1', key: 'new', name: 'New', type: LeadStageType.OPEN },
    stageEnteredAt: CAPTURED_AT,

    source: { id: 'source-1', key: 'google_ads', name: 'Google Ads', channel: 'GOOGLE_ADS' },

    ...overrides,
  };
}

const T = DEFAULT_LEAKAGE_THRESHOLDS;

describe('detectAssignedNotContacted', () => {
  it('flags a lead assigned longer ago than the threshold with no contact', () => {
    const hit = detectAssignedNotContacted(
      lead({ assignedAt: hoursAgo(T.assignedTooLongHours + 1) }),
      NOW,
      T,
    );
    expect(hit?.type).toBe('assigned_not_contacted');
    expect(hit?.leadId).toBe('lead-1');
  });

  it('does not flag before the threshold is reached', () => {
    const hit = detectAssignedNotContacted(
      lead({ assignedAt: hoursAgo(T.assignedTooLongHours - 1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag an unassigned lead', () => {
    expect(detectAssignedNotContacted(lead(), NOW, T)).toBeNull();
  });

  it('does not flag once contact has happened', () => {
    const hit = detectAssignedNotContacted(
      lead({ assignedAt: hoursAgo(T.assignedTooLongHours + 10), firstContactAt: hoursAgo(1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag a closed lead', () => {
    const hit = detectAssignedNotContacted(
      lead({ status: LeadStatus.WON, assignedAt: hoursAgo(T.assignedTooLongHours + 10) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });
});

describe('detectLateFirstContact', () => {
  it('flags first contact that came well after capture', () => {
    const hit = detectLateFirstContact(
      lead({ firstContactAt: new Date(CAPTURED_AT.getTime() + (T.lateContactHours + 1) * 60 * 60 * 1000) }),
      NOW,
      T,
    );
    expect(hit?.type).toBe('late_first_contact');
  });

  it('does not flag prompt contact', () => {
    const hit = detectLateFirstContact(
      lead({ firstContactAt: new Date(CAPTURED_AT.getTime() + 60 * 60 * 1000) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag a lead never contacted', () => {
    expect(detectLateFirstContact(lead(), NOW, T)).toBeNull();
  });

  it('still flags a lead that has since closed — a historical signal', () => {
    const hit = detectLateFirstContact(
      lead({
        status: LeadStatus.WON,
        firstContactAt: new Date(CAPTURED_AT.getTime() + (T.lateContactHours + 5) * 60 * 60 * 1000),
      }),
      NOW,
      T,
    );
    expect(hit?.type).toBe('late_first_contact');
  });
});

describe('detectNoFollowUpAfterContact', () => {
  it('flags a contacted lead with nothing logged since', () => {
    const hit = detectNoFollowUpAfterContact(
      lead({ firstContactAt: daysAgo(T.noFollowUpDays + 1) }),
      NOW,
      T,
    );
    expect(hit?.type).toBe('no_followup_after_contact');
  });

  it('does not flag when recent activity moved the clock forward', () => {
    const hit = detectNoFollowUpAfterContact(
      lead({ firstContactAt: daysAgo(T.noFollowUpDays + 5), lastActivityAt: daysAgo(1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag a lead never contacted', () => {
    expect(detectNoFollowUpAfterContact(lead(), NOW, T)).toBeNull();
  });

  it('does not flag a closed lead', () => {
    const hit = detectNoFollowUpAfterContact(
      lead({ status: LeadStatus.LOST, firstContactAt: daysAgo(T.noFollowUpDays + 5) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });
});

describe('detectQuoteSentNoFollowUp', () => {
  it('flags a stale quotation with nothing after it', () => {
    const hit = detectQuoteSentNoFollowUp(
      lead({ quotationSentAt: daysAgo(T.quoteStaleDays + 1) }),
      NOW,
      T,
    );
    expect(hit?.type).toBe('quote_sent_no_followup');
  });

  it('does not flag when a later activity moved the lead forward', () => {
    const hit = detectQuoteSentNoFollowUp(
      lead({ quotationSentAt: daysAgo(T.quoteStaleDays + 5), lastActivityAt: daysAgo(1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag before the threshold', () => {
    const hit = detectQuoteSentNoFollowUp(
      lead({ quotationSentAt: daysAgo(T.quoteStaleDays - 1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag a lead with no quotation', () => {
    expect(detectQuoteSentNoFollowUp(lead(), NOW, T)).toBeNull();
  });

  it('does not flag a won or lost lead', () => {
    const hit = detectQuoteSentNoFollowUp(
      lead({ status: LeadStatus.WON, quotationSentAt: daysAgo(T.quoteStaleDays + 5) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });
});

describe('detectMeetingNoNextStep', () => {
  it('flags a meeting with no quotation and nothing since', () => {
    const hit = detectMeetingNoNextStep(
      lead({ meetingBookedAt: daysAgo(T.meetingStaleDays + 1) }),
      NOW,
      T,
    );
    expect(hit?.type).toBe('meeting_no_next_step');
  });

  it('does not flag once a quotation was sent — that is progress, not a leak', () => {
    const hit = detectMeetingNoNextStep(
      lead({ meetingBookedAt: daysAgo(T.meetingStaleDays + 5), quotationSentAt: daysAgo(1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag when activity moved after the meeting', () => {
    const hit = detectMeetingNoNextStep(
      lead({ meetingBookedAt: daysAgo(T.meetingStaleDays + 5), lastActivityAt: daysAgo(1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag a lead with no meeting', () => {
    expect(detectMeetingNoNextStep(lead(), NOW, T)).toBeNull();
  });
});

describe('detectHotLeadGoneCold', () => {
  it('flags a lead that replied and was followed up, then went silent', () => {
    const hit = detectHotLeadGoneCold(
      lead({
        firstReplyAt: daysAgo(T.hotInactiveDays + 10),
        followUpCount: 2,
        lastActivityAt: daysAgo(T.hotInactiveDays + 1),
      }),
      NOW,
      T,
    );
    expect(hit?.type).toBe('hot_lead_gone_cold');
  });

  it('does not flag a lead that never replied — that is a different rule', () => {
    const hit = detectHotLeadGoneCold(
      lead({ followUpCount: 2, lastActivityAt: daysAgo(T.hotInactiveDays + 1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag a lead that replied but was never actively followed up', () => {
    const hit = detectHotLeadGoneCold(
      lead({ firstReplyAt: daysAgo(T.hotInactiveDays + 10), lastActivityAt: daysAgo(T.hotInactiveDays + 1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag while still within the inactivity window', () => {
    const hit = detectHotLeadGoneCold(
      lead({
        firstReplyAt: daysAgo(T.hotInactiveDays + 10),
        followUpCount: 1,
        lastActivityAt: daysAgo(T.hotInactiveDays - 1),
      }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });
});

describe('detectStuckWithSalesperson', () => {
  it('flags an owned lead that has sat in its stage past the threshold', () => {
    const hit = detectStuckWithSalesperson(
      lead({ assignedToId: 'user-1', stageEnteredAt: daysAgo(T.stuckInStageDays + 1) }),
      NOW,
      T,
    );
    expect(hit?.type).toBe('stuck_with_salesperson');
  });

  it('does not flag an unassigned lead', () => {
    const hit = detectStuckWithSalesperson(
      lead({ stageEnteredAt: daysAgo(T.stuckInStageDays + 10) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag a lead that moved stage recently', () => {
    const hit = detectStuckWithSalesperson(
      lead({ assignedToId: 'user-1', stageEnteredAt: daysAgo(1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag a closed lead', () => {
    const hit = detectStuckWithSalesperson(
      lead({ status: LeadStatus.WON, assignedToId: 'user-1', stageEnteredAt: daysAgo(T.stuckInStageDays + 10) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });
});

describe('detectLostWithoutReason', () => {
  it('flags a lost lead with an empty reason', () => {
    const hit = detectLostWithoutReason(
      lead({ status: LeadStatus.LOST, lostReason: null, closedAt: daysAgo(1) }),
      NOW,
      T,
    );
    expect(hit?.type).toBe('lost_without_reason');
  });

  it('flags a lost lead whose reason is only whitespace', () => {
    const hit = detectLostWithoutReason(
      lead({ status: LeadStatus.LOST, lostReason: '   ', closedAt: daysAgo(1) }),
      NOW,
      T,
    );
    expect(hit).not.toBeNull();
  });

  it('does not flag a lost lead with a real reason', () => {
    const hit = detectLostWithoutReason(
      lead({ status: LeadStatus.LOST, lostReason: 'Chose a competitor', closedAt: daysAgo(1) }),
      NOW,
      T,
    );
    expect(hit).toBeNull();
  });

  it('does not flag an open lead', () => {
    expect(detectLostWithoutReason(lead(), NOW, T)).toBeNull();
  });

  it('does not flag a won lead', () => {
    const hit = detectLostWithoutReason(lead({ status: LeadStatus.WON, closedAt: daysAgo(1) }), NOW, T);
    expect(hit).toBeNull();
  });
});

describe('evaluateLead', () => {
  it('reports every rule a lead trips at once', () => {
    const stuckAndUncontacted = lead({
      assignedToId: 'user-1',
      assignedAt: hoursAgo(T.assignedTooLongHours + 1),
      stageEnteredAt: daysAgo(T.stuckInStageDays + 1),
    });

    const hits = evaluateLead(stuckAndUncontacted, NOW, T).map((hit) => hit.type);
    expect(hits).toContain('assigned_not_contacted');
    expect(hits).toContain('stuck_with_salesperson');
  });

  it('reports nothing for a freshly captured, untouched lead', () => {
    expect(evaluateLead(lead({ capturedAt: daysAgo(1), stageEnteredAt: daysAgo(1) }), NOW, T)).toEqual([]);
  });
});

describe('detectDuplicateLeads', () => {
  const base = { status: LeadStatus.OPEN, email: null, phone: null, whatsapp: null };

  it('groups open leads sharing an email', () => {
    const groups = detectDuplicateLeads([
      { ...base, id: 'a', email: 'Ada@Example.com' },
      { ...base, id: 'b', email: 'ada@example.com' },
      { ...base, id: 'c', email: 'other@example.com' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.matchField).toBe('email');
    expect(groups[0]?.leadIds.sort()).toEqual(['a', 'b']);
  });

  it('groups by phone independently of email', () => {
    const groups = detectDuplicateLeads([
      { ...base, id: 'a', phone: '+911234567890' },
      { ...base, id: 'b', phone: '+911234567890' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.matchField).toBe('phone');
  });

  it('excludes closed leads — a lost lead returning is a new opportunity', () => {
    const groups = detectDuplicateLeads([
      { ...base, id: 'a', email: 'ada@example.com', status: LeadStatus.LOST },
      { ...base, id: 'b', email: 'ada@example.com' },
    ]);

    expect(groups).toHaveLength(0);
  });

  it('does not flag a lead sharing a value with itself only', () => {
    const groups = detectDuplicateLeads([{ ...base, id: 'a', email: 'ada@example.com' }]);
    expect(groups).toHaveLength(0);
  });

  it('ignores leads with no identity on that field', () => {
    const groups = detectDuplicateLeads([
      { ...base, id: 'a' },
      { ...base, id: 'b' },
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe('detectSilentSources', () => {
  function source(overrides: Partial<SilentSourceInput> = {}): SilentSourceInput {
    return {
      id: 'source-1',
      key: 'linkedin',
      name: 'LinkedIn',
      channel: 'LINKEDIN' as SilentSourceInput['channel'],
      isActive: true,
      lastCapturedAt: daysAgo(T.silentSourceDays + 1),
      totalCaptured: 40,
      ...overrides,
    };
  }

  it('flags an active source quiet past the threshold', () => {
    const hits = detectSilentSources([source()], NOW, T);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sourceId).toBe('source-1');
  });

  it('does not flag a source captured recently', () => {
    expect(detectSilentSources([source({ lastCapturedAt: daysAgo(1) })], NOW, T)).toHaveLength(0);
  });

  it('does not flag an inactive source — it was turned off on purpose', () => {
    expect(detectSilentSources([source({ isActive: false })], NOW, T)).toHaveLength(0);
  });

  it('does not flag a source that has never captured anything', () => {
    expect(
      detectSilentSources([source({ totalCaptured: 0, lastCapturedAt: null })], NOW, T),
    ).toHaveLength(0);
  });
});
