import type { Prisma } from '@prisma/client';
import { LeadActivityDirection, LeadActivityType, LeadStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../users/user.types';
import * as repository from './lead.repository';
import type { ConversationActivityRow } from './lead.repository';
import type { LeadWithRelations } from './lead.repository';
import {
  FIRST_RESPONSE_METRIC,
  RESPONSE_METRICS,
  average,
  computeLossCorrelation,
  formatDuration,
  intervalHours,
  median,
  rankSalespeople,
  type LossCorrelation,
  type ResponseMetricKey,
  type SalespersonRanking,
} from './response-time';
import type { ResponseTimeQuery } from './lead.validation';

/**
 * Response time intelligence.
 *
 * The six gaps and the ranking/correlation logic live in `response-time.ts`,
 * pure and unit-tested. This module is the same shape as `funnel.service.ts`
 * and `leakage.service.ts`: load what the pure functions need, run them, and
 * turn the result into a report.
 */

export interface SalespersonSummary {
  id: string;
  name: string | null;
  email: string;
  count: number;
  averageHours: number;
}

export interface ResponseMetricReport {
  key: ResponseMetricKey;
  label: string;
  count: number;
  averageHours: number | null;
  medianHours: number | null;
  attributedToSalesperson: boolean;
  /** Present only when `attributedToSalesperson` — every rep with a measured lead, fastest first. */
  bySalesperson?: SalespersonSummary[];
  best?: SalespersonSummary | null;
  worst?: SalespersonSummary | null;
}

export interface ResponseTimeReport {
  generatedAt: Date;
  metrics: ResponseMetricReport[];
  speedToLossCorrelation: LossCorrelation & { headline: string | null };
  headlines: string[];
}

function whereFromQuery(organizationId: string, query: ResponseTimeQuery): Prisma.LeadWhereInput {
  return repository.buildLeadWhere({
    organizationId,
    sourceId: query.sourceId,
    channel: query.channel,
    assignedToId: query.assignedToId,
    capturedFrom: query.capturedFrom,
    capturedTo: query.capturedTo,
  });
}

/** One lead's timeline, in order — the slice `findNextAfter` scans. */
type LeadTimeline = ConversationActivityRow[];

function groupByLead(rows: ConversationActivityRow[]): Map<string, LeadTimeline> {
  const byLead = new Map<string, LeadTimeline>();
  for (const row of rows) {
    const bucket = byLead.get(row.leadId) ?? [];
    bucket.push(row);
    byLead.set(row.leadId, bucket);
  }
  return byLead;
}

/** The first activity after `after` matching `predicate` — timelines are pre-sorted ascending. */
function findNextAfter(
  timeline: LeadTimeline,
  after: Date,
  predicate: (row: ConversationActivityRow) => boolean,
): ConversationActivityRow | null {
  for (const row of timeline) {
    if (row.occurredAt > after && predicate(row)) return row;
  }
  return null;
}

const isOutboundConversation = (row: ConversationActivityRow): boolean =>
  row.direction === LeadActivityDirection.OUTBOUND;
const isFollowUp = (row: ConversationActivityRow): boolean => row.type === LeadActivityType.FOLLOW_UP;

interface LeadIntervals {
  assignedToId: string | null;
  values: Partial<Record<ResponseMetricKey, number>>;
}

function computeIntervalsForLead(
  lead: LeadWithRelations,
  timeline: LeadTimeline,
): LeadIntervals {
  const values: Partial<Record<ResponseMetricKey, number>> = {};

  const capturedToAssigned = intervalHours(lead.capturedAt, lead.assignedAt);
  if (capturedToAssigned !== null) values.captured_to_assigned = capturedToAssigned;

  const assignedToFirstContact = intervalHours(lead.assignedAt, lead.firstContactAt);
  if (assignedToFirstContact !== null) values.assigned_to_first_contact = assignedToFirstContact;

  const firstContactToReply = intervalHours(lead.firstContactAt, lead.firstReplyAt);
  if (firstContactToReply !== null) values.first_contact_to_reply = firstContactToReply;

  if (lead.firstReplyAt) {
    const next = findNextAfter(timeline, lead.firstReplyAt, isOutboundConversation);
    const hours = next ? intervalHours(lead.firstReplyAt, next.occurredAt) : null;
    if (hours !== null) values.reply_to_salesperson_response = hours;
  }

  if (lead.meetingBookedAt) {
    const next = findNextAfter(timeline, lead.meetingBookedAt, isFollowUp);
    const hours = next ? intervalHours(lead.meetingBookedAt, next.occurredAt) : null;
    if (hours !== null) values.meeting_to_follow_up = hours;
  }

  if (lead.quotationSentAt) {
    const next = findNextAfter(timeline, lead.quotationSentAt, isFollowUp);
    const hours = next ? intervalHours(lead.quotationSentAt, next.occurredAt) : null;
    if (hours !== null) values.quote_to_follow_up = hours;
  }

  return { assignedToId: lead.assignedToId, values };
}

function toSummary(
  stat: { userId: string; count: number; averageHours: number },
  nameOf: Map<string, { name: string | null; email: string }>,
): SalespersonSummary {
  const user = nameOf.get(stat.userId);
  return {
    id: stat.userId,
    name: user?.name ?? null,
    email: user?.email ?? '',
    count: stat.count,
    averageHours: stat.averageHours,
  };
}

function toRankingSummaries(
  ranking: SalespersonRanking,
  nameOf: Map<string, { name: string | null; email: string }>,
): { bySalesperson: SalespersonSummary[]; best: SalespersonSummary | null; worst: SalespersonSummary | null } {
  return {
    bySalesperson: ranking.all.map((stat) => toSummary(stat, nameOf)),
    best: ranking.best ? toSummary(ranking.best, nameOf) : null,
    worst: ranking.worst ? toSummary(ranking.worst, nameOf) : null,
  };
}

function describeThreshold(hours: number): string {
  return Number.isInteger(hours) ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours}h`;
}

function lossHeadline(correlation: LossCorrelation): string | null {
  if (correlation.afterThreshold.count === 0) return null;
  const percent = Math.round(correlation.afterThreshold.lossRate * 100);
  return `${percent}% of leads contacted after ${describeThreshold(correlation.thresholdHours)} are being lost.`;
}

function buildHeadlines(metrics: ResponseMetricReport[], correlation: LossCorrelation): string[] {
  const headlines: string[] = [];

  const firstResponse = metrics.find((metric) => metric.key === FIRST_RESPONSE_METRIC);
  if (firstResponse?.averageHours !== null && firstResponse?.averageHours !== undefined) {
    headlines.push(`Average first response: ${formatDuration(firstResponse.averageHours)}`);
  }
  if (firstResponse?.best) {
    headlines.push(
      `Best salesperson: ${firstResponse.best.name ?? firstResponse.best.email} — ${formatDuration(firstResponse.best.averageHours)}`,
    );
  }
  if (firstResponse?.worst && firstResponse.worst.id !== firstResponse.best?.id) {
    headlines.push(
      `Worst salesperson: ${firstResponse.worst.name ?? firstResponse.worst.email} — ${formatDuration(firstResponse.worst.averageHours)}`,
    );
  }

  const correlationHeadline = lossHeadline(correlation);
  if (correlationHeadline) headlines.push(correlationHeadline);

  return headlines;
}

export async function getResponseTimeReport(
  user: AuthenticatedUser,
  query: ResponseTimeQuery,
): Promise<ResponseTimeReport> {
  await repository.ensureDefaults(user.organizationId);
  const where = whereFromQuery(user.organizationId, query);

  const [leads, activityRows] = await Promise.all([
    repository.listLeadsForLeakage(where),
    repository.listConversationActivities(where),
  ]);

  const timelines = groupByLead(activityRows);
  const perLead = leads.map((lead) => computeIntervalsForLead(lead, timelines.get(lead.id) ?? []));

  const salespersonIds = new Set(
    perLead.filter((entry) => entry.assignedToId).map((entry) => entry.assignedToId as string),
  );
  const users = await repository.findUsersByIds(user.organizationId, [...salespersonIds]);
  const nameOf = new Map(users.map((u) => [u.id, { name: u.name, email: u.email }]));

  const metrics: ResponseMetricReport[] = (Object.keys(RESPONSE_METRICS) as ResponseMetricKey[]).map(
    (key) => {
      const definition = RESPONSE_METRICS[key];
      const allValues = perLead
        .map((entry) => entry.values[key])
        .filter((value): value is number => value !== undefined);

      const report: ResponseMetricReport = {
        key,
        label: definition.label,
        count: allValues.length,
        averageHours: average(allValues),
        medianHours: median(allValues),
        attributedToSalesperson: definition.attributedToSalesperson,
      };

      if (definition.attributedToSalesperson) {
        const rows = perLead
          .filter((entry) => entry.assignedToId && entry.values[key] !== undefined)
          .map((entry) => ({ userId: entry.assignedToId as string, hours: entry.values[key] as number }));

        const ranking = rankSalespeople(rows, query.minSampleSize);
        Object.assign(report, toRankingSummaries(ranking, nameOf));
      }

      return report;
    },
  );

  const lossRows = leads
    .filter((lead) => lead.status === LeadStatus.WON || lead.status === LeadStatus.LOST)
    .map((lead) => ({
      hoursToFirstContact: intervalHours(lead.capturedAt, lead.firstContactAt),
      status: lead.status,
    }))
    .filter(
      (row): row is { hoursToFirstContact: number; status: LeadStatus } => row.hoursToFirstContact !== null,
    );

  const correlation = computeLossCorrelation(lossRows, query.contactSpeedThresholdHours);

  return {
    generatedAt: new Date(),
    metrics,
    speedToLossCorrelation: { ...correlation, headline: lossHeadline(correlation) },
    headlines: buildHeadlines(metrics, correlation),
  };
}
