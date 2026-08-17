import type { LeadActivityType, LeadChannel } from '@/types/api'

/** Display helpers. Everything here is pure and locale-aware by default. */

export function formatCurrency(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined) return '—'

  // A 3-letter code the browser does not know throws; fall back to plain
  // number formatting rather than blanking the cell.
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value)
  } catch {
    return `${currency} ${new Intl.NumberFormat().format(value)}`
  }
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat().format(value)
}

/** The API returns ratios (0.42); the UI shows percentages. */
export function formatPercent(ratio: number | null | undefined, fractionDigits = 1): string {
  if (ratio === null || ratio === undefined) return '—'
  return `${(ratio * 100).toFixed(fractionDigits)}%`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * "3 days ago" / "in 2 hours". Uses the largest unit that keeps the number
 * above 1, which is how people read elapsed time.
 */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—'

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const deltaSeconds = (new Date(value).getTime() - Date.now()) / 1000

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ]

  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit)
    }
  }

  return formatter.format(Math.round(deltaSeconds), 'second')
}

/** Hours, rendered the way a sales manager reads them: "2.5h", "3d", "40m". */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`
  return `${Math.round((hours / 24) * 10) / 10}d`
}

export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—'
  return `${Math.round(days * 10) / 10}d`
}

/** `WEBSITE_FORM` → `Website Form`. Used for every enum the API returns. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—'
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function initials(name: string | null, email: string): string {
  const source = name?.trim() || email
  const parts = source.split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase()
}

/** A lead with no name at all is still identifiable by how it can be reached. */
export function leadLabel(lead: {
  fullName: string | null
  company: string | null
  email?: string | null
  phone?: string | null
}): string {
  return lead.fullName ?? lead.company ?? lead.email ?? lead.phone ?? 'Unnamed lead'
}

export const CHANNEL_LABELS: Record<LeadChannel, string> = {
  WEBSITE_FORM: 'Website Form',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  GOOGLE_ADS: 'Google Ads',
  LINKEDIN: 'LinkedIn',
  EMAIL: 'Email',
  PHONE: 'Phone',
  CRM_IMPORT: 'CRM Import',
  BOOKING: 'Booking Page',
  REFERRAL: 'Referral',
  MANUAL: 'Manual Entry',
  OTHER: 'Other',
}

export const ACTIVITY_LABELS: Record<LeadActivityType, string> = {
  NOTE: 'Note',
  CALL: 'Call',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  MEETING: 'Meeting',
  QUOTATION: 'Quotation',
  FOLLOW_UP: 'Follow-up',
  TASK: 'Task',
  CREATED: 'Created',
  ASSIGNED: 'Assigned',
  STAGE_CHANGED: 'Stage changed',
  STATUS_CHANGED: 'Status changed',
}
