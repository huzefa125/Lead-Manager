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

/** `all` returns an empty object, which the API reads as "no bound". */
export function resolveRange(preset: RangePreset): ResolvedRange {
  const now = new Date()

  if (preset === 'all') return {}

  if (preset === 'mtd') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { capturedFrom: start.toISOString() }
  }

  const days = DAYS[preset] ?? 30
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
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
