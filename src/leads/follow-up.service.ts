import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../users/user.types';
import {
  DEFAULT_FOLLOW_UP_THRESHOLDS,
  evaluateFollowUp,
  type ConversationTurn,
  type FollowUpHit,
  type FollowUpThresholds,
  type FollowUpUrgency,
} from './follow-up';
import * as repository from './lead.repository';
import type { ConversationActivityRow, LeadWithRelations } from './lead.repository';
import { toLeadSourceSummary, toLeadStageSummary, type LeadSourceSummary, type LeadStageSummary } from './lead.serializer';
import type { FollowUpQuery } from './lead.validation';

/**
 * Follow-up failure detection.
 *
 * The state machine lives in `follow-up.ts`, pure and unit-tested. This
 * module loads what it needs and turns the result into the dashboard: how
 * many follow-ups are due today, overdue, and critical.
 */

export interface FollowUpLeadSummary {
  id: string;
  fullName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  estimatedValue: number | null;
  currency: string;
  assignedTo: { id: string; name: string | null; email: string } | null;
  stage: LeadStageSummary | null;
  source: LeadSourceSummary | null;
}

export interface FollowUpEntry {
  urgency: FollowUpUrgency;
  lastActivityAt: Date;
  dueAt: Date;
  daysSinceLastActivity: number;
  daysOverdue: number;
  lead: FollowUpLeadSummary;
}

export interface FollowUpGroup {
  urgency: FollowUpUrgency;
  count: number;
  atRiskValue: number;
  leads: FollowUpEntry[];
  hasMore: boolean;
}

export interface FollowUpDashboard {
  generatedAt: Date;
  thresholds: FollowUpThresholds;
  summary: {
    today: number;
    overdue: number;
    critical: number;
    totalDue: number;
    totalAtRiskValue: number;
  };
  groups: FollowUpGroup[];
  headlines: string[];
}

const URGENCIES: FollowUpUrgency[] = ['today', 'overdue', 'critical'];

function toAmount(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

function toLeadSummary(lead: LeadWithRelations): FollowUpLeadSummary {
  const parts = [lead.firstName, lead.lastName].filter(Boolean);
  return {
    id: lead.id,
    fullName: parts.length > 0 ? parts.join(' ') : null,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    estimatedValue: toAmount(lead.estimatedValue),
    currency: lead.currency,
    assignedTo: lead.assignedTo
      ? { id: lead.assignedTo.id, name: lead.assignedTo.name, email: lead.assignedTo.email }
      : null,
    stage: lead.stage ? toLeadStageSummary(lead.stage) : null,
    source: lead.source ? toLeadSourceSummary(lead.source) : null,
  };
}

function groupByLead(rows: ConversationActivityRow[]): Map<string, ConversationTurn[]> {
  const byLead = new Map<string, ConversationTurn[]>();
  for (const row of rows) {
    const bucket = byLead.get(row.leadId) ?? [];
    bucket.push({ direction: row.direction, occurredAt: row.occurredAt });
    byLead.set(row.leadId, bucket);
  }
  return byLead;
}

function resolveThresholds(query: FollowUpQuery): FollowUpThresholds {
  return {
    followUpAfterDays: query.followUpAfterDays ?? DEFAULT_FOLLOW_UP_THRESHOLDS.followUpAfterDays,
    criticalOverdueDays: query.criticalOverdueDays ?? DEFAULT_FOLLOW_UP_THRESHOLDS.criticalOverdueDays,
  };
}

function whereFromQuery(organizationId: string, query: FollowUpQuery): Prisma.LeadWhereInput {
  return repository.buildLeadWhere({
    organizationId,
    sourceId: query.sourceId,
    channel: query.channel,
    assignedToId: query.assignedToId,
  });
}

export async function getFollowUpDashboard(
  user: AuthenticatedUser,
  query: FollowUpQuery,
): Promise<FollowUpDashboard> {
  await repository.ensureDefaults(user.organizationId);
  const thresholds = resolveThresholds(query);
  const now = new Date();

  const where = whereFromQuery(user.organizationId, query);
  const [leads, activityRows] = await Promise.all([
    repository.listLeadsForLeakage(where),
    repository.listConversationActivities(where),
  ]);

  const timelines = groupByLead(activityRows);
  const summaryById = new Map(leads.map((lead) => [lead.id, toLeadSummary(lead)]));

  const hits: FollowUpHit[] = [];
  for (const lead of leads) {
    const hit = evaluateFollowUp(lead.id, lead.status, timelines.get(lead.id) ?? [], now, thresholds);
    if (hit) hits.push(hit);
  }

  const groups: FollowUpGroup[] = URGENCIES.map((urgency) => {
    const matching = hits
      .filter((hit) => hit.urgency === urgency)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    const entries: FollowUpEntry[] = matching.slice(0, query.sampleSize).map((hit) => ({
      urgency: hit.urgency,
      lastActivityAt: hit.lastActivityAt,
      dueAt: hit.dueAt,
      daysSinceLastActivity: hit.daysSinceLastActivity,
      daysOverdue: hit.daysOverdue,
      lead: summaryById.get(hit.leadId) as FollowUpLeadSummary,
    }));

    const atRiskValue = matching.reduce(
      (sum, hit) => sum + (summaryById.get(hit.leadId)?.estimatedValue ?? 0),
      0,
    );

    return { urgency, count: matching.length, atRiskValue, leads: entries, hasMore: matching.length > entries.length };
  });

  const countOf = (urgency: FollowUpUrgency): number =>
    groups.find((group) => group.urgency === urgency)?.count ?? 0;

  const summary = {
    today: countOf('today'),
    overdue: countOf('overdue'),
    critical: countOf('critical'),
    totalDue: hits.length,
    totalAtRiskValue: groups.reduce((sum, group) => sum + group.atRiskValue, 0),
  };

  return {
    generatedAt: now,
    thresholds,
    summary,
    groups,
    headlines: [
      `Today: ${summary.today}`,
      `Overdue: ${summary.overdue}`,
      `Critical: ${summary.critical}`,
    ],
  };
}
