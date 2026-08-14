import { LeadActivityDirection, LeadActivityType, LeadChannel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  analyticsQuerySchema,
  captureLeadSchema,
  changeStageSchema,
  createActivitySchema,
  createLeadSchema,
  createLeadSourceSchema,
  listLeadsQuerySchema,
  updateLeadSchema,
} from '../../src/leads/lead.validation';

/**
 * Capture accepts data from the open internet, so what these schemas *refuse*
 * matters more here than anywhere else in the API.
 */

describe('createLeadSchema', () => {
  it('accepts a lead reachable by email', () => {
    const parsed = createLeadSchema.parse({ email: 'Ada@Example.COM ', company: 'Acme' });

    expect(parsed.email).toBe('ada@example.com');
    expect(parsed.company).toBe('Acme');
  });

  it('rejects a lead nobody can be reached at', () => {
    // A row that will sit in the pipeline forever, be counted in every funnel,
    // and never convert.
    const result = createLeadSchema.safeParse({ firstName: 'Ada', company: 'Acme' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('at least one of email, phone or whatsapp');
  });

  it('accepts a lead reachable only by phone', () => {
    expect(createLeadSchema.safeParse({ phone: '+91 98765 43210' }).success).toBe(true);
  });

  it('keeps a phone number in whatever shape the source sent it', () => {
    expect(createLeadSchema.parse({ phone: '(022) 4567-8900' }).phone).toBe('(022) 4567-8900');
  });

  it('treats an emptied form field as absent', () => {
    // HTML forms post "" for every untouched input.
    const parsed = createLeadSchema.parse({ email: 'a@b.com', company: '   ', campaign: '' });

    expect(parsed.company).toBeUndefined();
    expect(parsed.campaign).toBeUndefined();
  });

  it('strips fields it does not declare', () => {
    const parsed = createLeadSchema.parse({
      email: 'a@b.com',
      status: 'WON',
      closedAt: '2020-01-01',
      firstReplyAt: '2020-01-01',
    } as Record<string, unknown>);

    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('closedAt');
    expect(parsed).not.toHaveProperty('firstReplyAt');
  });

  it('rejects a capture date in the future', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(createLeadSchema.safeParse({ email: 'a@b.com', capturedAt: tomorrow }).success).toBe(false);
  });

  it('rejects a negative or over-precise deal value', () => {
    expect(createLeadSchema.safeParse({ email: 'a@b.com', estimatedValue: -1 }).success).toBe(false);
    expect(createLeadSchema.safeParse({ email: 'a@b.com', estimatedValue: 10.999 }).success).toBe(false);
    expect(createLeadSchema.safeParse({ email: 'a@b.com', estimatedValue: 10.99 }).success).toBe(true);
  });

  it('normalises a currency code', () => {
    expect(createLeadSchema.parse({ email: 'a@b.com', currency: 'inr' }).currency).toBe('INR');
    expect(createLeadSchema.safeParse({ email: 'a@b.com', currency: 'RUPEE' }).success).toBe(false);
  });
});

describe('captureLeadSchema', () => {
  it('defaults an unnamed channel to OTHER rather than failing', () => {
    // A webhook that forgets the field still delivers the lead.
    expect(captureLeadSchema.parse({ email: 'a@b.com' }).channel).toBe(LeadChannel.OTHER);
  });

  it('cannot set a stage, an owner or a status', () => {
    // Every captured lead starts at the top of the pipeline — otherwise the
    // funnel's first number stops meaning "leads received".
    const parsed = captureLeadSchema.parse({
      email: 'a@b.com',
      channel: LeadChannel.WHATSAPP,
      stageId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      stageKey: 'won',
      assignedToId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      status: 'WON',
    } as Record<string, unknown>);

    expect(parsed).not.toHaveProperty('stageId');
    expect(parsed).not.toHaveProperty('stageKey');
    expect(parsed).not.toHaveProperty('assignedToId');
    expect(parsed).not.toHaveProperty('status');
  });

  it('carries UTM attribution through', () => {
    const parsed = captureLeadSchema.parse({
      email: 'a@b.com',
      channel: LeadChannel.GOOGLE_ADS,
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'diwali-2026',
      landingPage: 'https://acme.example.com/quote',
    });

    expect(parsed.utmCampaign).toBe('diwali-2026');
    expect(parsed.landingPage).toBe('https://acme.example.com/quote');
  });
});

describe('updateLeadSchema', () => {
  it('refuses an empty patch', () => {
    expect(updateLeadSchema.safeParse({}).success).toBe(false);
  });

  it('cannot move the pipeline', () => {
    // Stage, status and owner each have a dedicated endpoint that writes a
    // timeline entry. Allowing them here would move the pipeline with no record
    // of who moved it.
    const parsed = updateLeadSchema.parse({
      company: 'Acme',
      stageId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      status: 'WON',
      assignedToId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      firstContactAt: '2020-01-01',
    } as Record<string, unknown>);

    expect(parsed).toEqual({ company: 'Acme' });
  });

  it('allows clearing a nullable field', () => {
    expect(updateLeadSchema.parse({ notes: null }).notes).toBeNull();
  });
});

describe('createActivitySchema', () => {
  it('defaults direction to outbound', () => {
    // Someone logging a call almost always means one they made; defaulting to
    // INTERNAL would silently drop it out of the contacted count.
    expect(createActivitySchema.parse({ type: LeadActivityType.CALL }).direction).toBe(
      LeadActivityDirection.OUTBOUND,
    );
  });

  it.each([
    LeadActivityType.CREATED,
    LeadActivityType.ASSIGNED,
    LeadActivityType.STAGE_CHANGED,
    LeadActivityType.STATUS_CHANGED,
  ])('refuses to let a client forge a %s entry', (type) => {
    expect(createActivitySchema.safeParse({ type }).success).toBe(false);
  });

  it.each([
    LeadActivityType.CALL,
    LeadActivityType.EMAIL,
    LeadActivityType.WHATSAPP,
    LeadActivityType.MEETING,
    LeadActivityType.QUOTATION,
    LeadActivityType.FOLLOW_UP,
    LeadActivityType.NOTE,
  ])('accepts %s', (type) => {
    expect(createActivitySchema.safeParse({ type }).success).toBe(true);
  });

  it('rejects an activity logged in the future', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(
      createActivitySchema.safeParse({ type: LeadActivityType.CALL, occurredAt: tomorrow }).success,
    ).toBe(false);
  });
});

describe('changeStageSchema', () => {
  it('requires a target', () => {
    expect(changeStageSchema.safeParse({}).success).toBe(false);
    expect(changeStageSchema.safeParse({ stageKey: 'won' }).success).toBe(true);
  });
});

describe('listLeadsQuerySchema', () => {
  it('applies pagination defaults and caps the page size', () => {
    const parsed = listLeadsQuerySchema.parse({});

    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(listLeadsQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('parses a comma-separated status filter', () => {
    expect(listLeadsQuerySchema.parse({ status: 'WON,LOST' }).status).toEqual(['WON', 'LOST']);
  });

  it('rejects an unknown value inside a list filter', () => {
    // Silently dropping it would return a wider result set than asked for.
    expect(listLeadsQuerySchema.safeParse({ status: 'WON,MAYBE' }).success).toBe(false);
  });

  it('defaults to newest captured first', () => {
    const parsed = listLeadsQuerySchema.parse({});
    expect(parsed.sort).toBe('capturedAt');
    expect(parsed.order).toBe('desc');
  });
});

describe('analyticsQuerySchema', () => {
  it('returns a single funnel unless a grouping is asked for', () => {
    expect(analyticsQuerySchema.parse({}).groupBy).toBe('none');
    expect(analyticsQuerySchema.parse({ groupBy: 'source' }).groupBy).toBe('source');
    expect(analyticsQuerySchema.safeParse({ groupBy: 'astrology' }).success).toBe(false);
  });
});

describe('createLeadSourceSchema', () => {
  it('derives nothing from an invalid key', () => {
    expect(
      createLeadSourceSchema.safeParse({
        name: 'Google Ads Brand',
        channel: LeadChannel.GOOGLE_ADS,
        key: 'Google Ads',
      }).success,
    ).toBe(false);
  });

  it('accepts a lower_snake_case key', () => {
    expect(
      createLeadSourceSchema.safeParse({
        name: 'Google Ads Brand',
        channel: LeadChannel.GOOGLE_ADS,
        key: 'google_ads_brand',
      }).success,
    ).toBe(true);
  });

  it('requires a channel, since capture routes by it', () => {
    expect(createLeadSourceSchema.safeParse({ name: 'Trade Show' }).success).toBe(false);
  });
});
