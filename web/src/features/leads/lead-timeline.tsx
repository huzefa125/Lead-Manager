import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarCheck,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  Repeat,
  Settings,
  StickyNote,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useLeadTimeline } from '@/features/leads/queries'
import { ACTIVITY_LABELS, formatDateTime } from '@/lib/format'
import type { LeadActivityType, PublicLeadActivity } from '@/types/api'

const ICONS: Partial<Record<LeadActivityType, React.ComponentType<{ className?: string }>>> = {
  CALL: Phone,
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  SMS: MessageCircle,
  MEETING: CalendarCheck,
  QUOTATION: FileText,
  FOLLOW_UP: Repeat,
  NOTE: StickyNote,
  TASK: StickyNote,
}

export function LeadTimeline({
  leadId,
  excludeSystem,
}: {
  leadId: string
  excludeSystem: boolean
}) {
  const timeline = useLeadTimeline(leadId, { limit: 50, excludeSystem, order: 'desc' })

  if (timeline.isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  const activities = timeline.data?.activities ?? []

  if (activities.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {excludeSystem ? 'No work logged against this lead yet.' : 'Nothing here yet.'}
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {activities.map((activity) => (
        <TimelineEntry key={activity.id} activity={activity} />
      ))}

      {timeline.data && timeline.data.pagination.total > activities.length && (
        <p className="pt-3 text-center text-xs text-muted-foreground">
          Showing the {activities.length} most recent of {timeline.data.pagination.total}.
        </p>
      )}
    </div>
  )
}

function TimelineEntry({ activity }: { activity: PublicLeadActivity }) {
  const Icon = ICONS[activity.type] ?? Settings

  return (
    <div className="flex gap-3 rounded-xl p-2 transition-colors hover:bg-muted/50">
      <span
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
          activity.isSystem ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
        }`}
      >
        <Icon className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {activity.subject ?? ACTIVITY_LABELS[activity.type]}
          </span>

          {/* Direction is the field that separates "we reached out" from "they
              answered", so it is shown with an arrow and a word, not colour. */}
          {!activity.isSystem && activity.direction !== 'INTERNAL' && (
            <Badge variant="ghost" className="text-muted-foreground">
              {activity.direction === 'OUTBOUND' ? (
                <ArrowUpRight className="size-3" />
              ) : (
                <ArrowDownLeft className="size-3" />
              )}
              {activity.direction === 'OUTBOUND' ? 'Outbound' : 'Inbound'}
            </Badge>
          )}

          {activity.isSystem && (
            <Badge variant="ghost" className="text-muted-foreground">
              System
            </Badge>
          )}
        </div>

        {activity.body && (
          <p className="mt-0.5 text-sm whitespace-pre-wrap text-muted-foreground">
            {activity.body}
          </p>
        )}

        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDateTime(activity.occurredAt)}
          {activity.actor && ` · ${activity.actor.name ?? activity.actor.email}`}
          {activity.durationMinutes !== null && ` · ${activity.durationMinutes} min`}
        </p>
      </div>
    </div>
  )
}
