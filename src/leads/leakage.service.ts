import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../users/user.types';
import {
  DEFAULT_LEAKAGE_THRESHOLDS,
  LEAK_RULES,
  detectDuplicateLeads,
  detectSilentSources,
  evaluateLead,
  type DuplicateGroup,
  type DuplicateMatchField,
  type LeakageLeadInput,
  type LeakageThresholds,
  type LeakHit,
  type LeakSeverity,
  type LeakType,
  type SilentSourceHit,
  type SilentSourceInput,
} from './lead-leakage';
import * as repository from './lead.repository';
import type { LeadWithRelations } from './lead.repository';
import { toLeadSourceSummary, toLeadStageSummary, type LeadSourceSummary, type LeadStageSummary } from './lead.serializer';
import type { LeakageQuery } from './lead.validation';

/**
 * Lead leakage detection.
 *
 * The rules themselves live in `lead-leakage.ts`, pure and unit-tested. This
 * module is the same shape as `funnel.service.ts`: it loads what the rules
 * need, runs them, and turns the result into a report — including the
 * headline strings a dashboard would put at the top of the page.
 */

export interface LeakLeadSummary {
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
  capturedAt: Date;
}

export interface LeakLeadEntry {
  /** Hours or days behind the flag — see `LEAK_RULES[type].unit`. */
  magnitude: number;
  lead: LeakLeadSummary;
}

export interface LeakGroup {
  type: LeakType;
  label: string;
  severity: LeakSeverity;
  /** e.g. "5+ days", "48+ hours" — the threshold actually used, in words. */
  thresholdDescription: string;
  count: number;
  atRiskValue: number;
  leads: LeakLeadEntry[];
  /** True when `count` exceeds how many leads are shown in `leads`. */
  hasMore: boolean;
}

export interface DuplicateLeakGroup {
  matchField: DuplicateMatchField;
  value: string;
  leads: LeakLeadSummary[];
}

export interface SilentSourceLeak {
  source: LeadSourceSummary;
  lastCapturedAt: Date | null;
  daysSinceLastCapture: number;
}

export interface LeakageSummary {
  totalOpenLeadsAtRisk: number;
  totalAtRiskValue: number;
  /** The most common currency among at-risk leads. `'MIXED'` if none dominates. */
  currency: string;
  rulesTripped: number;
}

export interface LeakageReport {
  generatedAt: Date;
  thresholds: LeakageThresholds;
  summary: LeakageSummary;
  headlines: string[];
  leaks: LeakGroup[];
  duplicates: DuplicateLeakGroup[];
  silentSources: SilentSourceLeak[];
  /**
   * Named honestly rather than silently omitted: "leads disappearing between
   * systems" and "ads leads never entering the CRM" both need visibility this
   * API does not have into an upstream system or an ad platform's own count.
   */
  outOfScope: string[];
}

const OUT_OF_SCOPE = [
  'Leads disappearing between systems, and ad leads that never reach the CRM: both require reconciling against an upstream delivery log or an ad platform\'s own lead count, which this API has no access to. "silentSources" below is the closest signal available from data already inside the CRM — an active channel that has gone quiet.',
];

function toAmount(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

function toLeakLeadSummary(lead: LeadWithRelations): LeakLeadSummary {
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
    capturedAt: lead.capturedAt,
  };
}

function toLeakageInput(
  lead: LeadWithRelations,
  stageEnteredAt: Date,
): LeakageLeadInput {
  return {
    id: lead.id,
    fullName: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || null,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    whatsapp: lead.whatsapp,
    estimatedValue: toAmount(lead.estimatedValue),
    currency: lead.currency,
    status: lead.status,
    lostReason: lead.lostReason,

    capturedAt: lead.capturedAt,
    assignedAt: lead.assignedAt,
    assignedToId: lead.assignedToId,
    assignedTo: lead.assignedTo
      ? { id: lead.assignedTo.id, name: lead.assignedTo.name, email: lead.assignedTo.email }
      : null,

    firstContactAt: lead.firstContactAt,
    firstReplyAt: lead.firstReplyAt,
    meetingBookedAt: lead.meetingBookedAt,
    quotationSentAt: lead.quotationSentAt,
    lastFollowUpAt: lead.lastFollowUpAt,
    followUpCount: lead.followUpCount,
    lastActivityAt: lead.lastActivityAt,
    closedAt: lead.closedAt,

    stage: lead.stage
      ? { id: lead.stage.id, key: lead.stage.key, name: lead.stage.name, type: lead.stage.type }
      : null,
    stageEnteredAt,

    source: lead.source
      ? { id: lead.source.id, key: lead.source.key, name: lead.source.name, channel: lead.source.channel }
      : null,
  };
}

function resolveThresholds(query: LeakageQuery): LeakageThresholds {
  return {
    assignedTooLongHours: query.assignedTooLongHours ?? DEFAULT_LEAKAGE_THRESHOLDS.assignedTooLongHours,
    lateContactHours: query.lateContactHours ?? DEFAULT_LEAKAGE_THRESHOLDS.lateContactHours,
    noFollowUpDays: query.noFollowUpDays ?? DEFAULT_LEAKAGE_THRESHOLDS.noFollowUpDays,
    quoteStaleDays: query.quoteStaleDays ?? DEFAULT_LEAKAGE_THRESHOLDS.quoteStaleDays,
    meetingStaleDays: query.meetingStaleDays ?? DEFAULT_LEAKAGE_THRESHOLDS.meetingStaleDays,
    hotInactiveDays: query.hotInactiveDays ?? DEFAULT_LEAKAGE_THRESHOLDS.hotInactiveDays,
    stuckInStageDays: query.stuckInStageDays ?? DEFAULT_LEAKAGE_THRESHOLDS.stuckInStageDays,
    silentSourceDays: query.silentSourceDays ?? DEFAULT_LEAKAGE_THRESHOLDS.silentSourceDays,
  };
}

function thresholdDescription(type: LeakType, thresholds: LeakageThresholds): string {
  const unit = LEAK_RULES[type].unit;
  const value =
    type === 'lost_without_reason'
      ? null
      : {
          assigned_not_contacted: thresholds.assignedTooLongHours,
          late_first_contact: thresholds.lateContactHours,
          no_followup_after_contact: thresholds.noFollowUpDays,
          quote_sent_no_followup: thresholds.quoteStaleDays,
          meeting_no_next_step: thresholds.meetingStaleDays,
          hot_lead_gone_cold: thresholds.hotInactiveDays,
          stuck_with_salesperson: thresholds.stuckInStageDays,
          lost_without_reason: 0,
        }[type];

  return value === null ? 'no reason recorded' : `${value}+ ${unit}`;
}

/** Rounded to one decimal so a headline reads "8.4L", not "8.421739L". */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * "₹8.4L" / "₹1.2 Cr" for INR, so a headline reads the way an Indian sales
 * team actually talks about pipeline value. Anything else falls back to a
 * plain grouped number with its currency code.
 */
function formatMoney(value: number, currency: string): string {
  if (currency !== 'INR') {
    return `${currency} ${Math.round(value).toLocaleString('en-US')}`;
  }
  if (value >= 1_00_00_000) return `₹${round1(value / 1_00_00_000)} Cr`;
  if (value >= 1_00_000) return `₹${round1(value / 1_00_000)}L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

const HEADLINE_PHRASE: Record<LeakType, (count: number, threshold: string) => string> = {
  assigned_not_contacted: (n, t) => `${n} leads were assigned but never contacted (${t})`,
  late_first_contact: (n, t) => `${n} leads were contacted too late — first contact after ${t}`,
  no_followup_after_contact: (n, t) => `${n} leads have had no follow-up for ${t}`,
  quote_sent_no_followup: (n, t) => `${n} quotes were sent with no follow-up in ${t}`,
  meeting_no_next_step: (n, t) => `${n} meetings happened with no next step in ${t}`,
  hot_lead_gone_cold: (n, t) => `${n} hot leads have gone cold — no activity in ${t}`,
  stuck_with_salesperson: (n, t) => `${n} leads have been stuck with their salesperson for ${t}`,
  lost_without_reason: (n) => `${n} leads were marked lost with no reason recorded`,
};

const SEVERITY_RANK: Record<LeakSeverity, number> = { high: 0, medium: 1, low: 2 };

function buildHeadlines(
  leaks: LeakGroup[],
  duplicates: DuplicateLeakGroup[],
  silentSources: SilentSourceLeak[],
  summary: LeakageSummary,
): string[] {
  const ranked = [...leaks]
    .filter((group) => group.count > 0)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);

  const headlines = ranked
    .slice(0, 3)
    .map((group) => `🔴 ${HEADLINE_PHRASE[group.type](group.count, group.thresholdDescription)}`);

  const duplicateLeadCount = new Set(duplicates.flatMap((group) => group.leads.map((lead) => lead.id))).size;
  if (duplicateLeadCount > 0) {
    headlines.push(`🔴 ${duplicateLeadCount} possible duplicate leads detected`);
  }

  if (silentSources.length > 0) {
    headlines.push(`🔴 ${silentSources.length} lead source(s) have gone silent`);
  }

  if (summary.totalAtRiskValue > 0) {
    headlines.push(
      `🔴 ${formatMoney(summary.totalAtRiskValue, summary.currency)} estimated pipeline is currently at risk`,
    );
  }

  return headlines;
}

function dominantCurrency(currencies: string[]): string {
  if (currencies.length === 0) return 'INR';
  const counts = new Map<string, number>();
  for (const currency of currencies) counts.set(currency, (counts.get(currency) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!top) return 'INR';
  return top[1] === currencies.length ? top[0] : 'MIXED';
}

function whereFromQuery(organizationId: string, query: LeakageQuery): Prisma.LeadWhereInput {
  return repository.buildLeadWhere({
    organizationId,
    sourceId: query.sourceId,
    channel: query.channel,
    assignedToId: query.assignedToId,
    capturedFrom: query.capturedFrom,
    capturedTo: query.capturedTo,
  });
}

export async function getLeakageReport(
  user: AuthenticatedUser,
  query: LeakageQuery,
): Promise<LeakageReport> {
  await repository.ensureDefaults(user.organizationId);
  const thresholds = resolveThresholds(query);
  const now = new Date();

  const where = whereFromQuery(user.organizationId, query);
  const leads = await repository.listLeadsForLeakage(where);

  const stageChangeMap = await repository.latestStageChangeByLead(
    user.organizationId,
    leads.map((lead) => lead.id),
  );

  const inputs = leads.map((lead) =>
    toLeakageInput(lead, stageChangeMap.get(lead.id) ?? lead.capturedAt),
  );
  const summaryById = new Map(leads.map((lead) => [lead.id, toLeakLeadSummary(lead)]));

  // Per-lead rules.
  const hitsByType = new Map<LeakType, LeakHit[]>();
  for (const input of inputs) {
    for (const hit of evaluateLead(input, now, thresholds)) {
      const bucket = hitsByType.get(hit.type) ?? [];
      bucket.push(hit);
      hitsByType.set(hit.type, bucket);
    }
  }

  const leaks: LeakGroup[] = (Object.keys(LEAK_RULES) as LeakType[]).map((type) => {
    const definition = LEAK_RULES[type];
    const hits = (hitsByType.get(type) ?? []).sort((a, b) => b.magnitude - a.magnitude);

    const entries: LeakLeadEntry[] = hits.slice(0, query.sampleSize).map((hit) => ({
      magnitude: hit.magnitude,
      lead: summaryById.get(hit.leadId) as LeakLeadSummary,
    }));

    const atRiskValue = definition.countsTowardRisk
      ? hits.reduce((sum, hit) => sum + (summaryById.get(hit.leadId)?.estimatedValue ?? 0), 0)
      : 0;

    return {
      type,
      label: definition.label,
      severity: definition.severity,
      thresholdDescription: thresholdDescription(type, thresholds),
      count: hits.length,
      atRiskValue,
      leads: entries,
      hasMore: hits.length > entries.length,
    };
  });

  // Duplicates.
  const duplicateGroups: DuplicateGroup[] = detectDuplicateLeads(inputs);
  const duplicates: DuplicateLeakGroup[] = duplicateGroups.map((group) => ({
    matchField: group.matchField,
    value: group.value,
    leads: group.leadIds.map((id) => summaryById.get(id) as LeakLeadSummary),
  }));

  // Silent sources.
  const sourceStats = await repository.sourceCaptureStats(user.organizationId);
  const silentInputs: SilentSourceInput[] = sourceStats.map((stat) => ({
    id: stat.id,
    key: stat.key,
    name: stat.name,
    channel: stat.channel,
    isActive: stat.isActive,
    lastCapturedAt: stat.lastCapturedAt,
    totalCaptured: stat.totalCaptured,
  }));
  const silentHitById = new Map(
    detectSilentSources(silentInputs, now, thresholds).map((hit) => [hit.sourceId, hit]),
  );
  const silentSources: SilentSourceLeak[] = sourceStats
    .filter((stat) => silentHitById.has(stat.id))
    .map((stat) => {
      const hit = silentHitById.get(stat.id) as SilentSourceHit;
      return {
        source: { id: stat.id, key: stat.key, name: stat.name, channel: stat.channel },
        lastCapturedAt: stat.lastCapturedAt,
        daysSinceLastCapture: hit.daysSinceLastCapture,
      };
    });

  // Summary: distinct leads across every value-bearing rule, plus duplicates.
  // Built from the raw hits, not the (possibly truncated) samples in `leaks`.
  const atRiskLeadIds = new Set<string>();
  for (const type of Object.keys(LEAK_RULES) as LeakType[]) {
    if (!LEAK_RULES[type].countsTowardRisk) continue;
    for (const hit of hitsByType.get(type) ?? []) atRiskLeadIds.add(hit.leadId);
  }
  for (const group of duplicateGroups) {
    for (const id of group.leadIds) atRiskLeadIds.add(id);
  }

  const atRiskValues = [...atRiskLeadIds]
    .map((id) => summaryById.get(id))
    .filter((lead): lead is LeakLeadSummary => Boolean(lead));

  const summary: LeakageSummary = {
    totalOpenLeadsAtRisk: atRiskLeadIds.size,
    totalAtRiskValue: atRiskValues.reduce((sum, lead) => sum + (lead.estimatedValue ?? 0), 0),
    currency: dominantCurrency(atRiskValues.map((lead) => lead.currency)),
    rulesTripped: leaks.filter((group) => group.count > 0).length + (duplicates.length > 0 ? 1 : 0) +
      (silentSources.length > 0 ? 1 : 0),
  };

  return {
    generatedAt: now,
    thresholds,
    summary,
    headlines: buildHeadlines(leaks, duplicates, silentSources, summary),
    leaks,
    duplicates,
    silentSources,
    outOfScope: OUT_OF_SCOPE,
  };
}

// Re-exported so callers (controller, OpenAPI examples) don't need to import
// two modules for one feature.
export { DEFAULT_LEAKAGE_THRESHOLDS };
export type { LeakageThresholds, LeakType, LeakSeverity };
