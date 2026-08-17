import { createFileRoute } from '@tanstack/react-router'
import { AlertOctagon, CalendarClock, CheckCircle2, Clock } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { StatCard, StatCardRow } from '@/components/stat-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { LeadMiniTable } from '@/features/analytics/lead-mini-table'
import { useFollowUps } from '@/features/analytics/queries'
import { formatAmount, formatDays, formatNumber } from '@/lib/format'
import type { FollowUpUrgency } from '@/types/api'

export const Route = createFileRoute('/_app/follow-ups')({
  component: FollowUpsPage,
})

/**
 * Status colours, each paired with an icon and a word — the urgency is never
 * carried by hue alone.
 */
const URGENCY: Record<
  FollowUpUrgency,
  { label: string; description: string; icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  today: {
    label: 'Due today',
    description: 'Silence has just crossed the follow-up threshold.',
    icon: Clock,
    className: 'text-status-warning',
  },
  overdue: {
    label: 'Overdue',
    description: 'Past due, not yet critical.',
    icon: CalendarClock,
    className: 'text-status-serious',
  },
  critical: {
    label: 'Critical',
    description: 'A full stretch of silence — these are the ones that go cold.',
    icon: AlertOctagon,
    className: 'text-status-critical',
  },
}

function FollowUpsPage() {
  const followUps = useFollowUps({ sampleSize: 25 })
  const summary = followUps.data?.summary
  const thresholds = followUps.data?.thresholds

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description={
          thresholds
            ? `Due after ${thresholds.followUpAfterDays} days of silence · critical after ${
                thresholds.followUpAfterDays + thresholds.criticalOverdueDays
              }`
            : 'Leads waiting on you'
        }
      />

      <div className="space-y-4 p-4">
        <StatCardRow>
          <StatCard
            label="Total due"
            value={formatNumber(summary?.totalDue)}
            icon={CalendarClock}
            loading={followUps.isPending}
          />
          <StatCard
            label="Due today"
            value={formatNumber(summary?.today)}
            icon={Clock}
            tone="warning"
            loading={followUps.isPending}
          />
          <StatCard
            label="Critical"
            value={formatNumber(summary?.critical)}
            hint="a week or more of silence"
            icon={AlertOctagon}
            tone="critical"
            loading={followUps.isPending}
          />
          <StatCard
            label="Value waiting"
            value={formatAmount(summary?.totalAtRiskValue)}
            icon={CheckCircle2}
            loading={followUps.isPending}
          />
        </StatCardRow>

        {followUps.data && followUps.data.headlines.length > 0 && (
          <Card>
            <CardContent className="space-y-1 p-4">
              {followUps.data.headlines.map((headline) => (
                <p key={headline} className="text-sm">
                  {headline}
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        {followUps.isPending && <Skeleton className="h-64 w-full" />}

        {followUps.data?.summary.totalDue === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckCircle2 />
              </EmptyMedia>
              <EmptyTitle>Nothing is waiting</EmptyTitle>
              <EmptyDescription>
                Every lead that replied has been answered inside the follow-up window.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {(followUps.data?.groups ?? [])
          .filter((group) => group.count > 0)
          .map((group) => {
            const meta = URGENCY[group.urgency]

            return (
              <Card key={group.urgency}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <meta.icon className={`size-4 ${meta.className}`} />
                    {meta.label}
                    <span className="text-sm font-normal text-muted-foreground">
                      {formatNumber(group.count)} · {formatAmount(group.atRiskValue)}
                    </span>
                  </CardTitle>
                  <CardDescription>{meta.description}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <LeadMiniTable
                    magnitudeHeader="Silent for"
                    leads={group.leads.map((entry) => ({
                      magnitude: formatDays(entry.daysSinceLastActivity),
                      lead: entry.lead,
                    }))}
                  />
                  {group.hasMore && (
                    <p className="p-4 text-xs text-muted-foreground">
                      Showing {group.leads.length} of {formatNumber(group.count)}.
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
      </div>
    </>
  )
}
