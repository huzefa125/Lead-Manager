import { LeadStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  average,
  computeLossCorrelation,
  formatDuration,
  intervalHours,
  median,
  rankSalespeople,
} from '../../src/leads/response-time';

/**
 * Response time intelligence.
 *
 * These numbers get read out loud in a sales meeting as "you're the slowest
 * rep" — pinned by tests for the same reason the journey engine is.
 */

const T0 = new Date('2026-08-01T09:00:00.000Z');
const hoursAfter = (hours: number): Date => new Date(T0.getTime() + hours * 60 * 60 * 1000);

describe('intervalHours', () => {
  it('measures the gap in hours', () => {
    expect(intervalHours(T0, hoursAfter(4.5))).toBeCloseTo(4.5, 5);
  });

  it('returns null when either end is missing', () => {
    expect(intervalHours(null, hoursAfter(1))).toBeNull();
    expect(intervalHours(T0, null)).toBeNull();
  });

  it('returns null for a negative gap rather than reporting it as fast', () => {
    // Contact logged before assignment was recorded — not a real "response time".
    expect(intervalHours(hoursAfter(5), T0)).toBeNull();
  });

  it('treats a zero gap as measurable', () => {
    expect(intervalHours(T0, T0)).toBe(0);
  });
});

describe('average / median', () => {
  it('returns null for an empty set', () => {
    expect(average([])).toBeNull();
    expect(median([])).toBeNull();
  });

  it('computes the mean', () => {
    expect(average([1, 2, 3])).toBe(2);
  });

  it('computes the median for even and odd counts', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is not skewed by input order', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('formatDuration', () => {
  it('formats an example set matching how a sales team actually talks', () => {
    expect(formatDuration(4 + 17 / 60)).toBe('4h 17m');
    expect(formatDuration(18 / 60)).toBe('18m');
    expect(formatDuration(11 + 42 / 60)).toBe('11h 42m');
  });

  it('omits the hour when there is none', () => {
    expect(formatDuration(0.1)).toBe('6m');
  });

  it('rounds to the nearest minute', () => {
    expect(formatDuration(61 / 60)).toBe('1h 1m');
  });

  it('never goes negative', () => {
    expect(formatDuration(-1)).toBe('0m');
  });
});

describe('rankSalespeople', () => {
  it('ranks fastest first', () => {
    const ranking = rankSalespeople(
      [
        { userId: 'slow', hours: 10 },
        { userId: 'slow', hours: 10 },
        { userId: 'slow', hours: 10 },
        { userId: 'fast', hours: 1 },
        { userId: 'fast', hours: 1 },
        { userId: 'fast', hours: 1 },
      ],
      3,
    );

    expect(ranking.all.map((s) => s.userId)).toEqual(['fast', 'slow']);
    expect(ranking.best?.userId).toBe('fast');
    expect(ranking.worst?.userId).toBe('slow');
  });

  it('excludes a rep below the minimum sample size from best/worst', () => {
    const ranking = rankSalespeople(
      [
        { userId: 'lucky', hours: 0.1 }, // one suspiciously fast lead
        { userId: 'steady', hours: 2 },
        { userId: 'steady', hours: 2 },
        { userId: 'steady', hours: 2 },
      ],
      3,
    );

    // Still listed, just not crowned.
    expect(ranking.all.map((s) => s.userId)).toContain('lucky');
    expect(ranking.best?.userId).toBe('steady');
    expect(ranking.worst?.userId).toBe('steady');
  });

  it('returns null best/worst when nobody meets the sample size', () => {
    const ranking = rankSalespeople([{ userId: 'a', hours: 1 }], 3);
    expect(ranking.best).toBeNull();
    expect(ranking.worst).toBeNull();
    expect(ranking.all).toHaveLength(1);
  });

  it('handles an empty input', () => {
    const ranking = rankSalespeople([], 3);
    expect(ranking.all).toEqual([]);
    expect(ranking.best).toBeNull();
    expect(ranking.worst).toBeNull();
  });
});

describe('computeLossCorrelation', () => {
  const decided = (hoursToFirstContact: number, status: LeadStatus) => ({ hoursToFirstContact, status });

  it('splits leads at the threshold and reports loss rate on each side', () => {
    const rows = [
      decided(0.5, LeadStatus.WON),
      decided(1, LeadStatus.WON),
      decided(1.5, LeadStatus.LOST),
      decided(3, LeadStatus.LOST),
      decided(5, LeadStatus.LOST),
      decided(6, LeadStatus.WON),
    ];

    const result = computeLossCorrelation(rows, 2);

    expect(result.withinThreshold.count).toBe(3);
    expect(result.withinThreshold.lostCount).toBe(1);
    expect(result.afterThreshold.count).toBe(3);
    expect(result.afterThreshold.lostCount).toBe(2);
    expect(result.afterThreshold.lossRate).toBeCloseTo(2 / 3, 5);
  });

  it('excludes open leads — they have not lost yet', () => {
    const rows = [decided(1, LeadStatus.OPEN), decided(3, LeadStatus.LOST)];
    const result = computeLossCorrelation(rows, 2);

    expect(result.withinThreshold.count).toBe(0);
    expect(result.afterThreshold.count).toBe(1);
  });

  it('reports a zero rate rather than dividing by zero when a side is empty', () => {
    const result = computeLossCorrelation([decided(5, LeadStatus.LOST)], 2);
    expect(result.withinThreshold.count).toBe(0);
    expect(result.withinThreshold.lossRate).toBe(0);
  });

  it('produces a full bucket curve summing to the decided total', () => {
    const rows = [
      decided(0.5, LeadStatus.WON),
      decided(1.5, LeadStatus.LOST),
      decided(3, LeadStatus.LOST),
      decided(6, LeadStatus.LOST),
      decided(20, LeadStatus.WON),
      decided(40, LeadStatus.LOST),
    ];

    const result = computeLossCorrelation(rows, 2);
    const total = result.byBucket.reduce((sum, bucket) => sum + bucket.count, 0);

    expect(total).toBe(rows.length);
    expect(result.byBucket.map((bucket) => bucket.label)).toEqual([
      '0–1h', '1–2h', '2–4h', '4–8h', '8–24h', '24h+',
    ]);
    expect(result.byBucket[5]?.count).toBe(1); // the 40h lead
  });
});
