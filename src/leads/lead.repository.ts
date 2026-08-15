import {
  LeadStatus,
  Prisma,
  type LeadActivity,
  type LeadActivityDirection,
  type LeadActivityType,
  type LeadChannel,
  type LeadSource,
  type LeadStage,
} from '@prisma/client';
import { prisma } from '../config/prisma';
import { CONVERSATION_ACTIVITY_TYPES, DEFAULT_SOURCES, DEFAULT_STAGES } from './lead.constants';

/** All lead-engine table access. Nothing above this file writes SQL. */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const ownerSelect = { id: true, name: true, email: true } satisfies Prisma.UserSelect;

const leadInclude = {
  source: true,
  stage: true,
  assignedTo: { select: ownerSelect },
  _count: { select: { activities: true } },
} satisfies Prisma.LeadInclude;

export type LeadWithRelations = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

const activityInclude = {
  createdBy: { select: ownerSelect },
} satisfies Prisma.LeadActivityInclude;

export type ActivityWithActor = Prisma.LeadActivityGetPayload<{
  include: typeof activityInclude;
}>;

export type SourceWithCounts = LeadSource & { _count: { leads: number } };
export type StageWithCounts = LeadStage & { _count: { leads: number } };

/** Anything that can run a query — the client, or a transaction handle. */
type Db = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// Pipeline provisioning
// ---------------------------------------------------------------------------

/**
 * Gives an organization the default sources and stages if it has none.
 *
 * Called on the paths that need a pipeline to exist rather than at
 * registration, which keeps the lead engine from reaching into the auth module.
 * `skipDuplicates` plus the `(organization_id, key)` unique index make it
 * idempotent and safe under concurrency: two simultaneous first captures
 * cannot produce two sets of stages.
 *
 * Organizations that predate this module were backfilled by the migration, so
 * in practice this is a cheap no-op after the first call.
 */
export async function ensureDefaults(organizationId: string, db: Db = prisma): Promise<void> {
  await db.leadStage.createMany({
    data: DEFAULT_STAGES.map((stage) => ({
      organizationId,
      key: stage.key,
      name: stage.name,
      description: stage.description,
      position: stage.position,
      type: stage.type,
      isSystem: true,
    })),
    skipDuplicates: true,
  });

  await db.leadSource.createMany({
    data: DEFAULT_SOURCES.map((source) => ({
      organizationId,
      key: source.key,
      name: source.name,
      channel: source.channel,
      description: source.description,
      isSystem: true,
    })),
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function findSourceById(
  organizationId: string,
  id: string,
): Promise<SourceWithCounts | null> {
  return prisma.leadSource.findFirst({
    where: { id, organizationId },
    include: { _count: { select: { leads: true } } },
  });
}

export async function findSourceByKey(
  organizationId: string,
  key: string,
  db: Db = prisma,
): Promise<LeadSource | null> {
  return db.leadSource.findUnique({ where: { organizationId_key: { organizationId, key } } });
}

export async function listSources(
  organizationId: string,
  options: { includeInactive: boolean; channel?: LeadChannel[] | undefined },
): Promise<SourceWithCounts[]> {
  return prisma.leadSource.findMany({
    where: {
      organizationId,
      ...(options.includeInactive ? {} : { isActive: true }),
      ...(options.channel ? { channel: { in: options.channel } } : {}),
    },
    include: { _count: { select: { leads: true } } },
    orderBy: [{ channel: 'asc' }, { name: 'asc' }],
  });
}

export async function createSource(input: {
  organizationId: string;
  key: string;
  name: string;
  channel: LeadChannel;
  description?: string | undefined;
}): Promise<LeadSource> {
  return prisma.leadSource.create({
    data: {
      organizationId: input.organizationId,
      key: input.key,
      name: input.name,
      channel: input.channel,
      description: input.description ?? null,
    },
  });
}

export async function updateSource(
  id: string,
  data: {
    name?: string | undefined;
    description?: string | null | undefined;
    isActive?: boolean | undefined;
  },
): Promise<SourceWithCounts> {
  return prisma.leadSource.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    include: { _count: { select: { leads: true } } },
  });
}

export async function deleteSource(id: string): Promise<void> {
  await prisma.leadSource.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export async function findStageById(
  organizationId: string,
  id: string,
): Promise<StageWithCounts | null> {
  return prisma.leadStage.findFirst({
    where: { id, organizationId },
    include: { _count: { select: { leads: true } } },
  });
}

export async function findStageByKey(
  organizationId: string,
  key: string,
  db: Db = prisma,
): Promise<LeadStage | null> {
  return db.leadStage.findUnique({ where: { organizationId_key: { organizationId, key } } });
}

export async function listStages(
  organizationId: string,
  db: Db = prisma,
): Promise<StageWithCounts[]> {
  return db.leadStage.findMany({
    where: { organizationId },
    include: { _count: { select: { leads: true } } },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });
}

export async function highestStagePosition(organizationId: string): Promise<number> {
  const top = await prisma.leadStage.aggregate({
    where: { organizationId },
    _max: { position: true },
  });
  return top._max.position ?? 0;
}

export async function createStage(input: {
  organizationId: string;
  key: string;
  name: string;
  description?: string | undefined;
  position: number;
  type: Prisma.LeadStageCreateInput['type'];
}): Promise<LeadStage> {
  return prisma.leadStage.create({
    data: {
      organizationId: input.organizationId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      position: input.position,
      type: input.type,
    },
  });
}

export async function updateStage(
  id: string,
  data: {
    name?: string | undefined;
    description?: string | null | undefined;
    position?: number | undefined;
  },
): Promise<StageWithCounts> {
  return prisma.leadStage.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.position !== undefined ? { position: data.position } : {}),
    },
    include: { _count: { select: { leads: true } } },
  });
}

export async function deleteStage(id: string): Promise<void> {
  await prisma.leadStage.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function findLeadById(
  organizationId: string,
  id: string,
  db: Db = prisma,
): Promise<LeadWithRelations | null> {
  return db.lead.findFirst({ where: { id, organizationId }, include: leadInclude });
}

/**
 * The idempotency lookup: the same source plus the same upstream id is the same
 * lead, however many times the webhook is delivered.
 */
export async function findLeadByExternalId(
  sourceId: string,
  externalId: string,
): Promise<LeadWithRelations | null> {
  return prisma.lead.findUnique({
    where: { sourceId_externalId: { sourceId, externalId } },
    include: leadInclude,
  });
}

/**
 * An open lead already reachable at this email or phone.
 *
 * Used by capture to keep a prospect who fills three forms in a week from
 * becoming three rows — which would otherwise triple the top of the funnel and
 * put three salespeople on the same person.
 *
 * Closed leads are excluded on purpose: someone who lost six months ago and
 * comes back is a new opportunity, not a continuation of the old one.
 */
export async function findOpenDuplicate(
  organizationId: string,
  identity: { email?: string | undefined; phone?: string | undefined; whatsapp?: string | undefined },
): Promise<LeadWithRelations | null> {
  const matches: Prisma.LeadWhereInput[] = [];
  if (identity.email) matches.push({ email: identity.email });
  if (identity.phone) matches.push({ phone: identity.phone }, { whatsapp: identity.phone });
  if (identity.whatsapp) matches.push({ whatsapp: identity.whatsapp }, { phone: identity.whatsapp });
  if (matches.length === 0) return null;

  return prisma.lead.findFirst({
    where: { organizationId, status: LeadStatus.OPEN, OR: matches },
    include: leadInclude,
    orderBy: { capturedAt: 'desc' },
  });
}

export interface ListLeadsOptions {
  organizationId: string;
  skip: number;
  take: number;
  search?: string | undefined;
  status?: LeadStatus[] | undefined;
  channel?: LeadChannel[] | undefined;
  stageId?: string | undefined;
  sourceId?: string | undefined;
  assignedToId?: string | undefined;
  unassigned?: boolean | undefined;
  capturedFrom?: Date | undefined;
  capturedTo?: Date | undefined;
  staleBefore?: Date | undefined;
  sort: 'capturedAt' | 'lastActivityAt' | 'estimatedValue' | 'updatedAt';
  order: 'asc' | 'desc';
}

export function buildLeadWhere(options: {
  organizationId: string;
  search?: string | undefined;
  status?: LeadStatus[] | undefined;
  channel?: LeadChannel[] | undefined;
  stageId?: string | undefined;
  sourceId?: string | undefined;
  assignedToId?: string | undefined;
  unassigned?: boolean | undefined;
  capturedFrom?: Date | undefined;
  capturedTo?: Date | undefined;
  staleBefore?: Date | undefined;
}): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [];

  if (options.search) {
    const contains = { contains: options.search, mode: 'insensitive' as const };
    and.push({
      OR: [
        { firstName: contains },
        { lastName: contains },
        { company: contains },
        { email: contains },
        { phone: { contains: options.search } },
        { whatsapp: { contains: options.search } },
      ],
    });
  }

  if (options.staleBefore) {
    // "Untouched since X" has to account for a lead nobody has logged anything
    // against, whose clock started at capture.
    and.push({
      OR: [
        { lastActivityAt: { lt: options.staleBefore } },
        { lastActivityAt: null, capturedAt: { lt: options.staleBefore } },
      ],
    });
  }

  return {
    organizationId: options.organizationId,
    ...(options.status ? { status: { in: options.status } } : {}),
    ...(options.channel ? { source: { channel: { in: options.channel } } } : {}),
    ...(options.stageId ? { stageId: options.stageId } : {}),
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    ...(options.unassigned ? { assignedToId: null } : {}),
    ...(options.assignedToId && !options.unassigned
      ? { assignedToId: options.assignedToId }
      : {}),
    ...(options.capturedFrom || options.capturedTo
      ? {
          capturedAt: {
            ...(options.capturedFrom ? { gte: options.capturedFrom } : {}),
            ...(options.capturedTo ? { lte: options.capturedTo } : {}),
          },
        }
      : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

export async function listLeads(
  options: ListLeadsOptions,
): Promise<{ leads: LeadWithRelations[]; total: number }> {
  const where = buildLeadWhere(options);

  const [leads, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      include: leadInclude,
      // Secondary key on id keeps pagination stable when the sort column ties —
      // without it, page 2 can repeat or skip rows from page 1.
      orderBy: [{ [options.sort]: options.order }, { id: 'asc' }],
      skip: options.skip,
      take: options.take,
    }),
    prisma.lead.count({ where }),
  ]);

  return { leads, total };
}

export async function createLead(
  data: Prisma.LeadUncheckedCreateInput,
  db: Db = prisma,
): Promise<LeadWithRelations> {
  return db.lead.create({ data, include: leadInclude });
}

export async function updateLead(
  id: string,
  data: Prisma.LeadUncheckedUpdateInput,
  db: Db = prisma,
): Promise<LeadWithRelations> {
  return db.lead.update({ where: { id }, data, include: leadInclude });
}

export async function deleteLead(id: string): Promise<void> {
  await prisma.lead.delete({ where: { id } });
}

export async function countLeadsInStage(stageId: string): Promise<number> {
  return prisma.lead.count({ where: { stageId } });
}

export async function countLeadsFromSource(sourceId: string): Promise<number> {
  return prisma.lead.count({ where: { sourceId } });
}

/**
 * A user who may own a lead in this organization.
 *
 * Tenant-filtered rather than a plain lookup by id: assigning to a user id
 * from another tenant would both confirm that account exists and hand them a
 * lead they can never see.
 */
export async function findAssignableUser(
  organizationId: string,
  userId: string,
): Promise<{ id: string } | null> {
  return prisma.user.findFirst({
    where: { id: userId, organizationId, isActive: true },
    select: { id: true },
  });
}

/** Names for the owner column of a grouped report. */
export async function findUsersByIds(
  organizationId: string,
  ids: string[],
): Promise<{ id: string; name: string | null; email: string }[]> {
  if (ids.length === 0) return [];
  return prisma.user.findMany({
    where: { organizationId, id: { in: ids } },
    select: ownerSelect,
  });
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export async function createActivity(
  data: Prisma.LeadActivityUncheckedCreateInput,
  db: Db = prisma,
): Promise<LeadActivity> {
  return db.leadActivity.create({ data });
}

export interface ListActivitiesOptions {
  leadId: string;
  skip: number;
  take: number;
  type?: Prisma.LeadActivityWhereInput['type'] | undefined;
  direction?: Prisma.LeadActivityWhereInput['direction'] | undefined;
  excludeTypes?: readonly Prisma.LeadActivityCreateInput['type'][] | undefined;
  order: 'asc' | 'desc';
}

export async function listActivities(
  options: ListActivitiesOptions,
): Promise<{ activities: ActivityWithActor[]; total: number }> {
  const where: Prisma.LeadActivityWhereInput = {
    leadId: options.leadId,
    ...(options.type ? { type: options.type } : {}),
    ...(options.direction ? { direction: options.direction } : {}),
    ...(options.excludeTypes && options.excludeTypes.length > 0
      ? { NOT: { type: { in: [...options.excludeTypes] } } }
      : {}),
  };

  const [activities, total] = await prisma.$transaction([
    prisma.leadActivity.findMany({
      where,
      include: activityInclude,
      orderBy: [{ occurredAt: options.order }, { createdAt: options.order }],
      skip: options.skip,
      take: options.take,
    }),
    prisma.leadActivity.count({ where }),
  ]);

  return { activities, total };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface FunnelAggregate {
  captured: number;
  assigned: number;
  contacted: number;
  replied: number;
  meeting: number;
  quotation: number;
  won: number;
  lost: number;
  open: number;
  estimatedValue: number;
  wonValue: number;
}

/**
 * The whole funnel in three round trips.
 *
 * Prisma's `_count` over a nullable column counts the non-null rows, which is
 * exactly what a write-once milestone column means: "this many leads ever
 * reached this point". No per-lead scan, no activity replay — the counts are
 * index reads over the columns the journey engine maintains.
 */
export async function funnelAggregate(
  where: Prisma.LeadWhereInput,
): Promise<FunnelAggregate> {
  // Counted per status rather than grouped: three indexed counts on
  // (organization_id, status) are as cheap as one grouped scan, and the result
  // needs no post-processing to answer "how many are open".
  const [totals, won, lost, open] = await prisma.$transaction([
    prisma.lead.aggregate({
      where,
      _count: {
        _all: true,
        assignedAt: true,
        firstContactAt: true,
        firstReplyAt: true,
        meetingBookedAt: true,
        quotationSentAt: true,
      },
      _sum: { estimatedValue: true },
    }),
    prisma.lead.aggregate({
      where: { ...where, status: LeadStatus.WON },
      _count: { _all: true },
      _sum: { estimatedValue: true },
    }),
    prisma.lead.count({ where: { ...where, status: LeadStatus.LOST } }),
    prisma.lead.count({ where: { ...where, status: LeadStatus.OPEN } }),
  ]);

  return {
    captured: totals._count._all,
    assigned: totals._count.assignedAt,
    contacted: totals._count.firstContactAt,
    replied: totals._count.firstReplyAt,
    meeting: totals._count.meetingBookedAt,
    quotation: totals._count.quotationSentAt,
    won: won._count._all,
    lost,
    open,
    estimatedValue: Number(totals._sum.estimatedValue ?? 0),
    wonValue: Number(won._sum.estimatedValue ?? 0),
  };
}

export interface GroupedFunnelRow extends FunnelAggregate {
  key: string | null;
}

/**
 * The same aggregate, split by source or owner.
 *
 * Two grouped queries rather than one per group: the number of sources or
 * salespeople is unbounded, and a query per row is how a reports page starts
 * timing out in the second month of use.
 */
export async function funnelAggregateGrouped(
  where: Prisma.LeadWhereInput,
  by: 'sourceId' | 'assignedToId',
): Promise<GroupedFunnelRow[]> {
  const [totals, byStatus] = await Promise.all([
    prisma.lead.groupBy({
      by: [by],
      where,
      _count: {
        _all: true,
        assignedAt: true,
        firstContactAt: true,
        firstReplyAt: true,
        meetingBookedAt: true,
        quotationSentAt: true,
      },
      _sum: { estimatedValue: true },
    }),
    prisma.lead.groupBy({
      by: [by, 'status'],
      where,
      _count: true,
      _sum: { estimatedValue: true },
      orderBy: { status: 'asc' },
    }),
  ]);

  return totals.map((row) => {
    const key = row[by];
    const statuses = byStatus.filter((entry) => entry[by] === key);
    const forStatus = (status: LeadStatus): { count: number; value: number } => {
      const match = statuses.find((entry) => entry.status === status);
      return { count: match?._count ?? 0, value: Number(match?._sum.estimatedValue ?? 0) };
    };

    const won = forStatus(LeadStatus.WON);

    return {
      key,
      captured: row._count._all,
      assigned: row._count.assignedAt,
      contacted: row._count.firstContactAt,
      replied: row._count.firstReplyAt,
      meeting: row._count.meetingBookedAt,
      quotation: row._count.quotationSentAt,
      won: won.count,
      lost: forStatus(LeadStatus.LOST).count,
      open: forStatus(LeadStatus.OPEN).count,
      estimatedValue: Number(row._sum.estimatedValue ?? 0),
      wonValue: won.value,
    };
  });
}

/** Average hours from capture to first contact, and from contact to reply. */
export async function responseTimes(
  where: Prisma.LeadWhereInput,
): Promise<{ contactedCount: number; repliedCount: number; rows: { capturedAt: Date; firstContactAt: Date | null; firstReplyAt: Date | null }[] }> {
  // Averaging a timestamp difference is not expressible through Prisma's
  // aggregate API, and the alternative is raw SQL that would then need its own
  // tenant-filter review. The projection is three date columns over leads that
  // reached contact, which stays small relative to the table.
  const rows = await prisma.lead.findMany({
    where: { ...where, firstContactAt: { not: null } },
    select: { capturedAt: true, firstContactAt: true, firstReplyAt: true },
  });

  return {
    contactedCount: rows.length,
    repliedCount: rows.filter((row) => row.firstReplyAt !== null).length,
    rows,
  };
}

/** Current occupancy of the board — how many leads sit in each stage now. */
export async function countByStage(
  where: Prisma.LeadWhereInput,
): Promise<{ stageId: string; count: number; value: number }[]> {
  const rows = await prisma.lead.groupBy({
    by: ['stageId'],
    where,
    _count: { _all: true },
    _sum: { estimatedValue: true },
  });

  return rows.map((row) => ({
    stageId: row.stageId,
    count: row._count._all,
    value: Number(row._sum.estimatedValue ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Leakage
// ---------------------------------------------------------------------------

/**
 * Every lead matching a leakage report's filters, with the relations the
 * rule engine needs. Unpaginated on purpose: a leakage sweep has to see every
 * candidate to count correctly, not just one page of them.
 */
export async function listLeadsForLeakage(
  where: Prisma.LeadWhereInput,
): Promise<LeadWithRelations[]> {
  return prisma.lead.findMany({ where, include: leadInclude });
}

/**
 * The timestamp each lead most recently changed stage, keyed by lead id.
 *
 * Prisma has no "latest row per group" query, so this is the one place the
 * lead engine reaches for raw SQL. `DISTINCT ON` is Postgres-specific, which
 * this app already commits to elsewhere (`DECIMAL`, the migration tooling).
 * Values are bound through `Prisma.sql`/`Prisma.join`, never interpolated, so
 * this carries no injection risk despite being raw text.
 *
 * A lead absent from the result never had a `STAGE_CHANGED` entry — the
 * caller falls back to `capturedAt` for those.
 */
export async function latestStageChangeByLead(
  organizationId: string,
  leadIds: string[],
): Promise<Map<string, Date>> {
  if (leadIds.length === 0) return new Map();

  // Postgres has no implicit cast from the driver's text-typed bind parameters
  // to `uuid`, so the uuid columns are cast to text for comparison instead.
  const rows = await prisma.$queryRaw<{ leadId: string; occurredAt: Date }[]>(Prisma.sql`
    SELECT DISTINCT ON (lead_id) lead_id AS "leadId", occurred_at AS "occurredAt"
    FROM lead_activities
    WHERE organization_id::text = ${organizationId}
      AND type = 'STAGE_CHANGED'
      AND lead_id::text IN (${Prisma.join(leadIds)})
    ORDER BY lead_id, occurred_at DESC
  `);

  return new Map(rows.map((row) => [row.leadId, row.occurredAt]));
}

export interface SourceCaptureStats {
  id: string;
  key: string;
  name: string;
  channel: LeadChannel;
  isActive: boolean;
  lastCapturedAt: Date | null;
  totalCaptured: number;
}

/**
 * Every source in the organization, with when it last captured a lead —
 * deliberately independent of a report's own date filters. "Has this channel
 * gone quiet" is an absolute-time question; folding a report's
 * `capturedFrom`/`capturedTo` into it would make an old date filter look
 * exactly like a broken integration.
 */
export async function sourceCaptureStats(organizationId: string): Promise<SourceCaptureStats[]> {
  const [sources, captures] = await Promise.all([
    prisma.leadSource.findMany({ where: { organizationId } }),
    prisma.lead.groupBy({
      by: ['sourceId'],
      where: { organizationId },
      _max: { capturedAt: true },
      _count: { _all: true },
    }),
  ]);

  const statsBySourceId = new Map(captures.map((row) => [row.sourceId, row]));

  return sources.map((source) => {
    const stats = statsBySourceId.get(source.id);
    return {
      id: source.id,
      key: source.key,
      name: source.name,
      channel: source.channel,
      isActive: source.isActive,
      lastCapturedAt: stats?._max.capturedAt ?? null,
      totalCaptured: stats?._count._all ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Response times
// ---------------------------------------------------------------------------

export interface ConversationActivityRow {
  leadId: string;
  type: LeadActivityType;
  direction: LeadActivityDirection;
  occurredAt: Date;
}

/**
 * The conversation-relevant activities for a set of leads, ordered so a
 * caller can scan each lead's timeline forward in one pass.
 *
 * Three of the six response-time metrics — reply → salesperson response,
 * meeting → follow-up, quote → follow-up — ask "what happened next", which a
 * milestone column cannot answer: `lastFollowUpAt` is the *latest* follow-up,
 * not the one that came right after a specific meeting or quote. There is no
 * SQL aggregate for "first row after timestamp X per lead", so the rows come
 * back raw and the scan happens in the service layer, the same trade-off
 * `responseTimes()` above already makes for milestone-to-milestone gaps.
 */
export async function listConversationActivities(
  where: Prisma.LeadWhereInput,
): Promise<ConversationActivityRow[]> {
  return prisma.leadActivity.findMany({
    where: { lead: where, type: { in: CONVERSATION_ACTIVITY_TYPES } },
    select: { leadId: true, type: true, direction: true, occurredAt: true },
    orderBy: [{ leadId: 'asc' }, { occurredAt: 'asc' }],
  });
}
