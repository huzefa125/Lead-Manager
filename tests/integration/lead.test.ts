import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { prisma } from '../../src/config/prisma';

/**
 * The lead engine, driven through real HTTP.
 *
 * Every test here runs against a source created for the test run, and every
 * funnel assertion is filtered to that source. The seed deliberately ships 127
 * demo leads in `acme`; without that filter these numbers would be assertions
 * about the seed rather than about the code.
 */

const SEEDED = {
  acmeAdmin: { email: 'admin@example.com', password: 'Admin123!' }, // acme, lead.*
  acmeManager: { email: 'manager@example.com', password: 'Manager123!' }, // acme, works leads
  acmeUser: { email: 'user@example.com', password: 'User1234!' }, // acme, read-only
  globexAdmin: { email: 'globex.admin@example.com', password: 'Globex123!' }, // other tenant
};

const TEST_SOURCE_KEY = 'ltest_source';

describe('lead engine', () => {
  let app: Express;
  const tokens = {} as Record<keyof typeof SEEDED, string>;
  let sourceId = '';
  let acmeManagerId = '';
  let globexAdminId = '';

  const login = async (creds: { email: string; password: string }): Promise<string> => {
    const response = await request(app).post('/api/auth/login').send(creds).expect(200);
    return response.body.data.accessToken;
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Removes every lead created against the test source, and the source itself. */
  async function cleanupLeads(): Promise<void> {
    if (!sourceId) return;
    await prisma.lead.deleteMany({ where: { sourceId } });
  }

  /** Captures a lead against the test source and returns the API payload. */
  const capture = async (
    body: Record<string, unknown>,
    token = tokens.acmeAdmin,
  ): Promise<{ id: string; [key: string]: unknown }> => {
    const response = await request(app)
      .post('/api/leads/capture')
      .set(auth(token))
      .send({ sourceKey: TEST_SOURCE_KEY, ...body });

    expect([200, 201]).toContain(response.status);
    return response.body.data.lead;
  };

  const logActivity = async (
    leadId: string,
    body: Record<string, unknown>,
  ): Promise<request.Response> =>
    request(app)
      .post(`/api/leads/${leadId}/activities`)
      .set(auth(tokens.acmeAdmin))
      .send(body)
      .expect(201);

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new Error(
        'No database reachable at DATABASE_URL. Run `npm run test:db:setup` first.\n' +
          `Underlying error: ${String(error)}`,
      );
    }

    app = createApp();

    for (const key of Object.keys(SEEDED) as (keyof typeof SEEDED)[]) {
      tokens[key] = await login(SEEDED[key]);
    }

    const acme = await prisma.organization.findUnique({ where: { slug: 'acme' } });
    if (!acme) throw new Error('Seed organization "acme" is missing. Run `npm run db:seed`.');

    const manager = await prisma.user.findUnique({ where: { email: SEEDED.acmeManager.email } });
    const globex = await prisma.user.findUnique({ where: { email: SEEDED.globexAdmin.email } });
    acmeManagerId = manager?.id ?? '';
    globexAdminId = globex?.id ?? '';

    // A source of our own, so funnel assertions are about these tests only.
    const existing = await prisma.leadSource.findUnique({
      where: { organizationId_key: { organizationId: acme.id, key: TEST_SOURCE_KEY } },
    });

    if (existing) {
      sourceId = existing.id;
      await prisma.lead.deleteMany({ where: { sourceId } });
    } else {
      const created = await request(app)
        .post('/api/lead-sources')
        .set(auth(tokens.acmeAdmin))
        .send({ name: 'Integration Test Source', channel: 'OTHER', key: TEST_SOURCE_KEY })
        .expect(201);
      sourceId = created.body.data.source.id;
    }
  });

  beforeEach(async () => {
    await cleanupLeads();
  });

  afterAll(async () => {
    await cleanupLeads();
    if (sourceId) await prisma.leadSource.deleteMany({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  // --- Capture ---------------------------------------------------------------

  describe('capture', () => {
    it('creates a lead at the top of the pipeline', async () => {
      const response = await request(app)
        .post('/api/leads/capture')
        .set(auth(tokens.acmeAdmin))
        .send({
          sourceKey: TEST_SOURCE_KEY,
          email: 'ada@ltest.example.com',
          company: 'Ltest Textiles',
          campaign: 'diwali-2026',
          utmSource: 'google',
          utmMedium: 'cpc',
          landingPage: 'https://acme.example.com/quote',
        })
        .expect(201);

      const { lead, outcome } = response.body.data;

      expect(outcome).toBe('created');
      expect(lead.stage.key).toBe('new');
      expect(lead.status).toBe('OPEN');
      expect(lead.assignedTo).toBeNull();
      expect(lead.campaign).toBe('diwali-2026');
      expect(lead.utm.source).toBe('google');
      // Nothing has happened to it yet.
      expect(lead.journey.firstContactAt).toBeNull();
      expect(lead.journey.nextStep.key).toBe('contacted');
    });

    it('refuses a lead nobody can be reached at', async () => {
      const response = await request(app)
        .post('/api/leads/capture')
        .set(auth(tokens.acmeAdmin))
        .send({ sourceKey: TEST_SOURCE_KEY, firstName: 'Ada', company: 'Ltest' })
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('is idempotent on externalId — a redelivered webhook adds nothing', async () => {
      const body = {
        sourceKey: TEST_SOURCE_KEY,
        email: 'dup@ltest.example.com',
        externalId: 'wh-4471',
      };

      const first = await request(app)
        .post('/api/leads/capture')
        .set(auth(tokens.acmeAdmin))
        .send(body)
        .expect(201);

      const second = await request(app)
        .post('/api/leads/capture')
        .set(auth(tokens.acmeAdmin))
        .send(body)
        .expect(200);

      expect(second.body.data.outcome).toBe('duplicate_external_id');
      expect(second.body.data.lead.id).toBe(first.body.data.lead.id);
      expect(await prisma.lead.count({ where: { sourceId } })).toBe(1);
    });

    it('folds a repeat enquiry into the open lead instead of duplicating the person', async () => {
      const first = await capture({ email: 'repeat@ltest.example.com', phone: '+919876500001' });

      const second = await request(app)
        .post('/api/leads/capture')
        .set(auth(tokens.acmeAdmin))
        .send({
          sourceKey: TEST_SOURCE_KEY,
          email: 'repeat@ltest.example.com',
          company: 'Filled In Later',
        })
        .expect(200);

      expect(second.body.data.outcome).toBe('merged_into_open_lead');
      expect(second.body.data.lead.id).toBe(first.id);
      // Blanks are filled...
      expect(second.body.data.lead.company).toBe('Filled In Later');
      expect(await prisma.lead.count({ where: { sourceId } })).toBe(1);
    });

    it('does not overwrite a known value with a later blank submission', async () => {
      const first = await capture({ email: 'keep@ltest.example.com', company: 'Typed By Hand' });

      await request(app)
        .post('/api/leads/capture')
        .set(auth(tokens.acmeAdmin))
        .send({ sourceKey: TEST_SOURCE_KEY, email: 'keep@ltest.example.com' })
        .expect(200);

      const after = await prisma.lead.findUnique({ where: { id: first.id } });
      expect(after?.company).toBe('Typed By Hand');
    });

    it('does not count a repeat enquiry as a reply', async () => {
      // Filling a form again is not a response to our outreach; counting it as
      // one would inflate the funnel's most load-bearing number.
      const first = await capture({ email: 'noreply@ltest.example.com' });

      await request(app)
        .post('/api/leads/capture')
        .set(auth(tokens.acmeAdmin))
        .send({ sourceKey: TEST_SOURCE_KEY, email: 'noreply@ltest.example.com' })
        .expect(200);

      const after = await prisma.lead.findUnique({ where: { id: first.id } });
      expect(after?.firstReplyAt).toBeNull();
      expect(after?.firstContactAt).toBeNull();
    });

    it('ignores a stage, owner or status supplied by the caller', async () => {
      const lead = await capture({
        email: 'mass@ltest.example.com',
        stageKey: 'won',
        status: 'WON',
        assignedToId: acmeManagerId,
        firstReplyAt: '2020-01-01T00:00:00.000Z',
      });

      expect(lead.stage).toMatchObject({ key: 'new' });
      expect(lead.status).toBe('OPEN');
      expect(lead.assignedTo).toBeNull();
      expect((lead.journey as Record<string, unknown>).firstReplyAt).toBeNull();
    });
  });

  // --- The journey -----------------------------------------------------------

  describe('journey tracking', () => {
    it('walks a lead from captured to won, recording each milestone', async () => {
      const lead = await capture({ email: 'journey@ltest.example.com' });

      const outbound = await logActivity(lead.id, {
        type: 'CALL',
        direction: 'OUTBOUND',
        subject: 'Intro call',
      });
      expect(outbound.body.data.lead.journey.firstContactAt).not.toBeNull();
      expect(outbound.body.data.lead.journey.firstReplyAt).toBeNull();
      expect(outbound.body.data.advanced).toContain('firstContactAt');

      const inbound = await logActivity(lead.id, { type: 'EMAIL', direction: 'INBOUND' });
      expect(inbound.body.data.lead.journey.firstReplyAt).not.toBeNull();

      const meeting = await logActivity(lead.id, { type: 'MEETING', direction: 'OUTBOUND' });
      expect(meeting.body.data.lead.journey.meetingBookedAt).not.toBeNull();

      const quotation = await logActivity(lead.id, { type: 'QUOTATION', direction: 'OUTBOUND' });
      expect(quotation.body.data.lead.journey.quotationSentAt).not.toBeNull();

      const won = await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'won' })
        .expect(200);

      expect(won.body.data.lead.status).toBe('WON');
      expect(won.body.data.lead.journey.closedAt).not.toBeNull();
      expect(won.body.data.lead.journey.nextStep).toBeNull();
    });

    it('backfills earlier milestones when a lead skips ahead', async () => {
      // Booked straight off a Calendly link, with no logged call first.
      const lead = await capture({ email: 'skip@ltest.example.com' });
      const response = await logActivity(lead.id, { type: 'MEETING', direction: 'INBOUND' });

      const { journey } = response.body.data.lead;
      expect(journey.firstContactAt).not.toBeNull();
      expect(journey.firstReplyAt).not.toBeNull();
      expect(journey.meetingBookedAt).not.toBeNull();
    });

    it('keeps milestones when a lead is dragged back down the pipeline', async () => {
      // The reason milestones exist separately from the current stage.
      const lead = await capture({ email: 'back@ltest.example.com' });
      await logActivity(lead.id, { type: 'QUOTATION', direction: 'OUTBOUND' });

      const moved = await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'follow_up' })
        .expect(200);

      expect(moved.body.data.lead.stage.key).toBe('follow_up');
      expect(moved.body.data.lead.journey.quotationSentAt).not.toBeNull();
    });

    it('does not treat a note as contact', async () => {
      const lead = await capture({ email: 'note@ltest.example.com' });
      const response = await logActivity(lead.id, { type: 'NOTE', direction: 'INTERNAL', body: 'Called, no answer' });

      expect(response.body.data.lead.journey.firstContactAt).toBeNull();
      expect(response.body.data.lead.lastActivityAt).not.toBeNull();
    });

    it('requires a reason before a lead can be marked lost', async () => {
      const lead = await capture({ email: 'lost@ltest.example.com' });

      const refused = await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'lost' })
        .expect(422);

      expect(refused.body.error.details[0].field).toBe('lostReason');

      const accepted = await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'lost', lostReason: 'Chose a competitor' })
        .expect(200);

      expect(accepted.body.data.lead.status).toBe('LOST');
      expect(accepted.body.data.lead.lostReason).toBe('Chose a competitor');
    });

    it('clears the lost reason when a lead is reopened', async () => {
      const lead = await capture({ email: 'reopen@ltest.example.com' });

      await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'lost', lostReason: 'Budget' })
        .expect(200);

      const reopened = await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'follow_up' })
        .expect(200);

      expect(reopened.body.data.lead.status).toBe('OPEN');
      expect(reopened.body.data.lead.lostReason).toBeNull();
      expect(reopened.body.data.lead.journey.closedAt).toBeNull();
    });
  });

  // --- Timeline --------------------------------------------------------------

  describe('timeline', () => {
    it('records creation, assignment, stage moves and logged work in one feed', async () => {
      const lead = await capture({ email: 'timeline@ltest.example.com' });

      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND', subject: 'Intro call' });

      await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'contacted' })
        .expect(200);

      const response = await request(app)
        .get(`/api/leads/${lead.id}/timeline`)
        .set(auth(tokens.acmeAdmin))
        .query({ order: 'asc' })
        .expect(200);

      const types = response.body.data.activities.map((entry: { type: string }) => entry.type);
      expect(types).toContain('CREATED');
      expect(types).toContain('ASSIGNED');
      expect(types).toContain('CALL');
      expect(types).toContain('STAGE_CHANGED');
    });

    it('can hide system entries, leaving only human-logged work', async () => {
      const lead = await capture({ email: 'human@ltest.example.com' });
      await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' });

      const response = await request(app)
        .get(`/api/leads/${lead.id}/timeline`)
        .set(auth(tokens.acmeAdmin))
        .query({ excludeSystem: 'true' })
        .expect(200);

      expect(response.body.data.activities).toHaveLength(1);
      expect(response.body.data.activities[0].type).toBe('CALL');
      expect(response.body.data.activities[0].isSystem).toBe(false);
    });

    it('records the before and after of a stage move', async () => {
      const lead = await capture({ email: 'moved@ltest.example.com' });

      await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'contacted', note: 'Spoke on WhatsApp' })
        .expect(200);

      const response = await request(app)
        .get(`/api/leads/${lead.id}/timeline`)
        .set(auth(tokens.acmeAdmin))
        .query({ type: 'STAGE_CHANGED' })
        .expect(200);

      const entry = response.body.data.activities[0];
      expect(entry.metadata.fromStageName).toBe('New');
      expect(entry.metadata.toStageName).toBe('Contacted');
      expect(entry.body).toBe('Spoke on WhatsApp');
    });
  });

  // --- Assignment ------------------------------------------------------------

  describe('assignment', () => {
    it('assigns a lead and stamps the first-owner milestone', async () => {
      const lead = await capture({ email: 'assign@ltest.example.com' });

      const response = await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      expect(response.body.data.lead.assignedTo.id).toBe(acmeManagerId);
      expect(response.body.data.lead.journey.assignedAt).not.toBeNull();
    });

    it('refuses an assignee from another tenant', async () => {
      // Both a leak — it would confirm the account exists — and a lead handed
      // to someone who could never see it.
      const lead = await capture({ email: 'crosstenant@ltest.example.com' });

      const response = await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: globexAdminId })
        .expect(422);

      expect(response.body.error.details[0].field).toBe('assignedToId');
    });

    it('keeps assignedAt when a lead is unassigned', async () => {
      const lead = await capture({ email: 'unassign@ltest.example.com' });

      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      const response = await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: null })
        .expect(200);

      expect(response.body.data.lead.assignedTo).toBeNull();
      // The lead did once have an owner; resetting the clock would be a lie.
      expect(response.body.data.lead.journey.assignedAt).not.toBeNull();
    });
  });

  // --- Funnel ----------------------------------------------------------------

  describe('funnel', () => {
    it('counts each step and names where the journey breaks', async () => {
      // Six captured, five contacted, one replied — so the loss is decisively
      // between contact and reply, not at the top.
      const leads = [];
      for (let index = 0; index < 6; index += 1) {
        leads.push(await capture({ email: `funnel${index}@ltest.example.com` }));
      }

      for (const lead of leads.slice(0, 5)) {
        await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' });
      }
      await logActivity(leads[0]!.id, { type: 'EMAIL', direction: 'INBOUND' });

      const response = await request(app)
        .get('/api/leads/funnel')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId })
        .expect(200);

      const counts = Object.fromEntries(
        response.body.data.funnel.map((step: { key: string; count: number }) => [step.key, step.count]),
      );

      expect(counts).toMatchObject({ captured: 6, contacted: 5, replied: 1, meeting: 0, won: 0 });

      expect(response.body.data.break).toMatchObject({
        fromKey: 'contacted',
        toKey: 'replied',
        dropped: 4,
      });
      expect(response.body.data.break.summary).toContain('4 of 5');
    });

    it('reports unassigned leads, which the funnel steps do not show', async () => {
      await capture({ email: 'noowner1@ltest.example.com' });
      const owned = await capture({ email: 'noowner2@ltest.example.com' });

      await request(app)
        .put(`/api/leads/${owned.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      const response = await request(app)
        .get('/api/leads/funnel')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId })
        .expect(200);

      expect(response.body.data.totals).toMatchObject({ captured: 2, assigned: 1, unassigned: 1 });
    });

    it('reports no break when nothing has been lost', async () => {
      await capture({ email: 'nobreak@ltest.example.com' });
      const response = await request(app)
        .get('/api/leads/funnel')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, capturedFrom: new Date(Date.now() + 60_000).toISOString() })
        .expect(200);

      expect(response.body.data.totals.captured).toBe(0);
      expect(response.body.data.break).toBeNull();
    });

    it('splits the funnel by owner when asked', async () => {
      const lead = await capture({ email: 'grouped@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      const response = await request(app)
        .get('/api/leads/funnel')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, groupBy: 'owner' })
        .expect(200);

      expect(response.body.data.groups).toHaveLength(1);
      expect(response.body.data.groups[0].totals.captured).toBe(1);
    });
  });

  // --- Leakage -----------------------------------------------------------

  describe('leakage', () => {
    /**
     * Every threshold is overridable, so instead of backdating fixtures these
     * tests set the relevant threshold to a hair above zero — a state created
     * a moment ago has already "aged past" a threshold measured in
     * thousandths of a day or hour. Real wall-clock time, no fixture skew.
     */
    const leakageQuery = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      sourceId,
      ...extra,
    });

    const findGroup = (
      response: request.Response,
      type: string,
    ): { count: number; atRiskValue: number; leads: { lead: { id: string } }[] } =>
      response.body.data.leaks.find((group: { type: string }) => group.type === type);

    it('flags a lead assigned but never contacted', async () => {
      const lead = await capture({ email: 'noreach@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery({ assignedTooLongHours: 0.0000001 }))
        .expect(200);

      const group = findGroup(response, 'assigned_not_contacted');
      expect(group.leads.map((entry) => entry.lead.id)).toContain(lead.id);
    });

    it('flags a contacted lead with nothing logged since', async () => {
      const lead = await capture({ email: 'silent@ltest.example.com' });
      await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery({ noFollowUpDays: 0.0000001 }))
        .expect(200);

      const group = findGroup(response, 'no_followup_after_contact');
      expect(group.leads.map((entry) => entry.lead.id)).toContain(lead.id);
    });

    it('flags a quotation with no follow-up', async () => {
      const lead = await capture({ email: 'quote@ltest.example.com' });
      await logActivity(lead.id, { type: 'QUOTATION', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery({ quoteStaleDays: 0.0000001 }))
        .expect(200);

      const group = findGroup(response, 'quote_sent_no_followup');
      expect(group.leads.map((entry) => entry.lead.id)).toContain(lead.id);
    });

    it('flags a meeting with no next step', async () => {
      const lead = await capture({ email: 'meeting@ltest.example.com' });
      await logActivity(lead.id, { type: 'MEETING', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery({ meetingStaleDays: 0.0000001 }))
        .expect(200);

      const group = findGroup(response, 'meeting_no_next_step');
      expect(group.leads.map((entry) => entry.lead.id)).toContain(lead.id);
    });

    it('flags a hot lead — replied and followed up — gone quiet', async () => {
      const lead = await capture({ email: 'hot@ltest.example.com' });
      await logActivity(lead.id, { type: 'CALL', direction: 'INBOUND' });
      await logActivity(lead.id, { type: 'FOLLOW_UP', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery({ hotInactiveDays: 0.0000001 }))
        .expect(200);

      const group = findGroup(response, 'hot_lead_gone_cold');
      expect(group.leads.map((entry) => entry.lead.id)).toContain(lead.id);
    });

    it('flags a lead stuck with its salesperson', async () => {
      const lead = await capture({ email: 'stuck@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery({ stuckInStageDays: 0.0000001 }))
        .expect(200);

      const group = findGroup(response, 'stuck_with_salesperson');
      expect(group.leads.map((entry) => entry.lead.id)).toContain(lead.id);
    });

    it('flags first contact that came long after capture, but not as live risk', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const lead = await capture({ email: 'latecontact@ltest.example.com', capturedAt: twoDaysAgo });
      await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery({ lateContactHours: 1 }))
        .expect(200);

      const group = findGroup(response, 'late_first_contact');
      expect(group.leads.map((entry) => entry.lead.id)).toContain(lead.id);
      // Historical response-time signal, not live pipeline value.
      expect(group.atRiskValue).toBe(0);
    });

    it('does not flag a lost lead that recorded a reason', async () => {
      const lead = await capture({ email: 'lostwithreason@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'lost', lostReason: 'Budget' })
        .expect(200);

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery())
        .expect(200);

      const group = findGroup(response, 'lost_without_reason');
      expect(group.leads.map((entry) => entry.lead.id)).not.toContain(lead.id);
    });

    it('flags duplicate open leads created outside the capture endpoint', async () => {
      // `POST /leads` — unlike `/leads/capture` — does not merge on identity,
      // which is exactly the gap this rule exists to catch.
      const phone = '+91 90011 22334';
      const first = await request(app)
        .post('/api/leads')
        .set(auth(tokens.acmeAdmin))
        .send({ sourceKey: TEST_SOURCE_KEY, phone, firstName: 'Ravi' })
        .expect(201);
      const second = await request(app)
        .post('/api/leads')
        .set(auth(tokens.acmeAdmin))
        .send({ sourceKey: TEST_SOURCE_KEY, phone, firstName: 'Ravi K' })
        .expect(201);

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery())
        .expect(200);

      const ids = response.body.data.duplicates.flatMap(
        (group: { leads: { id: string }[] }) => group.leads.map((lead) => lead.id),
      );
      expect(ids).toContain(first.body.data.lead.id);
      expect(ids).toContain(second.body.data.lead.id);
    });

    it('flags a source that has gone silent', async () => {
      await capture({ email: 'silentsource@ltest.example.com' });

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, silentSourceDays: 0.0000001 })
        .expect(200);

      const flagged = response.body.data.silentSources.map(
        (entry: { source: { key: string } }) => entry.source.key,
      );
      expect(flagged).toContain(TEST_SOURCE_KEY);
    });

    it('rolls at-risk leads and value into the summary and headlines', async () => {
      await capture({ email: 'summary@ltest.example.com', estimatedValue: 50000 }).then((lead) =>
        logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' }),
      );

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.acmeAdmin))
        .query(leakageQuery({ noFollowUpDays: 0.0000001 }))
        .expect(200);

      expect(response.body.data.summary.totalOpenLeadsAtRisk).toBeGreaterThanOrEqual(1);
      expect(response.body.data.summary.totalAtRiskValue).toBeGreaterThanOrEqual(50000);
      expect(response.body.data.headlines.length).toBeGreaterThan(0);
      // Named honestly rather than silently omitted.
      expect(response.body.data.outOfScope.length).toBeGreaterThan(0);
    });
  });

  // --- Response times ----------------------------------------------------

  describe('response time intelligence', () => {
    const findMetric = (
      response: request.Response,
      key: string,
    ): {
      count: number;
      averageHours: number | null;
      bySalesperson?: { id: string; count: number; averageHours: number }[];
      best?: { id: string } | null;
      worst?: { id: string } | null;
    } => response.body.data.metrics.find((metric: { key: string }) => metric.key === key);

    it('measures lead received → assigned, with no salesperson ranking', async () => {
      const lead = await capture({ email: 'rt-assign@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      const response = await request(app)
        .get('/api/leads/response-times')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId })
        .expect(200);

      const metric = findMetric(response, 'captured_to_assigned');
      expect(metric.count).toBeGreaterThanOrEqual(1);
      expect(metric.averageHours).not.toBeNull();
      expect(metric.bySalesperson).toBeUndefined();
    });

    it('measures assigned → first contact and ranks the salesperson', async () => {
      const lead = await capture({ email: 'rt-contact@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);
      await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/response-times')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, minSampleSize: 1 })
        .expect(200);

      const metric = findMetric(response, 'assigned_to_first_contact');
      expect(metric.count).toBeGreaterThanOrEqual(1);
      expect(metric.bySalesperson?.some((entry) => entry.id === acmeManagerId)).toBe(true);
      expect(metric.best?.id).toBe(acmeManagerId);
    });

    it('measures first contact → reply', async () => {
      const lead = await capture({ email: 'rt-reply@ltest.example.com' });
      await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' });
      await logActivity(lead.id, { type: 'EMAIL', direction: 'INBOUND' });

      const response = await request(app)
        .get('/api/leads/response-times')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId })
        .expect(200);

      expect(findMetric(response, 'first_contact_to_reply').count).toBeGreaterThanOrEqual(1);
    });

    it('measures reply → salesperson response', async () => {
      const lead = await capture({ email: 'rt-turnaround@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);
      await logActivity(lead.id, { type: 'CALL', direction: 'INBOUND' });
      await logActivity(lead.id, { type: 'EMAIL', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/response-times')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, minSampleSize: 1 })
        .expect(200);

      const metric = findMetric(response, 'reply_to_salesperson_response');
      expect(metric.count).toBeGreaterThanOrEqual(1);
      expect(metric.bySalesperson?.some((entry) => entry.id === acmeManagerId)).toBe(true);
    });

    it('measures meeting → follow-up and quote → follow-up', async () => {
      const lead = await capture({ email: 'rt-nextstep@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);
      await logActivity(lead.id, { type: 'MEETING', direction: 'OUTBOUND' });
      await logActivity(lead.id, { type: 'FOLLOW_UP', direction: 'OUTBOUND' });
      await logActivity(lead.id, { type: 'QUOTATION', direction: 'OUTBOUND' });
      await logActivity(lead.id, { type: 'FOLLOW_UP', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/response-times')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId })
        .expect(200);

      expect(findMetric(response, 'meeting_to_follow_up').count).toBeGreaterThanOrEqual(1);
      expect(findMetric(response, 'quote_to_follow_up').count).toBeGreaterThanOrEqual(1);
    });

    it('correlates slow contact with loss, and produces a headline', async () => {
      const lead = await capture({ email: 'rt-correlation@ltest.example.com' });
      await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' });
      await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'lost', lostReason: 'Budget' })
        .expect(200);

      const response = await request(app)
        .get('/api/leads/response-times')
        .set(auth(tokens.acmeAdmin))
        // A near-zero elapsed time already exceeds a threshold this small.
        .query({ sourceId, contactSpeedThresholdHours: 0.0000001 })
        .expect(200);

      const { speedToLossCorrelation } = response.body.data;
      expect(speedToLossCorrelation.afterThreshold.count).toBeGreaterThanOrEqual(1);
      expect(speedToLossCorrelation.afterThreshold.lostCount).toBeGreaterThanOrEqual(1);
      expect(speedToLossCorrelation.headline).toContain('%');
      expect(speedToLossCorrelation.byBucket).toHaveLength(6);
    });

    it('builds headlines from the first-response metric and the correlation', async () => {
      const lead = await capture({ email: 'rt-headline@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);
      await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/response-times')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, minSampleSize: 1 })
        .expect(200);

      expect(response.body.data.headlines.some((line: string) => line.startsWith('Average first response:'))).toBe(
        true,
      );
    });
  });

  // --- Follow-up dashboard -------------------------------------------------

  describe('follow-up dashboard', () => {
    const dueLeadIds = (response: request.Response): string[] =>
      response.body.data.groups.flatMap((group: { leads: { lead: { id: string } }[] }) =>
        group.leads.map((entry) => entry.lead.id),
      );

    it('flags a lead where the salesperson replied last and it has gone quiet', async () => {
      const lead = await capture({ email: 'fu-quiet@ltest.example.com' });
      await logActivity(lead.id, { type: 'CALL', direction: 'INBOUND' }); // lead replied
      await logActivity(lead.id, { type: 'EMAIL', direction: 'OUTBOUND' }); // salesperson replied

      const response = await request(app)
        .get('/api/leads/follow-ups')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, followUpAfterDays: 0.0000001 })
        .expect(200);

      expect(dueLeadIds(response)).toContain(lead.id);
    });

    it('does not flag a lead whose own message is the most recent', async () => {
      const lead = await capture({ email: 'fu-unanswered@ltest.example.com' });
      await logActivity(lead.id, { type: 'EMAIL', direction: 'OUTBOUND' });
      await logActivity(lead.id, { type: 'EMAIL', direction: 'INBOUND' }); // the rep owes a reply

      const response = await request(app)
        .get('/api/leads/follow-ups')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, followUpAfterDays: 0.0000001 })
        .expect(200);

      expect(dueLeadIds(response)).not.toContain(lead.id);
    });

    it('does not flag a lead that was contacted but never replied', async () => {
      const lead = await capture({ email: 'fu-cold@ltest.example.com' });
      await logActivity(lead.id, { type: 'CALL', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/follow-ups')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, followUpAfterDays: 0.0000001 })
        .expect(200);

      expect(dueLeadIds(response)).not.toContain(lead.id);
    });

    it('does not flag a closed lead', async () => {
      const lead = await capture({ email: 'fu-closed@ltest.example.com' });
      await logActivity(lead.id, { type: 'CALL', direction: 'INBOUND' });
      await logActivity(lead.id, { type: 'EMAIL', direction: 'OUTBOUND' });
      await request(app)
        .put(`/api/leads/${lead.id}/stage`)
        .set(auth(tokens.acmeAdmin))
        .send({ stageKey: 'lost', lostReason: 'Budget' })
        .expect(200);

      const response = await request(app)
        .get('/api/leads/follow-ups')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, followUpAfterDays: 0.0000001 })
        .expect(200);

      expect(dueLeadIds(response)).not.toContain(lead.id);
    });

    it('reports the dashboard shape — three fixed buckets and matching headlines', async () => {
      const lead = await capture({ email: 'fu-dashboard@ltest.example.com' });
      await logActivity(lead.id, { type: 'CALL', direction: 'INBOUND' });
      await logActivity(lead.id, { type: 'EMAIL', direction: 'OUTBOUND' });

      const response = await request(app)
        .get('/api/leads/follow-ups')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, followUpAfterDays: 0.0000001 })
        .expect(200);

      const { summary, groups, headlines } = response.body.data;
      expect(groups.map((g: { urgency: string }) => g.urgency)).toEqual(['today', 'overdue', 'critical']);
      expect(summary.totalDue).toBe(summary.today + summary.overdue + summary.critical);
      expect(headlines).toEqual([
        `Today: ${summary.today}`,
        `Overdue: ${summary.overdue}`,
        `Critical: ${summary.critical}`,
      ]);
    });
  });

  // --- Isolation and authorization ------------------------------------------

  describe('tenant isolation', () => {
    it('hides another tenant\'s lead behind a 404', async () => {
      const lead = await capture({ email: 'isolated@ltest.example.com' });

      // 404 rather than 403 — confirming the record exists is itself a leak.
      await request(app)
        .get(`/api/leads/${lead.id}`)
        .set(auth(tokens.globexAdmin))
        .expect(404);
    });

    it('keeps another tenant\'s leads out of the list', async () => {
      await capture({ email: 'mine@ltest.example.com' });

      const response = await request(app)
        .get('/api/leads')
        .set(auth(tokens.globexAdmin))
        .query({ limit: 100 })
        .expect(200);

      const emails = response.body.data.leads.map((lead: { email: string }) => lead.email);
      expect(emails).not.toContain('mine@ltest.example.com');
    });

    it('keeps another tenant out of the funnel', async () => {
      await capture({ email: 'privatefunnel@ltest.example.com' });

      const response = await request(app)
        .get('/api/leads/funnel')
        .set(auth(tokens.globexAdmin))
        .expect(200);

      expect(response.body.data.totals.captured).toBe(0);
    });

    it('keeps another tenant out of the leakage report', async () => {
      const lead = await capture({ email: 'privateleak@ltest.example.com' });
      await request(app)
        .put(`/api/leads/${lead.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      const response = await request(app)
        .get('/api/leads/leakage')
        .set(auth(tokens.globexAdmin))
        .query({ assignedTooLongHours: 0.0000001 })
        .expect(200);

      const group = response.body.data.leaks.find(
        (g: { type: string }) => g.type === 'assigned_not_contacted',
      );
      expect(group.count).toBe(0);
    });

    it('keeps another tenant out of the response-time report', async () => {
      await capture({ email: 'privatert@ltest.example.com' });

      const response = await request(app)
        .get('/api/leads/response-times')
        .set(auth(tokens.globexAdmin))
        .expect(200);

      const metric = response.body.data.metrics.find(
        (m: { key: string }) => m.key === 'captured_to_assigned',
      );
      expect(metric.count).toBe(0);
    });

    it('keeps another tenant out of the follow-up dashboard', async () => {
      await capture({ email: 'privatefu@ltest.example.com' });

      const response = await request(app)
        .get('/api/leads/follow-ups')
        .set(auth(tokens.globexAdmin))
        .query({ followUpAfterDays: 0.0000001 })
        .expect(200);

      expect(response.body.data.summary.totalDue).toBe(0);
    });
  });

  describe('authorization', () => {
    it('lets a read-only user see leads but not create them', async () => {
      await request(app).get('/api/leads').set(auth(tokens.acmeUser)).expect(200);

      await request(app)
        .post('/api/leads')
        .set(auth(tokens.acmeUser))
        .send({ email: 'forbidden@ltest.example.com' })
        .expect(403);
    });

    it('lets a manager work the pipeline but not reshape it', async () => {
      const lead = await capture({ email: 'managed@ltest.example.com' }, tokens.acmeManager);

      await request(app)
        .post(`/api/leads/${lead.id}/activities`)
        .set(auth(tokens.acmeManager))
        .send({ type: 'CALL', direction: 'OUTBOUND' })
        .expect(201);

      // Renaming a stage rewrites how every report in the organization reads.
      await request(app)
        .post('/api/lead-stages')
        .set(auth(tokens.acmeManager))
        .send({ name: 'Negotiation' })
        .expect(403);
    });

    it('requires authentication', async () => {
      await request(app).get('/api/leads').expect(401);
      await request(app).get('/api/leads/funnel').expect(401);
      await request(app).get('/api/leads/leakage').expect(401);
      await request(app).get('/api/leads/response-times').expect(401);
      await request(app).get('/api/leads/follow-ups').expect(401);
    });
  });

  // --- Pipeline configuration ------------------------------------------------

  describe('pipeline configuration', () => {
    it('provisions the default stages for a tenant', async () => {
      const response = await request(app)
        .get('/api/lead-stages')
        .set(auth(tokens.acmeAdmin))
        .expect(200);

      const keys = response.body.data.stages.map((stage: { key: string }) => stage.key);
      expect(keys).toEqual([
        'new',
        'contacted',
        'replied',
        'meeting',
        'quotation',
        'follow_up',
        'won',
        'lost',
      ]);
    });

    it('refuses to delete a system stage', async () => {
      const stages = await request(app)
        .get('/api/lead-stages')
        .set(auth(tokens.acmeAdmin))
        .expect(200);

      const won = stages.body.data.stages.find((stage: { key: string }) => stage.key === 'won');
      const response = await request(app)
        .delete(`/api/lead-stages/${won.id}`)
        .set(auth(tokens.acmeAdmin))
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('refuses to delete a source that leads came from', async () => {
      await capture({ email: 'attributed@ltest.example.com' });

      const response = await request(app)
        .delete(`/api/lead-sources/${sourceId}`)
        .set(auth(tokens.acmeAdmin))
        .expect(409);

      // Deleting it would erase the attribution of every lead it produced.
      expect(response.body.error.message).toContain('attribution');
    });
  });

  // --- Listing ---------------------------------------------------------------

  describe('listing', () => {
    it('filters to unassigned leads', async () => {
      const owned = await capture({ email: 'owned@ltest.example.com' });
      await capture({ email: 'orphan@ltest.example.com' });

      await request(app)
        .put(`/api/leads/${owned.id}/assignment`)
        .set(auth(tokens.acmeAdmin))
        .send({ assignedToId: acmeManagerId })
        .expect(200);

      const response = await request(app)
        .get('/api/leads')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, unassigned: 'true' })
        .expect(200);

      expect(response.body.data.leads).toHaveLength(1);
      expect(response.body.data.leads[0].email).toBe('orphan@ltest.example.com');
    });

    it('rejects contradictory assignment filters rather than guessing', async () => {
      await request(app)
        .get('/api/leads')
        .set(auth(tokens.acmeAdmin))
        .query({ unassigned: 'true', assignedToId: acmeManagerId })
        .expect(422);
    });

    it('searches across name, company, email and phone', async () => {
      await capture({ email: 'searchme@ltest.example.com', company: 'Kestrel Foods Ltest' });

      const response = await request(app)
        .get('/api/leads')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId, search: 'kestrel' })
        .expect(200);

      expect(response.body.data.leads).toHaveLength(1);
    });

    it('never exposes an internal column that was not opted in to', async () => {
      await capture({ email: 'shape@ltest.example.com' });

      const response = await request(app)
        .get('/api/leads')
        .set(auth(tokens.acmeAdmin))
        .query({ sourceId })
        .expect(200);

      const lead = response.body.data.leads[0];
      expect(lead).not.toHaveProperty('sourceId');
      expect(lead).not.toHaveProperty('stageId');
      expect(lead).not.toHaveProperty('createdById');
      expect(lead.source).toMatchObject({ key: TEST_SOURCE_KEY });
    });
  });
});
