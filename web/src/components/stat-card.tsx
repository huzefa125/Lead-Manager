import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * A stat tile: one number that is the point, with a label above and optional
 * context below. Deliberately not a one-bar chart — a single current value
 * reads faster as a figure.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  loading = false,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  /** Status tones always pair the color with the icon and the label text. */
  tone?: 'default' | 'good' | 'warning' | 'critical'
  loading?: boolean
}) {
  const toneClass = {
    default: 'text-muted-foreground',
    good: 'text-status-good',
    warning: 'text-status-serious',
    critical: 'text-status-critical',
  }[tone]

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <p className="truncate text-2xl font-semibold">{value}</p>
          )}
          {hint && !loading && (
            <p className="truncate text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
        {Icon && <Icon className={cn('size-4 shrink-0', toneClass)} />}
      </CardContent>
    </Card>
  )
}

export function StatCardRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
}
