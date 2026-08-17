import { Check, Circle } from 'lucide-react'
import { formatDateTime, formatHours } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { LeadJourney } from '@/types/api'

/**
 * The milestone columns, in the order a lead travels them.
 *
 * This is the server's own journey model rendered literally — one row per
 * milestone, reached or not — so "where is this lead" is answered by looking
 * rather than by inferring it from the stage name.
 */
const MILESTONES: { key: keyof LeadJourney; label: string }[] = [
  { key: 'capturedAt', label: 'Captured' },
  { key: 'assignedAt', label: 'Assigned' },
  { key: 'firstContactAt', label: 'First contact' },
  { key: 'firstReplyAt', label: 'First reply' },
  { key: 'meetingBookedAt', label: 'Meeting booked' },
  { key: 'quotationSentAt', label: 'Quotation sent' },
  { key: 'lastFollowUpAt', label: 'Last follow-up' },
  { key: 'closedAt', label: 'Closed' },
]

export function JourneyTrack({ journey }: { journey: LeadJourney }) {
  return (
    <ol className="space-y-0">
      {MILESTONES.map((milestone, index) => {
        const value = journey[milestone.key] as string | null
        const reached = Boolean(value)
        const isNext = journey.nextStep?.label === milestone.label
        const isLast = index === MILESTONES.length - 1

        return (
          <li key={milestone.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border',
                  reached && 'border-primary bg-primary text-primary-foreground',
                  !reached && isNext && 'border-status-serious text-status-serious',
                  !reached && !isNext && 'border-border text-muted-foreground',
                )}
              >
                {reached ? <Check className="size-3" /> : <Circle className="size-2 fill-current" />}
              </span>
              {!isLast && (
                <span
                  className={cn('w-px flex-1', reached ? 'bg-primary/30' : 'bg-border')}
                  aria-hidden
                />
              )}
            </div>

            <div className={cn('min-w-0 pb-4', isLast && 'pb-0')}>
              <p
                className={cn(
                  'text-sm',
                  reached ? 'font-medium' : 'text-muted-foreground',
                  !reached && isNext && 'font-medium text-status-serious',
                )}
              >
                {milestone.label}
                {!reached && isNext && ' — next'}
              </p>
              <p className="text-xs text-muted-foreground">
                {reached ? formatDateTime(value) : 'Not yet'}
                {milestone.key === 'firstContactAt' && journey.hoursToFirstContact !== null && (
                  <> · {formatHours(journey.hoursToFirstContact)} after capture</>
                )}
                {milestone.key === 'firstReplyAt' && journey.hoursToFirstReply !== null && (
                  <> · {formatHours(journey.hoursToFirstReply)} after contact</>
                )}
                {milestone.key === 'lastFollowUpAt' && journey.followUpCount > 0 && (
                  <> · {journey.followUpCount} total</>
                )}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
