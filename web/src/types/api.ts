/**
 * The API's public shapes, mirrored from the server's serializers.
 *
 * Dates arrive as ISO strings over JSON, so every `Date` on the server is a
 * `string` here — that difference is the only intentional divergence.
 */

export type LeadChannel =
  | 'WEBSITE_FORM'
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'GOOGLE_ADS'
  | 'LINKEDIN'
  | 'EMAIL'
  | 'PHONE'
  | 'CRM_IMPORT'
  | 'BOOKING'
  | 'REFERRAL'
  | 'MANUAL'
  | 'OTHER'

export type LeadStageType = 'OPEN' | 'WON' | 'LOST'
export type LeadStatus = 'OPEN' | 'WON' | 'LOST'

export type LeadActivityType =
  | 'NOTE'
  | 'CALL'
  | 'EMAIL'
  | 'WHATSAPP'
  | 'SMS'
  | 'MEETING'
  | 'QUOTATION'
  | 'FOLLOW_UP'
  | 'TASK'
  | 'CREATED'
  | 'ASSIGNED'
  | 'STAGE_CHANGED'
  | 'STATUS_CHANGED'

export type LeadActivityDirection = 'INBOUND' | 'OUTBOUND' | 'INTERNAL'

/** The types a client may log — the system writes the rest itself. */
export const LOGGABLE_ACTIVITY_TYPES = [
  'NOTE',
  'CALL',
  'EMAIL',
  'WHATSAPP',
  'SMS',
  'MEETING',
  'QUOTATION',
  'FOLLOW_UP',
  'TASK',
] as const satisfies readonly LeadActivityType[]

export const LEAD_CHANNELS = [
  'WEBSITE_FORM',
  'WHATSAPP',
  'INSTAGRAM',
  'FACEBOOK',
  'GOOGLE_ADS',
  'LINKEDIN',
  'EMAIL',
  'PHONE',
  'CRM_IMPORT',
  'BOOKING',
  'REFERRAL',
  'MANUAL',
  'OTHER',
] as const satisfies readonly LeadChannel[]

// --- Auth & tenancy ---------------------------------------------------------

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
}

export interface PublicRole {
  id: string
  name: string
  displayName: string
  description: string | null
  isSystem: boolean
}

export interface PublicUser {
  id: string
  email: string
  name: string | null
  isActive: boolean
  organizationId: string
  organization?: OrganizationSummary
  roles: PublicRole[]
  permissions: string[]
  createdAt: string
  updatedAt: string
}

export interface SessionPayload {
  user: PublicUser
  accessToken: string
  tokenType: string
  /** Access-token lifetime in seconds. */
  expiresIn: number
}

export interface PublicRoleDetail extends PublicRole {
  permissions: string[]
  createdAt: string
  updatedAt: string
}

export interface PublicPermission {
  id: string
  action: string
  resource: string
  operation: string
  description: string | null
  isSystem: boolean
}

// --- Pipeline configuration -------------------------------------------------

export interface LeadSourceSummary {
  id: string
  key: string
  name: string
  channel: LeadChannel
}

export interface PublicLeadSource extends LeadSourceSummary {
  description: string | null
  isActive: boolean
  isSystem: boolean
  leadCount?: number
  createdAt: string
  updatedAt: string
}

export interface LeadStageSummary {
  id: string
  key: string
  name: string
  position: number
  type: LeadStageType
}

export interface PublicLeadStage extends LeadStageSummary {
  description: string | null
  isSystem: boolean
  leadCount?: number
  createdAt: string
  updatedAt: string
}

// --- Leads ------------------------------------------------------------------

export interface LeadOwnerSummary {
  id: string
  name: string | null
  email: string
}

export interface LeadJourney {
  capturedAt: string
  assignedAt: string | null
  firstContactAt: string | null
  firstReplyAt: string | null
  meetingBookedAt: string | null
  quotationSentAt: string | null
  lastFollowUpAt: string | null
  followUpCount: number
  closedAt: string | null
  nextStep: { key: string; label: string } | null
  hoursToFirstContact: number | null
  hoursToFirstReply: number | null
  daysToClose: number | null
}

export interface PublicLead {
  id: string
  firstName: string | null
  lastName: string | null
  fullName: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  company: string | null
  jobTitle: string | null
  website: string | null

  source: LeadSourceSummary | null
  channel: LeadChannel | null
  campaign: string | null
  landingPage: string | null
  utm: {
    source: string | null
    medium: string | null
    campaign: string | null
    term: string | null
    content: string | null
  }
  referrer: string | null
  externalId: string | null

  estimatedValue: number | null
  currency: string

  stage: LeadStageSummary | null
  status: LeadStatus
  lostReason: string | null
  notes: string | null

  assignedTo: LeadOwnerSummary | null
  journey: LeadJourney
  lastActivityAt: string | null
  activityCount?: number

  organizationId: string
  createdAt: string
  updatedAt: string
}

export interface PublicLeadActivity {
  id: string
  leadId: string
  type: LeadActivityType
  direction: LeadActivityDirection
  subject: string | null
  body: string | null
  occurredAt: string
  durationMinutes: number | null
  metadata: unknown
  isSystem: boolean
  actor: LeadOwnerSummary | null
  createdAt: string
}

export interface Pagination {
  total: number
  page: number
  limit: number
  totalPages: number
}

// --- Reporting --------------------------------------------------------------

export interface FunnelStep {
  key: string
  label: string
  count: number
  conversionFromStart: number
  conversionFromPrevious: number
  droppedFromPrevious: number
  dropOffRate: number
}

export interface FunnelBreak {
  fromKey: string
  fromLabel: string
  toKey: string
  toLabel: string
  dropped: number
  dropOffRate: number
  summary: string
}

export interface FunnelTotals {
  captured: number
  open: number
  won: number
  lost: number
  assigned: number
  unassigned: number
  winRate: number
  estimatedValue: number
  wonValue: number
}

export interface ResponseTimes {
  averageHoursToFirstContact: number | null
  medianHoursToFirstContact: number | null
  averageHoursToFirstReply: number | null
  medianHoursToFirstReply: number | null
}

export interface StageOccupancy {
  stage: LeadStageSummary
  count: number
  value: number
}

export interface FunnelGroup {
  key: string | null
  label: string
  funnel: FunnelStep[]
  break: FunnelBreak | null
  totals: FunnelTotals
}

export interface FunnelReport {
  totals: FunnelTotals
  funnel: FunnelStep[]
  break: FunnelBreak | null
  responseTimes: ResponseTimes
  byStage: StageOccupancy[]
  groups?: FunnelGroup[]
}

export type LeakSeverity = 'high' | 'medium' | 'low'

export interface LeakLeadSummary {
  id: string
  fullName: string | null
  company: string | null
  email: string | null
  phone: string | null
  estimatedValue: number | null
  currency: string
  assignedTo: LeadOwnerSummary | null
  stage: LeadStageSummary | null
  source: LeadSourceSummary | null
  capturedAt: string
}

export interface LeakGroup {
  type: string
  label: string
  severity: LeakSeverity
  thresholdDescription: string
  count: number
  atRiskValue: number
  leads: { magnitude: number; lead: LeakLeadSummary }[]
  hasMore: boolean
}

export interface LeakageReport {
  generatedAt: string
  thresholds: Record<string, number>
  summary: {
    totalOpenLeadsAtRisk: number
    totalAtRiskValue: number
    currency: string
    rulesTripped: number
  }
  headlines: string[]
  leaks: LeakGroup[]
  duplicates: { matchField: string; value: string; leads: LeakLeadSummary[] }[]
  silentSources: {
    source: LeadSourceSummary
    lastCapturedAt: string | null
    daysSinceLastCapture: number
  }[]
  outOfScope: string[]
}

export interface SalespersonSummary {
  id: string
  name: string | null
  email: string
  count: number
  averageHours: number
}

export interface ResponseMetricReport {
  key: string
  label: string
  count: number
  averageHours: number | null
  medianHours: number | null
  attributedToSalesperson: boolean
  bySalesperson?: SalespersonSummary[]
  best?: SalespersonSummary | null
  worst?: SalespersonSummary | null
}

export interface ResponseTimeReport {
  generatedAt: string
  metrics: ResponseMetricReport[]
  speedToLossCorrelation: {
    headline: string | null
    [key: string]: unknown
  }
  headlines: string[]
}

export type FollowUpUrgency = 'today' | 'overdue' | 'critical'

export interface FollowUpEntry {
  urgency: FollowUpUrgency
  lastActivityAt: string
  dueAt: string
  daysSinceLastActivity: number
  daysOverdue: number
  lead: LeakLeadSummary
}

export interface FollowUpGroup {
  urgency: FollowUpUrgency
  count: number
  atRiskValue: number
  leads: FollowUpEntry[]
  hasMore: boolean
}

export interface FollowUpDashboard {
  generatedAt: string
  thresholds: { followUpAfterDays: number; criticalOverdueDays: number }
  summary: {
    today: number
    overdue: number
    critical: number
    totalDue: number
    totalAtRiskValue: number
  }
  groups: FollowUpGroup[]
  headlines: string[]
}
