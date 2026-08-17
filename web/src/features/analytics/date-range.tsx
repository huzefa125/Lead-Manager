import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The date filter every report shares.
 *
 * Presets only, kept in the URL as a short token rather than a resolved pair of
 * timestamps — so a shared or bookmarked link means "the last 30 days", not
 * "the 30 days that ended when I copied this".
 */

export const RANGE_PRESETS = ['7d', '30d', '90d', 'mtd', 'all'] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]

const LABELS: Record<RangePreset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  mtd: 'Month to date',
  all: 'All time',
}

const DAYS: Partial<Record<RangePreset, number>> = { '7d': 7, '30d': 30, '90d': 90 }

export interface ResolvedRange {
  capturedFrom?: string
  capturedTo?: string
}

/**
 * `all` returns an empty object, which the API reads as "no bound".
 *
 * The boundary is floored to midnight, and that is load-bearing rather than
 * cosmetic. This runs during render, and its result becomes part of a query
 * key: if it returned `now`, every render would produce a boundary a few
 * milliseconds later, which is a new key, which refetches, which re-renders —
 * an infinite request loop that a rate limiter eventually answers with 429.
 *
 * Flooring makes the result stable for the whole day, so the key settles and
 * the cache is actually reusable. It is also the more honest reading of "the
 * last 30 days" for a report: whole days, not a window that slides by
 * milliseconds while you look at it.
 */
export function resolveRange(preset: RangePreset): ResolvedRange {
  if (preset === 'all') return {}

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (preset === 'mtd') {
    return { capturedFrom: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }
  }

  const days = DAYS[preset] ?? 30
  const start = new Date(startOfToday)
  start.setDate(start.getDate() - days)

  return { capturedFrom: start.toISOString() }
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: RangePreset
  onChange: (value: RangePreset) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as RangePreset)}
      items={RANGE_PRESETS.map((preset) => ({ value: preset, label: LABELS[preset] }))}
    >
      <SelectTrigger size="sm" className="w-[150px]" aria-label="Date range">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RANGE_PRESETS.map((preset) => (
          <SelectItem key={preset} value={preset}>
            {LABELS[preset]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
