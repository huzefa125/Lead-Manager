import { LeadActivityType, LeadChannel, LeadStageType } from '@prisma/client';

/**
 * The default pipeline provisioned for every organization.
 *
 * These are *rows*, not code: once provisioned a tenant may rename, reorder,
 * add to or deactivate them freely. What is defined here is only the starting
 * shape, so a brand new organization can accept a lead before anyone has
 * configured anything.
 *
 * Keep in step with the backfill in
 * `prisma/migrations/20260814180000_lead_engine/migration.sql`.
 */

export interface StageSeed {
  key: string;
  name: string;
  description: string;
  position: number;
  type: LeadStageType;
}

/**
 * Mirrors the journey a lead actually travels:
 *
 *   New → Contacted → Replied → Meeting Booked → Quotation Sent → Follow-up
 *       → Won / Lost
 */
export const DEFAULT_STAGES: StageSeed[] = [
  { key: 'new', name: 'New', description: 'Captured, not yet worked.', position: 1, type: LeadStageType.OPEN },
  { key: 'contacted', name: 'Contacted', description: 'We have reached out at least once.', position: 2, type: LeadStageType.OPEN },
  { key: 'replied', name: 'Replied', description: 'The lead answered.', position: 3, type: LeadStageType.OPEN },
  { key: 'meeting', name: 'Meeting Booked', description: 'A call or demo is on the calendar.', position: 4, type: LeadStageType.OPEN },
  { key: 'quotation', name: 'Quotation Sent', description: 'Pricing is with the lead.', position: 5, type: LeadStageType.OPEN },
  { key: 'follow_up', name: 'Follow-up', description: 'Awaiting a decision; chasing.', position: 6, type: LeadStageType.OPEN },
  { key: 'won', name: 'Won', description: 'Closed won.', position: 7, type: LeadStageType.WON },
  { key: 'lost', name: 'Lost', description: 'Closed lost.', position: 8, type: LeadStageType.LOST },
];

/** The stage a lead lands in when nothing else is specified. */
export const DEFAULT_STAGE_KEY = 'new';

export interface SourceSeed {
  key: string;
  name: string;
  channel: LeadChannel;
  description: string;
}

/**
 * One default source per channel — the unified inbox out of the box.
 *
 * Finer granularity is the customer's to add: "Google Ads — Brand" and
 * "Google Ads — Competitor" are two sources over one channel, and only they
 * know that split matters.
 */
export const DEFAULT_SOURCES: SourceSeed[] = [
  { key: 'website_form', name: 'Website Form', channel: LeadChannel.WEBSITE_FORM, description: 'Forms embedded on your own site.' },
  { key: 'whatsapp', name: 'WhatsApp', channel: LeadChannel.WHATSAPP, description: 'WhatsApp Business enquiries.' },
  { key: 'instagram', name: 'Instagram', channel: LeadChannel.INSTAGRAM, description: 'Instagram lead ads and DMs.' },
  { key: 'facebook', name: 'Facebook', channel: LeadChannel.FACEBOOK, description: 'Facebook lead ads and Messenger.' },
  { key: 'google_ads', name: 'Google Ads', channel: LeadChannel.GOOGLE_ADS, description: 'Google lead form extensions and landing pages.' },
  { key: 'linkedin', name: 'LinkedIn', channel: LeadChannel.LINKEDIN, description: 'LinkedIn lead gen forms and InMail.' },
  { key: 'email', name: 'Email', channel: LeadChannel.EMAIL, description: 'Inbound email to a monitored mailbox.' },
  { key: 'phone', name: 'Phone', channel: LeadChannel.PHONE, description: 'Inbound calls and call-tracking logs.' },
  { key: 'crm_import', name: 'CRM Import', channel: LeadChannel.CRM_IMPORT, description: 'Bulk import from another CRM.' },
  { key: 'booking', name: 'Booking Page', channel: LeadChannel.BOOKING, description: 'Calendly and other self-serve booking forms.' },
  { key: 'referral', name: 'Referral', channel: LeadChannel.REFERRAL, description: 'Introduced by a customer or partner.' },
  { key: 'manual', name: 'Manual Entry', channel: LeadChannel.MANUAL, description: 'Typed in by a salesperson.' },
  { key: 'other', name: 'Other', channel: LeadChannel.OTHER, description: 'Anything without a dedicated source yet.' },
];

/** Where a lead lands when its integration names no source at all. */
export const FALLBACK_SOURCE_KEY = 'other';

/** Resolves the default source key for a channel — used by lead capture. */
export function defaultSourceKeyForChannel(channel: LeadChannel): string {
  return DEFAULT_SOURCES.find((source) => source.channel === channel)?.key ?? FALLBACK_SOURCE_KEY;
}

/**
 * Activity types the system writes itself.
 *
 * They live in the same table as user-logged work so the timeline is one
 * ordered query, but they are not accepted from the API — a client that could
 * forge a `STAGE_CHANGED` entry would make the audit trail worthless.
 */
export const SYSTEM_ACTIVITY_TYPES: LeadActivityType[] = [
  LeadActivityType.CREATED,
  LeadActivityType.ASSIGNED,
  LeadActivityType.STAGE_CHANGED,
  LeadActivityType.STATUS_CHANGED,
];

/** Types a client may log through `POST /api/leads/:id/activities`. */
export const LOGGABLE_ACTIVITY_TYPES: LeadActivityType[] = Object.values(LeadActivityType).filter(
  (type) => !SYSTEM_ACTIVITY_TYPES.includes(type),
);

/**
 * Conversation types — the ones that count as reaching or hearing from a lead.
 *
 * A `NOTE` is excluded on purpose: writing a note to yourself is not contact,
 * and counting it as such would inflate the top of the funnel with work that
 * never left the building.
 */
export const CONVERSATION_ACTIVITY_TYPES: LeadActivityType[] = [
  LeadActivityType.CALL,
  LeadActivityType.EMAIL,
  LeadActivityType.WHATSAPP,
  LeadActivityType.SMS,
  LeadActivityType.MEETING,
  LeadActivityType.QUOTATION,
  LeadActivityType.FOLLOW_UP,
];

/** Default page size for lead and activity listings. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
