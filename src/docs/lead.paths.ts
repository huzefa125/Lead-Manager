/**
 * OpenAPI fragments for the Lead Engine, merged into `openapi.ts`.
 *
 * Written by hand for the same reason as the rest of the spec: the contract
 * includes things types cannot express — that a captured lead can never enter
 * the pipeline halfway down, that milestones move forward only, and that the
 * funnel is read from those milestones rather than from the current stage.
 */

const LEAD_EXAMPLE = {
  id: 'b7a1c2d3-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
  firstName: 'Ada',
  lastName: 'Sharma',
  fullName: 'Ada Sharma',
  email: 'ada@sharmatextiles.example.com',
  phone: '+91 98765 43210',
  whatsapp: null,
  company: 'Sharma Textiles',
  jobTitle: 'Procurement Head',
  website: null,
  source: {
    id: 'c1d2e3f4-5678-4abc-9def-000111222333',
    key: 'google_ads',
    name: 'Google Ads',
    channel: 'GOOGLE_ADS',
  },
  channel: 'GOOGLE_ADS',
  campaign: 'diwali-2026',
  landingPage: 'https://acme.example.com/quote',
  utm: { source: 'google', medium: 'cpc', campaign: 'diwali-2026', term: null, content: null },
  referrer: null,
  externalId: 'gads-88213',
  estimatedValue: 125000,
  currency: 'INR',
  stage: { id: 'a9b8c7d6-1111-4222-8333-444455556666', key: 'meeting', name: 'Meeting Booked', position: 4, type: 'OPEN' },
  status: 'OPEN',
  lostReason: null,
  notes: null,
  assignedTo: { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'Manager User', email: 'manager@example.com' },
  journey: {
    capturedAt: '2026-08-01T06:30:00.000Z',
    assignedAt: '2026-08-01T07:10:00.000Z',
    firstContactAt: '2026-08-01T09:45:00.000Z',
    firstReplyAt: '2026-08-02T04:20:00.000Z',
    meetingBookedAt: '2026-08-04T11:00:00.000Z',
    quotationSentAt: null,
    lastFollowUpAt: '2026-08-06T05:00:00.000Z',
    followUpCount: 2,
    closedAt: null,
    nextStep: { key: 'quotation', label: 'Quotations sent' },
    hoursToFirstContact: 3.3,
    hoursToFirstReply: 18.6,
    daysToClose: null,
  },
  lastActivityAt: '2026-08-06T05:00:00.000Z',
  activityCount: 7,
  organizationId: 'd1e2f3a4-5555-4666-8777-888899990000',
  createdAt: '2026-08-01T06:30:00.000Z',
  updatedAt: '2026-08-06T05:00:00.000Z',
};

const FUNNEL_EXAMPLE = {
  totals: {
    captured: 127,
    open: 84,
    won: 7,
    lost: 36,
    assigned: 103,
    unassigned: 24,
    winRate: 0.1628,
    estimatedValue: 9875000,
    wonValue: 812000,
  },
  funnel: [
    { key: 'captured', label: 'Leads received', count: 127, conversionFromStart: 1, conversionFromPrevious: 1, droppedFromPrevious: 0, dropOffRate: 0 },
    { key: 'contacted', label: 'Contacted', count: 89, conversionFromStart: 0.7008, conversionFromPrevious: 0.7008, droppedFromPrevious: 38, dropOffRate: 0.2992 },
    { key: 'replied', label: 'Replied', count: 54, conversionFromStart: 0.4252, conversionFromPrevious: 0.6067, droppedFromPrevious: 35, dropOffRate: 0.3933 },
    { key: 'meeting', label: 'Meetings booked', count: 31, conversionFromStart: 0.2441, conversionFromPrevious: 0.5741, droppedFromPrevious: 23, dropOffRate: 0.4259 },
    { key: 'quotation', label: 'Quotations sent', count: 18, conversionFromStart: 0.1417, conversionFromPrevious: 0.5806, droppedFromPrevious: 13, dropOffRate: 0.4194 },
    { key: 'won', label: 'Closed won', count: 7, conversionFromStart: 0.0551, conversionFromPrevious: 0.3889, droppedFromPrevious: 11, dropOffRate: 0.6111 },
  ],
  break: {
    fromKey: 'captured',
    fromLabel: 'Leads received',
    toKey: 'contacted',
    toLabel: 'Contacted',
    dropped: 38,
    dropOffRate: 0.2992,
    summary:
      '38 of 127 leads (29.9%) stop between "Leads received" and "Contacted" — the largest loss in the journey.',
  },
  responseTimes: {
    averageHoursToFirstContact: 21.4,
    medianHoursToFirstContact: 8.2,
    averageHoursToFirstReply: 30.1,
    medianHoursToFirstReply: 19.5,
  },
  byStage: [
    { stage: { id: 'a9b8c7d6-1111-4222-8333-444455556666', key: 'new', name: 'New', position: 1, type: 'OPEN' }, count: 38, value: 2850000 },
  ],
};

const envelope = (dataSchema: object) => ({
  type: 'object',
  required: ['success', 'data', 'meta'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: dataSchema,
    meta: { $ref: '#/components/schemas/ResponseMeta' },
  },
});

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
});

const notFoundOrOtherTenant = errorResponse(
  'No such lead — **or** it belongs to another tenant. The two are deliberately indistinguishable: a 403 would confirm the record exists.',
);

const LEAD_CHANNELS = [
  'WEBSITE_FORM', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE_ADS', 'LINKEDIN',
  'EMAIL', 'PHONE', 'CRM_IMPORT', 'BOOKING', 'REFERRAL', 'MANUAL', 'OTHER',
];

const LOGGABLE_TYPES = ['NOTE', 'CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'MEETING', 'QUOTATION', 'FOLLOW_UP', 'TASK'];

const contactProperties = {
  firstName: { type: 'string' },
  lastName: { type: 'string' },
  email: { type: 'string', format: 'email' },
  phone: { type: 'string', example: '+91 98765 43210' },
  whatsapp: { type: 'string', description: 'Often a different number from `phone`.' },
  company: { type: 'string' },
  jobTitle: { type: 'string' },
  website: { type: 'string', format: 'uri' },
};

const attributionProperties = {
  campaign: { type: 'string', example: 'diwali-2026' },
  landingPage: { type: 'string', format: 'uri' },
  utmSource: { type: 'string' },
  utmMedium: { type: 'string' },
  utmCampaign: { type: 'string' },
  utmTerm: { type: 'string' },
  utmContent: { type: 'string' },
  referrer: { type: 'string' },
};

export const leadSchemas = {
  LeadJourney: {
    type: 'object',
    description: [
      'Write-once milestones. Each is stamped the first time the lead reaches that point and is',
      'never cleared, so dragging a lead back down the pipeline does not erase how far it got.',
      'This is what the funnel counts — not the current stage.',
      '',
      'Reaching a milestone implies every earlier one: a lead that books a meeting off a Calendly',
      'link with no logged call is still recorded as contacted, which keeps the funnel monotonic.',
    ].join(' '),
    properties: {
      capturedAt: { type: 'string', format: 'date-time', description: 'When the lead arrived — not when the row was written.' },
      assignedAt: { type: 'string', format: 'date-time', nullable: true, description: 'First owner. Not cleared by unassigning.' },
      firstContactAt: { type: 'string', format: 'date-time', nullable: true },
      firstReplyAt: { type: 'string', format: 'date-time', nullable: true },
      meetingBookedAt: { type: 'string', format: 'date-time', nullable: true },
      quotationSentAt: { type: 'string', format: 'date-time', nullable: true },
      lastFollowUpAt: { type: 'string', format: 'date-time', nullable: true, description: 'Latest, not first — this one tracks recency.' },
      followUpCount: { type: 'integer' },
      closedAt: { type: 'string', format: 'date-time', nullable: true },
      nextStep: {
        type: 'object',
        nullable: true,
        description: 'The step this lead has not reached. `null` once it is closed.',
        properties: { key: { type: 'string' }, label: { type: 'string' } },
      },
      hoursToFirstContact: { type: 'number', nullable: true },
      hoursToFirstReply: { type: 'number', nullable: true },
      daysToClose: { type: 'number', nullable: true },
    },
  },

  Lead: {
    type: 'object',
    description: 'A prospect. `stage` is where it is now; `journey` is how far it ever got.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      ...contactProperties,
      fullName: { type: 'string', nullable: true },
      source: { $ref: '#/components/schemas/LeadSource' },
      channel: { type: 'string', enum: LEAD_CHANNELS, nullable: true },
      ...attributionProperties,
      externalId: { type: 'string', nullable: true, description: "The id this lead carries in the system it came from. Unique per source, which is what makes capture idempotent." },
      estimatedValue: { type: 'number', nullable: true },
      currency: { type: 'string', example: 'INR' },
      stage: { $ref: '#/components/schemas/LeadStage' },
      status: { type: 'string', enum: ['OPEN', 'WON', 'LOST'], description: 'Derived from the current stage type.' },
      lostReason: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      assignedTo: {
        type: 'object',
        nullable: true,
        properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string', nullable: true }, email: { type: 'string' } },
      },
      journey: { $ref: '#/components/schemas/LeadJourney' },
      lastActivityAt: { type: 'string', format: 'date-time', nullable: true },
      activityCount: { type: 'integer' },
      organizationId: { type: 'string', format: 'uuid' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    example: LEAD_EXAMPLE,
  },

  LeadSource: {
    type: 'object',
    description:
      'A named origin, owned by one tenant. Rows rather than an enum, because the useful granularity is the customer\'s: "Google Ads — Brand" and "Google Ads — Competitor" are two sources over one channel.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      key: { type: 'string', description: 'Stable machine key. Integrations address a source by this, so it is immutable.', example: 'google_ads' },
      name: { type: 'string', example: 'Google Ads' },
      channel: { type: 'string', enum: LEAD_CHANNELS },
      description: { type: 'string', nullable: true },
      isActive: { type: 'boolean' },
      isSystem: { type: 'boolean', description: 'Provisioned per channel. Cannot be deleted or deactivated — capture falls back to it.' },
      leadCount: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  LeadStage: {
    type: 'object',
    description: 'One column of the pipeline, owned by one tenant.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      key: { type: 'string', example: 'meeting' },
      name: { type: 'string', example: 'Meeting Booked' },
      description: { type: 'string', nullable: true },
      position: { type: 'integer' },
      type: { type: 'string', enum: ['OPEN', 'WON', 'LOST'], description: 'Immutable: flipping OPEN to WON would reclassify every lead in the stage as revenue.' },
      isSystem: { type: 'boolean' },
      leadCount: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  LeadActivity: {
    type: 'object',
    description: 'One entry in a lead\'s timeline. User-logged work and system events share the feed.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      leadId: { type: 'string', format: 'uuid' },
      type: {
        type: 'string',
        enum: [...LOGGABLE_TYPES, 'CREATED', 'ASSIGNED', 'STAGE_CHANGED', 'STATUS_CHANGED'],
        description: 'The last four are written by the system and are rejected if a client sends them.',
      },
      direction: {
        type: 'string',
        enum: ['INBOUND', 'OUTBOUND', 'INTERNAL'],
        description: 'Separates "we reached out" from "they answered". Without it the reply rate cannot be computed.',
      },
      subject: { type: 'string', nullable: true },
      body: { type: 'string', nullable: true },
      occurredAt: { type: 'string', format: 'date-time', description: 'When it happened, not when it was recorded.' },
      durationMinutes: { type: 'integer', nullable: true },
      metadata: { type: 'object', nullable: true, description: 'Structured payload for system events — the stage moved from and to, the previous owner.' },
      isSystem: { type: 'boolean' },
      actor: {
        type: 'object',
        nullable: true,
        description: 'Null for webhook and system-generated entries.',
        properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string', nullable: true }, email: { type: 'string' } },
      },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  FunnelReport: {
    type: 'object',
    description: 'The journey, measured. Read from the milestone columns, so its cost does not grow with how much activity has been logged.',
    properties: {
      totals: {
        type: 'object',
        properties: {
          captured: { type: 'integer' },
          open: { type: 'integer' },
          won: { type: 'integer' },
          lost: { type: 'integer' },
          assigned: { type: 'integer' },
          unassigned: { type: 'integer', description: 'Captured but unowned — a leak the funnel steps do not show.' },
          winRate: { type: 'number', description: 'Of the leads that reached a decision (won ÷ (won + lost)), not of everything captured.' },
          estimatedValue: { type: 'number' },
          wonValue: { type: 'number' },
        },
      },
      funnel: {
        type: 'array',
        description: 'Six steps: captured → contacted → replied → meeting → quotation → won. Assignment is reported in `totals` instead, since a lead can be worked while unassigned.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            count: { type: 'integer' },
            conversionFromStart: { type: 'number' },
            conversionFromPrevious: { type: 'number' },
            droppedFromPrevious: { type: 'integer' },
            dropOffRate: { type: 'number' },
          },
        },
      },
      break: {
        type: 'object',
        nullable: true,
        description:
          'Where the journey breaks — ranked by leads lost, not by rate. A 100% drop across the two leads that reached quotation is real but unactionable next to 38 lost before first contact. `null` when nothing was lost anywhere.',
        properties: {
          fromKey: { type: 'string' },
          fromLabel: { type: 'string' },
          toKey: { type: 'string' },
          toLabel: { type: 'string' },
          dropped: { type: 'integer' },
          dropOffRate: { type: 'number' },
          summary: { type: 'string' },
        },
      },
      responseTimes: {
        type: 'object',
        description: 'Median alongside the mean — one lead contacted after three weeks skews the mean badly.',
        properties: {
          averageHoursToFirstContact: { type: 'number', nullable: true },
          medianHoursToFirstContact: { type: 'number', nullable: true },
          averageHoursToFirstReply: { type: 'number', nullable: true },
          medianHoursToFirstReply: { type: 'number', nullable: true },
        },
      },
      byStage: {
        type: 'array',
        description: 'Current occupancy of the board.',
        items: {
          type: 'object',
          properties: {
            stage: { $ref: '#/components/schemas/LeadStage' },
            count: { type: 'integer' },
            value: { type: 'number' },
          },
        },
      },
      groups: {
        type: 'array',
        description: 'Present only when `groupBy` was requested — the same funnel split by source, channel or owner.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', nullable: true },
            label: { type: 'string' },
            funnel: { type: 'array', items: { type: 'object' } },
            break: { type: 'object', nullable: true },
            totals: { type: 'object' },
          },
        },
      },
    },
    example: FUNNEL_EXAMPLE,
  },
};

export const leadPaths = {
  '/leads': {
    get: {
      tags: ['Leads'],
      summary: 'List leads',
      description: 'Confined to the caller\'s organization. Requires `lead.view`.',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        { name: 'search', in: 'query', description: 'Matches name, company, email and phone.', schema: { type: 'string' } },
        { name: 'status', in: 'query', description: 'Comma-separated, e.g. `OPEN,WON`.', schema: { type: 'string' } },
        { name: 'channel', in: 'query', description: 'Comma-separated channels.', schema: { type: 'string' } },
        { name: 'stageId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'sourceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'assignedToId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'unassigned', in: 'query', description: 'Mutually exclusive with `assignedToId` — sending both is a 422 rather than a guess.', schema: { type: 'boolean' } },
        { name: 'capturedFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'capturedTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'staleForDays', in: 'query', description: 'Open leads untouched for N days — the queue a manager works from.', schema: { type: 'integer' } },
        { name: 'sort', in: 'query', schema: { type: 'string', enum: ['capturedAt', 'lastActivityAt', 'estimatedValue', 'updatedAt'], default: 'capturedAt' } },
        { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
      ],
      responses: {
        200: {
          description: 'A page of leads.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: {
                  leads: { type: 'array', items: { $ref: '#/components/schemas/Lead' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              }),
            },
          },
        },
        401: errorResponse('Missing or expired access token.'),
        403: errorResponse('Authenticated, but without `lead.view`.'),
      },
    },

    post: {
      tags: ['Leads'],
      summary: 'Create a lead',
      description: [
        'For internal use — a salesperson typing in a lead, or an import. Unlike `/leads/capture`',
        'this may set the starting stage and owner, which is what lets an import land a lead',
        'directly at "Quotation Sent" with the milestones underneath it filled in.',
        '',
        'Supplying an `externalId` that already exists on the same source returns **200** with the',
        'existing lead rather than creating a second one.',
        '',
        'Requires `lead.create`.',
      ].join('\n'),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'At least one of `email`, `phone` or `whatsapp` is required — a lead nobody can be reached at would sit in the pipeline forever and be counted in every funnel.',
              properties: {
                ...contactProperties,
                ...attributionProperties,
                sourceId: { type: 'string', format: 'uuid' },
                sourceKey: { type: 'string', example: 'google_ads' },
                channel: { type: 'string', enum: LEAD_CHANNELS, description: 'Used to pick the default source when no id or key is given.' },
                stageId: { type: 'string', format: 'uuid' },
                stageKey: { type: 'string', example: 'new' },
                assignedToId: { type: 'string', format: 'uuid', description: 'Must be an active user in your organization.' },
                externalId: { type: 'string' },
                estimatedValue: { type: 'number', example: 125000 },
                currency: { type: 'string', example: 'INR' },
                notes: { type: 'string' },
                capturedAt: { type: 'string', format: 'date-time', description: 'For imports. Cannot be in the future.' },
              },
            },
            example: {
              firstName: 'Ada',
              lastName: 'Sharma',
              email: 'ada@sharmatextiles.example.com',
              phone: '+91 98765 43210',
              company: 'Sharma Textiles',
              channel: 'PHONE',
              estimatedValue: 125000,
            },
          },
        },
      },
      responses: {
        201: { description: 'Lead created.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' }, created: { type: 'boolean', enum: [true] } } }) } } },
        200: { description: 'An `externalId` matched an existing lead. Nothing was created.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' }, created: { type: 'boolean', enum: [false] } } }) } } },
        401: errorResponse('Missing or expired access token.'),
        403: errorResponse('Authenticated, but without `lead.create`.'),
        422: errorResponse('Validation failed — no contact detail, an unknown source key, or an assignee outside your organization.'),
      },
    },
  },

  '/leads/capture': {
    post: {
      tags: ['Leads'],
      summary: 'Capture a lead from an integration',
      description: [
        'The unified inbox. Website forms, WhatsApp, Instagram and Facebook lead ads, Google Ads,',
        'LinkedIn, monitored inboxes, call logs, Calendly — everything arrives here.',
        '',
        '**It cannot set a stage, an owner or a status.** Every captured lead starts at the top of',
        'the pipeline, because the funnel\'s first number only means "leads received" if nothing can',
        'enter halfway down. Those fields are stripped, not rejected, so a chatty webhook still',
        'succeeds.',
        '',
        '**It will not create the same person twice.** Three outcomes are possible, reported in',
        '`outcome`:',
        '',
        '| `outcome` | Status | Meaning |',
        '|---|---|---|',
        '| `created` | 201 | A new lead. |',
        '| `duplicate_external_id` | 200 | Same source and `externalId` — a redelivered webhook. |',
        '| `merged_into_open_lead` | 200 | An open lead already has this email or phone. Blanks were filled; nothing was overwritten. |',
        '',
        'A merge is recorded on the timeline as an internal note, **not** as an inbound reply —',
        'filling a form again is not a response to your outreach, and counting it as one would',
        'inflate the reply rate.',
        '',
        'Requires `lead.capture` or `lead.create`. A service account should hold only the former:',
        'it grants this endpoint and nothing else, so a leaked integration credential cannot read',
        'the pipeline.',
      ].join('\n'),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'At least one of `email`, `phone` or `whatsapp` is required.',
              properties: {
                ...contactProperties,
                ...attributionProperties,
                channel: { type: 'string', enum: LEAD_CHANNELS, default: 'OTHER', description: 'A webhook that forgets this still delivers the lead.' },
                sourceKey: { type: 'string', description: 'For finer granularity than the channel default.' },
                externalId: { type: 'string', description: 'Makes redelivery idempotent.' },
                estimatedValue: { type: 'number' },
                currency: { type: 'string' },
                notes: { type: 'string' },
                capturedAt: { type: 'string', format: 'date-time' },
              },
            },
            example: {
              channel: 'WHATSAPP',
              firstName: 'Ravi',
              phone: '+91 90000 11111',
              company: 'Vertex Logistics',
              externalId: 'wa-88213',
              campaign: 'diwali-2026',
              utmSource: 'whatsapp',
              utmMedium: 'social',
              landingPage: 'https://acme.example.com/quote',
            },
          },
        },
      },
      responses: {
        201: { description: 'A new lead.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' }, outcome: { type: 'string', enum: ['created'] } } }) } } },
        200: { description: 'Recognised as an existing lead. Nothing was duplicated.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' }, outcome: { type: 'string', enum: ['duplicate_external_id', 'merged_into_open_lead'] } } }) } } },
        401: errorResponse('Missing or expired access token.'),
        403: errorResponse('Authenticated, but without `lead.capture` or `lead.create`.'),
        422: errorResponse('Validation failed — most often no contact detail at all.'),
      },
    },
  },

  '/leads/funnel': {
    get: {
      tags: ['Leads'],
      summary: 'The journey funnel, and where it breaks',
      description: [
        'Counts how many leads ever reached each step, and names the gap losing the most.',
        '',
        'Read from the write-once milestone columns rather than from current stage. A funnel',
        'counted from stage reports that a quotation was never sent the moment a salesperson',
        'honestly drags a stalled deal back to "Follow-up" — the numbers shrink as the data gets',
        'more accurate, which is the wrong incentive to build into a report.',
        '',
        'Requires `lead.view`.',
      ].join('\n'),
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'capturedFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'capturedTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'sourceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'channel', in: 'query', description: 'Comma-separated channels.', schema: { type: 'string' } },
        { name: 'assignedToId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'groupBy', in: 'query', description: 'Splits the funnel instead of returning one.', schema: { type: 'string', enum: ['none', 'source', 'channel', 'owner'], default: 'none' } },
      ],
      responses: {
        200: { description: 'The funnel.', content: { 'application/json': { schema: envelope({ $ref: '#/components/schemas/FunnelReport' }) } } },
        401: errorResponse('Missing or expired access token.'),
        403: errorResponse('Authenticated, but without `lead.view`.'),
      },
    },
  },

  '/leads/{id}': {
    get: {
      tags: ['Leads'],
      summary: 'Get a lead',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      responses: {
        200: { description: 'The lead.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } }) } } },
        404: notFoundOrOtherTenant,
      },
    },

    patch: {
      tags: ['Leads'],
      summary: 'Update a lead\'s details',
      description: [
        'Contact details, attribution, deal value and notes.',
        '',
        '**Stage, status, owner and every milestone are deliberately absent.** Each has a dedicated',
        'endpoint that writes a timeline entry; allowing them here would move the pipeline with no',
        'record of who moved it or when. Sending them anyway is not an error — they are stripped.',
        '',
        'Requires `lead.update`.',
      ].join('\n'),
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ...contactProperties,
                ...attributionProperties,
                estimatedValue: { type: 'number', nullable: true },
                currency: { type: 'string' },
                notes: { type: 'string', nullable: true },
                lostReason: { type: 'string', nullable: true },
                sourceId: { type: 'string', format: 'uuid' },
              },
            },
            example: { company: 'Sharma Textiles Pvt Ltd', estimatedValue: 180000 },
          },
        },
      },
      responses: {
        200: { description: 'The updated lead.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } }) } } },
        403: errorResponse('Authenticated, but without `lead.update`.'),
        404: notFoundOrOtherTenant,
        422: errorResponse('Empty patch, or a source outside your organization.'),
      },
    },

    delete: {
      tags: ['Leads'],
      summary: 'Delete a lead',
      description: 'Cascades to the whole timeline — a lead\'s history has no meaning without the lead. Requires `lead.delete`.',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      responses: {
        200: { description: 'Deleted.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { message: { type: 'string' } } }) } } },
        403: errorResponse('Authenticated, but without `lead.delete`.'),
        404: notFoundOrOtherTenant,
      },
    },
  },

  '/leads/{id}/assignment': {
    put: {
      tags: ['Leads'],
      summary: 'Assign or unassign a lead',
      description: [
        'Writes an `ASSIGNED` timeline entry recording both the previous and the new owner.',
        '',
        '`assignedAt` is write-once, so it measures time-to-first-owner. Unassigning does **not**',
        'clear it: the lead did once have an owner, and resetting that clock would be a lie.',
        '',
        'Re-assigning to the current owner is a no-op rather than a timeline entry — a history full',
        'of "assigned to Ada" repeated by an over-eager UI is worse than no history.',
        '',
        'Requires `lead.assign`, which is separate from `lead.update`: reassigning work is a',
        'manager\'s job, editing a phone number is not.',
      ].join('\n'),
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['assignedToId'],
              properties: {
                assignedToId: { type: 'string', format: 'uuid', nullable: true, description: '`null` unassigns — an explicit act, distinct from omitting the field.' },
                note: { type: 'string' },
              },
            },
            example: { assignedToId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', note: 'Handing over — Ravi covers textiles.' },
          },
        },
      },
      responses: {
        200: { description: 'The reassigned lead.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } }) } } },
        403: errorResponse('Authenticated, but without `lead.assign`.'),
        404: notFoundOrOtherTenant,
        422: errorResponse('The assignee is not an active user in your organization. Deliberately the same response as a user id that does not exist.'),
      },
    },
  },

  '/leads/{id}/stage': {
    put: {
      tags: ['Leads'],
      summary: 'Move a lead between stages',
      description: [
        'Writes a `STAGE_CHANGED` entry, and a `STATUS_CHANGED` entry when the move opens or closes',
        'the lead.',
        '',
        'Landing on a stage records the milestones it proves — moving to "Quotation Sent" stamps',
        '`quotationSentAt`, and winning stamps the whole chain, because you do not close a deal you',
        'never quoted. Moving **backwards** records nothing: milestones are write-once, which is',
        'exactly what lets a salesperson be honest about where a deal really is without the funnel',
        'punishing them for it.',
        '',
        'Moving to a stage of type `LOST` **requires a reason**. It is the one field that turns "we',
        'lose 40% at quotation" into something a team can act on. Reopening a closed lead clears it.',
        '',
        'Requires `lead.update`.',
      ].join('\n'),
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Provide either `stageId` or `stageKey`.',
              properties: {
                stageId: { type: 'string', format: 'uuid' },
                stageKey: { type: 'string', example: 'quotation' },
                lostReason: { type: 'string', description: 'Required when the target stage is of type LOST.' },
                note: { type: 'string' },
                occurredAt: { type: 'string', format: 'date-time', description: 'Backdating a move, for imports catching a pipeline up.' },
              },
            },
            example: { stageKey: 'lost', lostReason: 'Chose a competitor on price' },
          },
        },
      },
      responses: {
        200: { description: 'The moved lead.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } }) } } },
        403: errorResponse('Authenticated, but without `lead.update`.'),
        404: notFoundOrOtherTenant,
        422: errorResponse('No target stage, an unknown stage key, or a move to a LOST stage with no reason.'),
      },
    },
  },

  '/leads/{id}/timeline': {
    get: {
      tags: ['Leads'],
      summary: 'A lead\'s complete history',
      description: [
        'Logged work and system events in one ordered feed — created, assigned, every call, every',
        'reply, every stage move.',
        '',
        'They share a table on purpose: a timeline assembled from two sources has to be merged and',
        'paginated in application code, and would drift out of order the first time a clock',
        'disagreed.',
        '',
        'Requires `lead.view`.',
      ].join('\n'),
      security: [{ bearerAuth: [] }],
      parameters: [
        idParam,
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        { name: 'type', in: 'query', description: 'Comma-separated activity types.', schema: { type: 'string' } },
        { name: 'direction', in: 'query', description: 'Comma-separated: `INBOUND,OUTBOUND,INTERNAL`.', schema: { type: 'string' } },
        { name: 'excludeSystem', in: 'query', description: 'Hides CREATED/ASSIGNED/STAGE_CHANGED/STATUS_CHANGED, leaving only human-logged work.', schema: { type: 'boolean', default: false } },
        { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
      ],
      responses: {
        200: {
          description: 'A page of the timeline.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: {
                  activities: { type: 'array', items: { $ref: '#/components/schemas/LeadActivity' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              }),
            },
          },
        },
        404: notFoundOrOtherTenant,
      },
    },
  },

  '/leads/{id}/activities': {
    post: {
      tags: ['Leads'],
      summary: 'Log a call, email, meeting or note',
      description: [
        '**This is the endpoint that builds the funnel.** A salesperson recording an outbound call',
        'is what turns a lead from "received" into "contacted"; the reply that follows turns it into',
        '"replied". Nothing else populates those numbers.',
        '',
        'Which is why `direction` matters and is never inferred:',
        '',
        '| Type | `OUTBOUND` | `INBOUND` |',
        '|---|---|---|',
        '| `CALL` `EMAIL` `WHATSAPP` `SMS` | first contact | first reply |',
        '| `MEETING` | meeting booked | meeting booked |',
        '| `QUOTATION` | quotation sent | quotation sent |',
        '| `FOLLOW_UP` | first contact, and advances the follow-up counter | same |',
        '| `NOTE` `TASK` | nothing — a note to yourself never left the building | nothing |',
        '',
        'Reaching a milestone backfills every earlier one, so a lead that books a meeting off a',
        'Calendly link is still counted as contacted.',
        '',
        '`CREATED`, `ASSIGNED`, `STAGE_CHANGED` and `STATUS_CHANGED` are rejected: a client able to',
        'forge those would make the audit trail worthless.',
        '',
        'The response\'s `advanced` array names the milestones this entry moved, so the UI can say',
        '"this lead is now counted as contacted" rather than leaving the user to spot it.',
        '',
        'Requires `lead.update`.',
      ].join('\n'),
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['type'],
              properties: {
                type: { type: 'string', enum: LOGGABLE_TYPES },
                direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND', 'INTERNAL'], default: 'OUTBOUND', description: 'Defaults to OUTBOUND — someone logging a call almost always means one they made.' },
                subject: { type: 'string' },
                body: { type: 'string' },
                durationMinutes: { type: 'integer' },
                occurredAt: { type: 'string', format: 'date-time', description: 'When it happened. A call logged the next morning must land on the day of the call.' },
              },
            },
            example: { type: 'CALL', direction: 'OUTBOUND', subject: 'Intro call', durationMinutes: 12, body: 'Wants a quote for 400 units.' },
          },
        },
      },
      responses: {
        201: {
          description: 'Logged, with the lead as it now stands.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: {
                  activity: { $ref: '#/components/schemas/LeadActivity' },
                  lead: { $ref: '#/components/schemas/Lead' },
                  advanced: { type: 'array', items: { type: 'string' }, example: ['firstContactAt'] },
                },
              }),
            },
          },
        },
        403: errorResponse('Authenticated, but without `lead.update`.'),
        404: notFoundOrOtherTenant,
        422: errorResponse('A reserved system type, or a date in the future.'),
      },
    },
  },

  '/lead-sources': {
    get: {
      tags: ['Lead pipeline'],
      summary: 'List lead sources',
      description: 'Defaults are provisioned on first use, one per channel. Requires `lead_source.view`.',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'includeInactive', in: 'query', schema: { type: 'boolean', default: false } },
        { name: 'channel', in: 'query', description: 'Comma-separated channels.', schema: { type: 'string' } },
      ],
      responses: {
        200: { description: 'The catalogue.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { sources: { type: 'array', items: { $ref: '#/components/schemas/LeadSource' } } } }) } } },
        403: errorResponse('Authenticated, but without `lead_source.view`.'),
      },
    },
    post: {
      tags: ['Lead pipeline'],
      summary: 'Create a lead source',
      description: 'For finer granularity than one source per channel. Requires `lead_source.create`.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'channel'],
              properties: {
                name: { type: 'string' },
                channel: { type: 'string', enum: LEAD_CHANNELS },
                key: { type: 'string', description: 'lower_snake_case. Derived from the name when omitted.' },
                description: { type: 'string' },
              },
            },
            example: { name: 'Google Ads — Brand', channel: 'GOOGLE_ADS', key: 'google_ads_brand' },
          },
        },
      },
      responses: {
        201: { description: 'Created.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { source: { $ref: '#/components/schemas/LeadSource' } } }) } } },
        409: errorResponse('That key is already in use in your organization.'),
      },
    },
  },

  '/lead-sources/{id}': {
    get: {
      tags: ['Lead pipeline'],
      summary: 'Get a lead source',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      responses: {
        200: { description: 'The source.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { source: { $ref: '#/components/schemas/LeadSource' } } }) } } },
        404: errorResponse('No such source, or it belongs to another tenant.'),
      },
    },
    patch: {
      tags: ['Lead pipeline'],
      summary: 'Rename or deactivate a lead source',
      description: '`key` and `channel` are immutable — integrations address a source by key, and rewriting the channel would retroactively re-attribute every lead that came through it. Requires `lead_source.update`.',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string', nullable: true }, isActive: { type: 'boolean' } } },
            example: { name: 'Google Ads — Brand Campaigns' },
          },
        },
      },
      responses: {
        200: { description: 'Updated.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { source: { $ref: '#/components/schemas/LeadSource' } } }) } } },
        409: errorResponse('A system source cannot be deactivated — capture falls back to it.'),
      },
    },
    delete: {
      tags: ['Lead pipeline'],
      summary: 'Delete a lead source',
      description: 'Refused while any lead came from it — deleting would erase their attribution. Deactivate instead. Requires `lead_source.delete`.',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      responses: {
        200: { description: 'Deleted.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { message: { type: 'string' } } }) } } },
        409: errorResponse('It is a system source, or leads are attributed to it.'),
      },
    },
  },

  '/lead-stages': {
    get: {
      tags: ['Lead pipeline'],
      summary: 'List pipeline stages',
      description: 'Ordered left to right. Defaults are provisioned on first use: New → Contacted → Replied → Meeting Booked → Quotation Sent → Follow-up → Won / Lost. Requires `lead_stage.view`.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'The pipeline.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { stages: { type: 'array', items: { $ref: '#/components/schemas/LeadStage' } } } }) } } },
        403: errorResponse('Authenticated, but without `lead_stage.view`.'),
      },
    },
    post: {
      tags: ['Lead pipeline'],
      summary: 'Add a pipeline stage',
      description: 'A stage the system does not recognise — "Negotiation", say — records no milestone when a lead lands on it, which is correct: only you know what it means. Requires `lead_stage.create`.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                key: { type: 'string', description: 'lower_snake_case. Derived from the name when omitted.' },
                description: { type: 'string' },
                position: { type: 'integer', description: 'Appended to the end when omitted.' },
                type: { type: 'string', enum: ['OPEN', 'WON', 'LOST'], default: 'OPEN' },
              },
            },
            example: { name: 'Negotiation', position: 6 },
          },
        },
      },
      responses: {
        201: { description: 'Created.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { stage: { $ref: '#/components/schemas/LeadStage' } } }) } } },
        409: errorResponse('That key is already in use in your organization.'),
      },
    },
  },

  '/lead-stages/{id}': {
    get: {
      tags: ['Lead pipeline'],
      summary: 'Get a pipeline stage',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      responses: {
        200: { description: 'The stage.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { stage: { $ref: '#/components/schemas/LeadStage' } } }) } } },
        404: errorResponse('No such stage, or it belongs to another tenant.'),
      },
    },
    patch: {
      tags: ['Lead pipeline'],
      summary: 'Rename or reorder a pipeline stage',
      description: '`type` is immutable: flipping a stage from OPEN to WON would silently reclassify every lead sitting in it as revenue. Requires `lead_stage.update`.',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string', nullable: true }, position: { type: 'integer' } } },
            example: { name: 'Proposal Sent', position: 5 },
          },
        },
      },
      responses: {
        200: { description: 'Updated.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { stage: { $ref: '#/components/schemas/LeadStage' } } }) } } },
        404: errorResponse('No such stage, or it belongs to another tenant.'),
      },
    },
    delete: {
      tags: ['Lead pipeline'],
      summary: 'Delete a pipeline stage',
      description: 'Refused for a system stage, and refused while any lead is in it — move them first. Requires `lead_stage.delete`.',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      responses: {
        200: { description: 'Deleted.', content: { 'application/json': { schema: envelope({ type: 'object', properties: { message: { type: 'string' } } }) } } },
        409: errorResponse('It is a system stage, or leads are still in it.'),
      },
    },
  },
};
