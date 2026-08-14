import type { LeadChannel, LeadSource, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../users/user.types';
import {
  buildFunnel,
  findBiggestDropOff,
  type FunnelBreak,
  type FunnelCounts,
  type FunnelStep,
} from './lead.milestones';
import * as repository from './lead.repository';
import type { FunnelAggregate, GroupedFunnelRow } from './lead.repository';
import { toLeadStageSummary, type LeadStageSummary } from './lead.serializer';
import type { AnalyticsQuery } from './lead.validation';

/**
 * Reporting.
 *
 * The funnel is read straight off the milestone columns the journey engine
 * maintains — see `lead.milestones.ts` for why those columns exist. Nothing
 * here replays the activity table, so the cost of a report does not grow with
 * how hard the team has been working.
 */

export interface FunnelTotals {
  captured: number;
  open: number;
  won: number;
  lost: number;
  assigned: number;
  /** Captured but nobody owns it — the leak that never shows up in the funnel. */
  unassigned: number;
  winRate: number;
  estimatedValue: number;
  wonValue: number;
}

export interface ResponseTimes {
  averageHoursToFirstContact: number | null;
  /** Median as well as mean: one lead contacted after three weeks skews the mean. */
  medianHoursToFirstContact: number | null;
  averageHoursToFirstReply: number | null;
  medianHoursToFirstReply: number | null;
}

export interface StageOccupancy {
  stage: LeadStageSummary;
  count: number;
  value: number;
}

export interface FunnelGroup {
  key: string | null;
  label: string;
  funnel: FunnelStep[];
  break: FunnelBreak | null;
  totals: FunnelTotals;
}

export interface FunnelReport {
  totals: FunnelTotals;
  funnel: FunnelStep[];
  /** Where the journey breaks. `null` when nothing was lost anywhere. */
  break: FunnelBreak | null;
  responseTimes: ResponseTimes;
  byStage: StageOccupancy[];
  /** Present only when `groupBy` was requested. */
  groups?: FunnelGroup[];
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function toCounts(aggregate: FunnelAggregate): FunnelCounts {
  return {
    captured: aggregate.captured,
    contacted: aggregate.contacted,
    replied: aggregate.replied,
    meeting: aggregate.meeting,
    quotation: aggregate.quotation,
    won: aggregate.won,
  };
}

function toTotals(aggregate: FunnelAggregate): FunnelTotals {
  return {
    captured: aggregate.captured,
    open: aggregate.open,
    won: aggregate.won,
    lost: aggregate.lost,
    assigned: aggregate.assigned,
    unassigned: Math.max(0, aggregate.captured - aggregate.assigned),
    // Of the leads that reached a decision. Dividing by every lead captured
    // would report a falling win rate every time marketing has a good month.
    winRate: ratio(aggregate.won, aggregate.won + aggregate.lost),
    estimatedValue: aggregate.estimatedValue,
    wonValue: aggregate.wonValue,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
      : (sorted[middle] as number);
  return Math.round(value * 10) / 10;
}

const MS_PER_HOUR = 1000 * 60 * 60;

async function computeResponseTimes(where: Prisma.LeadWhereInput): Promise<ResponseTimes> {
  const { rows } = await repository.responseTimes(where);

  const toContact: number[] = [];
  const toReply: number[] = [];

  for (const row of rows) {
    if (!row.firstContactAt) continue;
    toContact.push((row.firstContactAt.getTime() - row.capturedAt.getTime()) / MS_PER_HOUR);
    if (row.firstReplyAt) {
      toReply.push((row.firstReplyAt.getTime() - row.firstContactAt.getTime()) / MS_PER_HOUR);
    }
  }

  return {
    averageHoursToFirstContact: average(toContact),
    medianHoursToFirstContact: median(toContact),
    averageHoursToFirstReply: average(toReply),
    medianHoursToFirstReply: median(toReply),
  };
}

function whereFromQuery(
  organizationId: string,
  query: AnalyticsQuery,
): Prisma.LeadWhereInput {
  return repository.buildLeadWhere({
    organizationId,
    sourceId: query.sourceId,
    channel: query.channel,
    assignedToId: query.assignedToId,
    capturedFrom: query.capturedFrom,
    capturedTo: query.capturedTo,
  });
}

function toGroup(row: GroupedFunnelRow, label: string): FunnelGroup {
  const funnel = buildFunnel(toCounts(row));
  return { key: row.key, label, funnel, break: findBiggestDropOff(funnel), totals: toTotals(row) };
}

/**
 * Folds source-level rows up to channels.
 *
 * Grouping by channel cannot be done in SQL here because the channel lives on
 * `lead_sources`, not on `leads` — and denormalizing it onto every lead so a
 * report could group by it would mean a source that changes channel silently
 * rewrites history.
 */
function foldByChannel(rows: GroupedFunnelRow[], sources: LeadSource[]): GroupedFunnelRow[] {
  const channelOf = new Map(sources.map((source) => [source.id, source.channel]));
  const merged = new Map<LeadChannel, GroupedFunnelRow>();

  for (const row of rows) {
    const channel = row.key ? channelOf.get(row.key) : undefined;
    if (!channel) continue;

    const current = merged.get(channel);
    if (!current) {
      merged.set(channel, { ...row, key: channel });
      continue;
    }

    merged.set(channel, {
      key: channel,
      captured: current.captured + row.captured,
      assigned: current.assigned + row.assigned,
      contacted: current.contacted + row.contacted,
      replied: current.replied + row.replied,
      meeting: current.meeting + row.meeting,
      quotation: current.quotation + row.quotation,
      won: current.won + row.won,
      lost: current.lost + row.lost,
      open: current.open + row.open,
      estimatedValue: current.estimatedValue + row.estimatedValue,
      wonValue: current.wonValue + row.wonValue,
    });
  }

  return [...merged.values()];
}

async function buildGroups(
  organizationId: string,
  where: Prisma.LeadWhereInput,
  groupBy: AnalyticsQuery['groupBy'],
): Promise<FunnelGroup[]> {
  if (groupBy === 'owner') {
    const rows = await repository.funnelAggregateGrouped(where, 'assignedToId');
    const ids = rows.map((row) => row.key).filter((key): key is string => key !== null);
    const users = await repository.findUsersByIds(organizationId, ids);
    const nameOf = new Map(users.map((user) => [user.id, user.name ?? user.email]));

    return rows
      .map((row) => toGroup(row, row.key ? (nameOf.get(row.key) ?? 'Unknown user') : 'Unassigned'))
      .sort((a, b) => b.totals.captured - a.totals.captured);
  }

  const rows = await repository.funnelAggregateGrouped(where, 'sourceId');
  const sources = await repository.listSources(organizationId, { includeInactive: true });

  if (groupBy === 'channel') {
    return foldByChannel(rows, sources)
      .map((row) => toGroup(row, String(row.key)))
      .sort((a, b) => b.totals.captured - a.totals.captured);
  }

  const nameOf = new Map(sources.map((source) => [source.id, source.name]));
  return rows
    .map((row) => toGroup(row, row.key ? (nameOf.get(row.key) ?? 'Unknown source') : 'No source'))
    .sort((a, b) => b.totals.captured - a.totals.captured);
}

/**
 * The report behind "127 received, 89 contacted, 54 replied, 31 meetings,
 * 18 quotations, 7 closed" — and, more usefully, the one line that says which
 * of those gaps is costing the most.
 */
export async function getFunnel(
  user: AuthenticatedUser,
  query: AnalyticsQuery,
): Promise<FunnelReport> {
  await repository.ensureDefaults(user.organizationId);
  const where = whereFromQuery(user.organizationId, query);

  const [aggregate, responseTimes, stageCounts, stages] = await Promise.all([
    repository.funnelAggregate(where),
    computeResponseTimes(where),
    repository.countByStage(where),
    repository.listStages(user.organizationId),
  ]);

  const funnel = buildFunnel(toCounts(aggregate));
  const countByStageId = new Map(stageCounts.map((row) => [row.stageId, row]));

  const byStage: StageOccupancy[] = stages.map((stage) => ({
    stage: toLeadStageSummary(stage),
    count: countByStageId.get(stage.id)?.count ?? 0,
    value: countByStageId.get(stage.id)?.value ?? 0,
  }));

  const report: FunnelReport = {
    totals: toTotals(aggregate),
    funnel,
    break: findBiggestDropOff(funnel),
    responseTimes,
    byStage,
  };

  if (query.groupBy !== 'none') {
    report.groups = await buildGroups(user.organizationId, where, query.groupBy);
  }

  return report;
}
