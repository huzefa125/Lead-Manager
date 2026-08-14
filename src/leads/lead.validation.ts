import {
  LeadActivityDirection,
  LeadActivityType,
  LeadChannel,
  LeadStageType,
  LeadStatus,
} from '@prisma/client';
import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  LOGGABLE_ACTIVITY_TYPES,
  MAX_PAGE_SIZE,
  SYSTEM_ACTIVITY_TYPES,
} from './lead.constants';

/**
 * Request schemas for the lead engine.
 *
 * Zod strips undeclared keys, so a capture payload carrying `"status": "WON"`
 * or `"assignedToId"` has those discarded rather than honoured — which matters
 * more here than anywhere else in the API, because capture accepts data from
 * the open internet.
 */

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

/** Trims, then treats an emptied string as absent — HTML forms post `""`. */
const formText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Must be a valid email address')
  .max(255);

/**
 * Deliberately permissive: a lead's phone number arrives however the source
 * formatted it, and rejecting "+91 98765 43210" at the door loses a real
 * customer to satisfy a regex. Only obvious rubbish is refused.
 */
const phoneSchema = z
  .string()
  .trim()
  .min(6, 'Phone number is too short')
  .max(32)
  .regex(/^[+()\d][\d\s()+-]*$/, 'Phone number may only contain digits, spaces and + ( ) -');

const urlSchema = z.string().trim().url('Must be a valid URL').max(2048);

/** 14,2 in the database — the largest value that column can hold. */
const MAX_DEAL_VALUE = 999_999_999_999.99;

const estimatedValueSchema = z
  .number()
  .nonnegative('Estimated value cannot be negative')
  .max(MAX_DEAL_VALUE, 'Estimated value is too large')
  .refine(
    (value) => Number.isFinite(value) && Math.round(value * 100) === value * 100,
    'Estimated value may have at most 2 decimal places',
  );

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, 'Currency must be a 3-letter ISO 4217 code')
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code');

/** Attribution accepted from any source. All optional — most forms send none. */
const attributionFields = {
  campaign: formText(200),
  landingPage: formText(2048),
  utmSource: formText(200),
  utmMedium: formText(200),
  utmCampaign: formText(200),
  utmTerm: formText(200),
  utmContent: formText(200),
  referrer: formText(2048),
};

const contactFields = {
  firstName: formText(100),
  lastName: formText(100),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  whatsapp: phoneSchema.optional(),
  company: formText(200),
  jobTitle: formText(150),
  website: urlSchema.optional(),
};

/**
 * A lead nobody can be reached at is not a lead — it is a row that will sit in
 * the pipeline forever, be counted in every funnel, and never convert. Rejected
 * at the boundary rather than left for a salesperson to discover.
 */
const hasContactDetail = (value: {
  email?: string | undefined;
  phone?: string | undefined;
  whatsapp?: string | undefined;
}): boolean => Boolean(value.email ?? value.phone ?? value.whatsapp);

const CONTACT_REQUIRED = 'Provide at least one of email, phone or whatsapp';

export const createLeadSchema = z
  .object({
    ...contactFields,
    ...attributionFields,

    /** Either identifies an existing source, or names the channel to fall back to. */
    sourceId: z.string().uuid('Must be a valid UUID').optional(),
    sourceKey: optionalText(60),
    channel: z.nativeEnum(LeadChannel).optional(),

    /** The source system's own id, which makes repeated delivery idempotent. */
    externalId: optionalText(200),

    stageId: z.string().uuid('Must be a valid UUID').optional(),
    stageKey: optionalText(60),

    assignedToId: z.string().uuid('Must be a valid UUID').optional(),

    estimatedValue: estimatedValueSchema.optional(),
    currency: currencySchema.optional(),
    notes: formText(5000),

    /**
     * When the lead actually arrived. Supplied by imports and replayed
     * webhooks; defaults to now. A future date is refused — it would park the
     * lead outside every report until the clock caught up.
     */
    capturedAt: z.coerce
      .date()
      .refine((value) => value.getTime() <= Date.now() + 60_000, 'capturedAt cannot be in the future')
      .optional(),
  })
  .refine(hasContactDetail, { message: CONTACT_REQUIRED, path: ['email'] });

/**
 * The integration endpoint's schema.
 *
 * Looser than `createLeadSchema` in one direction and stricter in another: a
 * webhook names a `channel` rather than knowing source uuids, and it may not
 * choose a stage, an owner or a status. Every captured lead starts at the top
 * of the pipeline, which is the only way the funnel's first number means
 * anything.
 */
export const captureLeadSchema = z
  .object({
    ...contactFields,
    ...attributionFields,

    channel: z.nativeEnum(LeadChannel).default(LeadChannel.OTHER),
    sourceKey: optionalText(60),
    externalId: optionalText(200),

    estimatedValue: estimatedValueSchema.optional(),
    currency: currencySchema.optional(),
    notes: formText(5000),
    capturedAt: z.coerce
      .date()
      .refine((value) => value.getTime() <= Date.now() + 60_000, 'capturedAt cannot be in the future')
      .optional(),
  })
  .refine(hasContactDetail, { message: CONTACT_REQUIRED, path: ['email'] });

export const updateLeadSchema = z
  .object({
    ...contactFields,
    ...attributionFields,
    estimatedValue: estimatedValueSchema.nullable().optional(),
    currency: currencySchema.optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    lostReason: z.string().trim().max(500).nullable().optional(),
    sourceId: z.string().uuid('Must be a valid UUID').optional(),
  })
  // `stageId`, `status`, `assignedToId` and every milestone are absent on
  // purpose. Each has a dedicated endpoint that writes a timeline entry;
  // allowing them here would let the pipeline move with no record of who moved
  // it or when, which is the one thing this module exists to prevent.
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const assignLeadSchema = z.object({
  /** `null` unassigns — an explicit act, distinct from omitting the field. */
  assignedToId: z.string().uuid('Must be a valid UUID').nullable(),
  note: z.string().trim().max(500).optional(),
});

export const changeStageSchema = z
  .object({
    stageId: z.string().uuid('Must be a valid UUID').optional(),
    stageKey: optionalText(60),
    /** Required by the service when the target stage is of type LOST. */
    lostReason: z.string().trim().max(500).optional(),
    note: z.string().trim().max(500).optional(),
    /** Backdating a move, for imports catching a pipeline up. */
    occurredAt: z.coerce.date().optional(),
  })
  .refine(
    (value) => Boolean(value.stageId ?? value.stageKey),
    'Provide either stageId or stageKey',
  );

export const createActivitySchema = z.object({
  type: z.nativeEnum(LeadActivityType).refine(
    (type) => !SYSTEM_ACTIVITY_TYPES.includes(type),
    `Reserved for system events. Use one of: ${LOGGABLE_ACTIVITY_TYPES.join(', ')}`,
  ),
  /**
   * Defaults to OUTBOUND rather than INTERNAL: someone logging a call almost
   * always means a call they made, and defaulting to INTERNAL would silently
   * drop it out of the contacted count.
   */
  direction: z.nativeEnum(LeadActivityDirection).default(LeadActivityDirection.OUTBOUND),
  subject: optionalText(200),
  body: z.string().trim().max(10_000).optional(),
  durationMinutes: z.number().int().nonnegative().max(24 * 60).optional(),
  occurredAt: z.coerce
    .date()
    .refine((value) => value.getTime() <= Date.now() + 60_000, 'occurredAt cannot be in the future')
    .optional(),
});

/** Comma-separated repeatable filter, e.g. `?status=WON,LOST`. */
const csvEnum = <T extends Record<string, string>>(values: T) =>
  z
    .string()
    .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(z.nativeEnum(values)).min(1))
    .optional();

export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  /** Matches name, company, email and phone. */
  search: z.string().trim().min(1).max(100).optional(),

  status: csvEnum(LeadStatus),
  channel: csvEnum(LeadChannel),
  stageId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  /** Mutually exclusive with `assignedToId`; the service rejects both together. */
  unassigned: z.coerce.boolean().optional(),

  capturedFrom: z.coerce.date().optional(),
  capturedTo: z.coerce.date().optional(),

  /**
   * Open leads whose last activity is older than N days — the queue a manager
   * actually works from. `0` means "never touched since capture".
   */
  staleForDays: z.coerce.number().int().nonnegative().max(3650).optional(),

  sort: z
    .enum(['capturedAt', 'lastActivityAt', 'estimatedValue', 'updatedAt'])
    .default('capturedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const listActivitiesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  type: csvEnum(LeadActivityType),
  direction: csvEnum(LeadActivityDirection),
  /** Hides CREATED/ASSIGNED/STAGE_CHANGED, leaving only human-logged work. */
  excludeSystem: z.coerce.boolean().default(false),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/** Shared by the funnel and the breakdown reports. */
export const analyticsQuerySchema = z.object({
  capturedFrom: z.coerce.date().optional(),
  capturedTo: z.coerce.date().optional(),
  sourceId: z.string().uuid().optional(),
  channel: csvEnum(LeadChannel),
  assignedToId: z.string().uuid().optional(),
  /** Splits the funnel by source, owner or channel instead of returning one. */
  groupBy: z.enum(['none', 'source', 'channel', 'owner']).default('none'),
});

export const leadIdParamSchema = z.object({
  id: z.string().uuid('Must be a valid UUID'),
});

// --- Pipeline configuration -------------------------------------------------

export const createLeadSourceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  channel: z.nativeEnum(LeadChannel),
  key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'Key must be lowercase words separated by underscores')
    .optional(),
  description: z.string().trim().max(500).optional(),
});

export const updateLeadSourceSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  // `key` and `channel` are immutable: integrations address a source by key,
  // and rewriting the channel would retroactively re-attribute every lead that
  // ever came through it.
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const createLeadStageSchema = z.object({
  name: z.string().trim().min(2).max(100),
  key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'Key must be lowercase words separated by underscores')
    .optional(),
  description: z.string().trim().max(500).optional(),
  position: z.number().int().positive().max(1000).optional(),
  type: z.nativeEnum(LeadStageType).default(LeadStageType.OPEN),
});

export const updateLeadStageSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    position: z.number().int().positive().max(1000).optional(),
  })
  // `type` is immutable: flipping a stage from OPEN to WON would silently
  // reclassify every lead sitting in it as revenue.
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const listLeadSourcesQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
  channel: csvEnum(LeadChannel),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type CaptureLeadInput = z.infer<typeof captureLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type AssignLeadInput = z.infer<typeof assignLeadSchema>;
export type ChangeStageInput = z.infer<typeof changeStageSchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type CreateLeadSourceInput = z.infer<typeof createLeadSourceSchema>;
export type UpdateLeadSourceInput = z.infer<typeof updateLeadSourceSchema>;
export type CreateLeadStageInput = z.infer<typeof createLeadStageSchema>;
export type UpdateLeadStageInput = z.infer<typeof updateLeadStageSchema>;
export type ListLeadSourcesQuery = z.infer<typeof listLeadSourcesQuerySchema>;
