import { LeadActivityDirection, LeadActivityType, LeadStageType, LeadStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  applyMilestone,
  buildFunnel,
  findBiggestDropOff,
  milestonesForActivity,
  milestonesForAssignment,
  milestonesForStage,
  nextExpectedStep,
  type FunnelCounts,
  type LeadMilestones,
} from '../../src/leads/lead.milestones';

/**
 * The journey engine.
 *
 * Everything the funnel reports is derived from these functions, so a bug here
 * is a bug in every number the product shows. They are pure, which is what
 * makes it cheap to pin the rules that would otherwise only be arguable.
 */

const CAPTURED_AT = new Date('2026-06-01T09:00:00.000Z');

function lead(overrides: Partial<LeadMilestones> = {}): LeadMilestones {
  return {
    capturedAt: CAPTURED_AT,
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
    ...overrides,
  };
}

const at = (offsetHours: number): Date =>
  new Date(CAPTURED_AT.getTime() + offsetHours * 60 * 60 * 1000);

describe('applyMilestone', () => {
  it('records the milestone it is given', () => {
    const patch = applyMilestone(lead(), 'firstContactAt', at(3));
    expect(patch.firstContactAt).toEqual(at(3));
  });

  it('backfills every earlier milestone still unset', () => {
    // A lead that books a meeting off a Calendly link, with no logged call.
    const patch = applyMilestone(lead(), 'meetingBookedAt', at(10));

    expect(patch.firstContactAt).toEqual(at(10));
    expect(patch.firstReplyAt).toEqual(at(10));
    expect(patch.meetingBookedAt).toEqual(at(10));
    // Later steps are not invented.
    expect(patch.quotationSentAt).toBeUndefined();
  });

  it('is write-once — an existing milestone is never rewritten', () => {
    const existing = lead({ firstContactAt: at(1) });
    const patch = applyMilestone(existing, 'firstReplyAt', at(5));

    expect(patch.firstContactAt).toBeUndefined();
    expect(patch.firstReplyAt).toEqual(at(5));
  });

  it('clamps a milestone that predates capture', () => {
    // An import carrying activity timestamps from another CRM, or a skewed
    // clock. A lead contacted before it existed renders as a negative
    // response time.
    const patch = applyMilestone(lead(), 'firstContactAt', at(-48));
    expect(patch.firstContactAt).toEqual(CAPTURED_AT);
  });
});

describe('milestonesForActivity', () => {
  const signal = (type: LeadActivityType, direction: LeadActivityDirection, hours = 4) => ({
    type,
    direction,
    occurredAt: at(hours),
  });

  it('treats an outbound call as first contact, not a reply', () => {
    const patch = milestonesForActivity(
      signal(LeadActivityType.CALL, LeadActivityDirection.OUTBOUND),
      lead(),
    );

    expect(patch.firstContactAt).toEqual(at(4));
    expect(patch.firstReplyAt).toBeUndefined();
  });

  it('treats an inbound message as a reply, and backfills contact', () => {
    const patch = milestonesForActivity(
      signal(LeadActivityType.WHATSAPP, LeadActivityDirection.INBOUND),
      lead(),
    );

    expect(patch.firstReplyAt).toEqual(at(4));
    expect(patch.firstContactAt).toEqual(at(4));
  });

  it('does not count a note as contact', () => {
    // Writing a note to yourself never left the building.
    const patch = milestonesForActivity(
      signal(LeadActivityType.NOTE, LeadActivityDirection.INTERNAL),
      lead(),
    );

    expect(patch.firstContactAt).toBeUndefined();
    expect(patch.firstReplyAt).toBeUndefined();
    expect(patch.lastActivityAt).toEqual(at(4));
  });

  it('records a meeting and a quotation at their own steps', () => {
    expect(
      milestonesForActivity(signal(LeadActivityType.MEETING, LeadActivityDirection.OUTBOUND), lead())
        .meetingBookedAt,
    ).toEqual(at(4));

    expect(
      milestonesForActivity(
        signal(LeadActivityType.QUOTATION, LeadActivityDirection.OUTBOUND),
        lead(),
      ).quotationSentAt,
    ).toEqual(at(4));
  });

  it('advances follow-up recency and counts it, unlike the write-once fields', () => {
    const existing = lead({ firstContactAt: at(1), lastFollowUpAt: at(2), followUpCount: 2 });
    const patch = milestonesForActivity(
      signal(LeadActivityType.FOLLOW_UP, LeadActivityDirection.OUTBOUND, 9),
      existing,
    );

    expect(patch.lastFollowUpAt).toEqual(at(9));
    expect(patch.followUpCount).toBe(3);
    // Still write-once.
    expect(patch.firstContactAt).toBeUndefined();
  });

  it('never moves lastActivityAt backwards', () => {
    const existing = lead({ lastActivityAt: at(20) });
    const patch = milestonesForActivity(
      signal(LeadActivityType.CALL, LeadActivityDirection.OUTBOUND, 5),
      existing,
    );

    expect(patch.lastActivityAt).toEqual(at(20));
  });
});

describe('milestonesForStage', () => {
  it('closes a lead as won and proves the whole chain', () => {
    const patch = milestonesForStage('won', LeadStageType.WON, at(72), lead());

    expect(patch.status).toBe(LeadStatus.WON);
    expect(patch.closedAt).toEqual(at(72));
    // You do not close a deal you never quoted.
    expect(patch.quotationSentAt).toEqual(at(72));
    expect(patch.firstContactAt).toEqual(at(72));
  });

  it('closes a lead as lost without inventing progress', () => {
    // A lead can be lost at any depth — that is exactly what the funnel shows.
    const patch = milestonesForStage('lost', LeadStageType.LOST, at(30), lead());

    expect(patch.status).toBe(LeadStatus.LOST);
    expect(patch.closedAt).toEqual(at(30));
    expect(patch.firstContactAt).toBeUndefined();
    expect(patch.quotationSentAt).toBeUndefined();
  });

  it('reopens a closed lead and clears the close', () => {
    const closed = lead({ status: LeadStatus.WON, closedAt: at(50), quotationSentAt: at(40) });
    const patch = milestonesForStage('follow_up', LeadStageType.OPEN, at(60), closed);

    expect(patch.status).toBe(LeadStatus.OPEN);
    expect(patch.closedAt).toBeNull();
  });

  it('maps the default stage keys onto milestones', () => {
    expect(milestonesForStage('meeting', LeadStageType.OPEN, at(8), lead()).meetingBookedAt).toEqual(
      at(8),
    );
  });

  it('records no milestone for a stage the customer invented', () => {
    // A bespoke "Negotiation" column means something only the customer knows.
    const patch = milestonesForStage('negotiation', LeadStageType.OPEN, at(8), lead());

    expect(patch.firstContactAt).toBeUndefined();
    expect(patch.quotationSentAt).toBeUndefined();
    expect(patch.status).toBe(LeadStatus.OPEN);
  });

  it('does not move a lead backwards through the chain', () => {
    // Dragging a quoted deal back to "Contacted" must not erase the quotation —
    // that is the entire reason milestones exist separately from stage.
    const advanced = lead({ firstContactAt: at(2), firstReplyAt: at(4), quotationSentAt: at(20) });
    const patch = milestonesForStage('contacted', LeadStageType.OPEN, at(30), advanced);

    expect(patch.quotationSentAt).toBeUndefined();
    expect(patch.firstContactAt).toBeUndefined();
  });
});

describe('milestonesForAssignment', () => {
  it('records the first owner', () => {
    expect(milestonesForAssignment(lead(), at(1)).assignedAt).toEqual(at(1));
  });

  it('leaves an existing assignment alone, so it measures time-to-first-owner', () => {
    expect(milestonesForAssignment(lead({ assignedAt: at(1) }), at(9))).toEqual({});
  });
});

describe('buildFunnel', () => {
  /** The example this module was built to produce. */
  const REAL: FunnelCounts = {
    captured: 127,
    contacted: 89,
    replied: 54,
    meeting: 31,
    quotation: 18,
    won: 7,
  };

  it('reports each step with its loss from the previous one', () => {
    const steps = buildFunnel(REAL);

    expect(steps.map((step) => step.count)).toEqual([127, 89, 54, 31, 18, 7]);
    expect(steps.map((step) => step.droppedFromPrevious)).toEqual([0, 38, 35, 23, 13, 11]);
  });

  it('computes conversion from the start and from the previous step', () => {
    const steps = buildFunnel(REAL);
    const replied = steps[2];

    expect(replied?.conversionFromStart).toBeCloseTo(54 / 127, 4);
    expect(replied?.conversionFromPrevious).toBeCloseTo(54 / 89, 4);
  });

  it('clamps a step that exceeds its predecessor', () => {
    // Should be impossible given the backfill, but rows written before this
    // module existed would otherwise produce a negative drop-off.
    const steps = buildFunnel({ ...REAL, meeting: 200 });

    expect(steps[3]?.count).toBe(54);
    expect(steps[3]?.droppedFromPrevious).toBe(0);
  });

  it('survives an empty funnel without dividing by zero', () => {
    const steps = buildFunnel({ captured: 0, contacted: 0, replied: 0, meeting: 0, quotation: 0, won: 0 });

    expect(steps).toHaveLength(6);
    expect(steps.every((step) => step.count === 0 && step.conversionFromStart === 0)).toBe(true);
  });
});

describe('findBiggestDropOff', () => {
  it('names the step that loses the most leads', () => {
    const worst = findBiggestDropOff(
      buildFunnel({ captured: 127, contacted: 89, replied: 54, meeting: 31, quotation: 18, won: 7 }),
    );

    expect(worst?.fromKey).toBe('captured');
    expect(worst?.toKey).toBe('contacted');
    expect(worst?.dropped).toBe(38);
    expect(worst?.summary).toContain('38 of 127');
  });

  it('ranks by leads lost, not by rate', () => {
    // 100% of the 2 that reached quotation is a worse *rate* than 50 of 100 —
    // and completely unactionable next to it.
    const worst = findBiggestDropOff(
      buildFunnel({ captured: 100, contacted: 50, replied: 4, meeting: 2, quotation: 2, won: 0 }),
    );

    expect(worst?.toKey).toBe('contacted');
    expect(worst?.dropped).toBe(50);
  });

  it('returns null when nothing is lost anywhere', () => {
    expect(
      findBiggestDropOff(
        buildFunnel({ captured: 5, contacted: 5, replied: 5, meeting: 5, quotation: 5, won: 5 }),
      ),
    ).toBeNull();

    expect(
      findBiggestDropOff(
        buildFunnel({ captured: 0, contacted: 0, replied: 0, meeting: 0, quotation: 0, won: 0 }),
      ),
    ).toBeNull();
  });
});

describe('nextExpectedStep', () => {
  const open = {
    firstContactAt: null,
    firstReplyAt: null,
    meetingBookedAt: null,
    quotationSentAt: null,
    status: LeadStatus.OPEN,
  };

  it('names the first step the lead has not reached', () => {
    expect(nextExpectedStep(open)?.key).toBe('contacted');
    expect(nextExpectedStep({ ...open, firstContactAt: at(1) })?.key).toBe('replied');
    expect(nextExpectedStep({ ...open, firstContactAt: at(1), firstReplyAt: at(2) })?.key).toBe(
      'meeting',
    );
  });

  it('points at the close once every milestone is reached', () => {
    expect(
      nextExpectedStep({
        firstContactAt: at(1),
        firstReplyAt: at(2),
        meetingBookedAt: at(3),
        quotationSentAt: at(4),
        status: LeadStatus.OPEN,
      })?.key,
    ).toBe('won');
  });

  it('expects nothing further from a closed lead', () => {
    expect(nextExpectedStep({ ...open, status: LeadStatus.WON })).toBeNull();
    expect(nextExpectedStep({ ...open, status: LeadStatus.LOST })).toBeNull();
  });
});
