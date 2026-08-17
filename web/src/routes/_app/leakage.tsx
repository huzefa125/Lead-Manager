import { createFileRoute } from '@tanstack/react-router'
import { AlertOctagon, AlertTriangle, Copy, Droplets, Info, RadioTower, Wallet } from 'lucide-react'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { StatCard, StatCardRow } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { DateRangeFilter, RANGE_PRESETS, resolveRange } from '@/features/analytics/date-range'
import { LeadMiniTable } from '@/features/analytics/lead-mini-table'
import { useLeakage } from '@/features/analytics/queries'
import {
  formatAmount,
  formatCurrency,
  formatDays,
  formatHours,
  formatNumber,
} from '@/lib/format'
import type { LeakSeverity } from '@/types/api'

const searchSchema = z.object({
  range: z.enum(RANGE_PRESETS).default('30d'),
})

export const Route = createFileRoute('/_app/leakage')({
  validateSearch: searchSchema,
  component: LeakagePage,
})

const SEVERITY: Record<
  LeakSeverity,
  { label: string; icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  high: { label: 'High', icon: AlertOctagon, className: 'text-status-critical' },
  medium: { label: 'Medium', icon: AlertTriangle, className: 'text-status-serious' },
  low: { label: 'Low', icon: Info, className: 'text-muted-foreground' },
}

function LeakagePage() {
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { capturedFrom, capturedTo } = resolveRange(range)

  const leakage = useLeakage({ capturedFrom, capturedTo, sampleSize: 15 })
  const summary = leakage.data?.summary

  return (
    <>
      <PageHeader
        title="Leakage"
        description="Open leads that are quietly rotting, and the money behind them."
        actions={
          <DateRangeFilter
            value={range}
            onChange={(next) => void navigate({ search: { range: next } })}
          />
        }
      />

      <div className="space-y-4 p-4">
        <StatCardRow>
          <StatCard
            label="Leads at risk"
            value={formatNumber(summary?.totalOpenLeadsAtRisk)}
            icon={Droplets}
            tone={summary?.totalOpenLeadsAtRisk ? 'critical' : 'default'}
            loading={leakage.isPending}
          />
          <StatCard
            label="Value at risk"
            value={formatCurrency(
              summary?.totalAtRiskValue,
              summary?.currency === 'MIXED' ? undefined : summary?.currency,
            )}
            hint={summary?.currency === 'MIXED' ? 'mixed currencies' : undefined}
            icon={Wallet}
            loading={leakage.isPending}
          />
          <StatCard
            label="Rules tripped"
            value={formatNumber(summary?.rulesTripped)}
            icon={AlertTriangle}
            loading={leakage.isPending}
          />
          <StatCard
            label="Duplicates"
            value={formatNumber(leakage.data?.duplicates.length)}
            hint="open leads sharing an identity"
            icon={Copy}
            loading={leakage.isPending}
          />
        </StatCardRow>

        {leakage.data && leakage.data.headlines.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What this says</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {leakage.data.headlines.map((headline) => (
                <p key={headline} className="text-sm">
                  {headline}
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        {leakage.isPending && <Skeleton className="h-64 w-full" />}

        {leakage.data && leakage.data.leaks.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Droplets />
              </EmptyMedia>
              <EmptyTitle>No leaks found</EmptyTitle>
              <EmptyDescription>
                Nothing in this period tripped a leakage rule.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {(leakage.data?.leaks ?? []).map((leak) => {
          const meta = SEVERITY[leak.severity]
          // Each rule reports its magnitude in either hours or days; the
          // threshold sentence ("48+ hours", "5+ days") is where the API says
          // which, so read it rather than guessing from the number's size.
          const isHours = leak.thresholdDescription.includes('hour')

          return (
            <Card key={leak.type}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <meta.icon className={`size-4 ${meta.className}`} />
                  {leak.label}
                  <Badge variant="ghost" className="text-muted-foreground">
                    {meta.label}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {leak.thresholdDescription} · {formatNumber(leak.count)} leads ·{' '}
                  {formatAmount(leak.atRiskValue)} at risk
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <LeadMiniTable
                  magnitudeHeader="Waiting"
                  leads={leak.leads.map((entry) => ({
                    magnitude: isHours
                      ? formatHours(entry.magnitude)
                      : formatDays(entry.magnitude),
                    lead: entry.lead,
                  }))}
                />
                {leak.hasMore && (
                  <p className="p-4 text-xs text-muted-foreground">
                    Showing {leak.leads.length} of {formatNumber(leak.count)}.
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}

        {leakage.data && leakage.data.silentSources.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <RadioTower className="size-4 text-status-serious" />
                Sources that have gone quiet
              </CardTitle>
              <CardDescription>
                An active source with no capture for a while — usually a broken form or a
                paused campaign, not a quiet market.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {leakage.data.silentSources.map((entry) => (
                <div
                  key={entry.source.id}
                  className="flex items-center justify-between gap-3 rounded-xl border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{entry.source.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Last lead {formatDays(entry.daysSinceLastCapture)} ago
                    </p>
                  </div>
                  <Badge variant="outline">{formatDays(entry.daysSinceLastCapture)}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {leakage.data && leakage.data.duplicates.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Copy className="size-4 text-muted-foreground" />
                Possible duplicates
              </CardTitle>
              <CardDescription>
                Open leads sharing an email or phone — two reps may be working the same
                person.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {leakage.data.duplicates.map((group) => (
                <div key={`${group.matchField}-${group.value}`} className="rounded-xl border">
                  <p className="border-b px-4 py-2 text-xs text-muted-foreground">
                    Same {group.matchField}: <span className="font-medium">{group.value}</span>
                  </p>
                  <LeadMiniTable
                    magnitudeHeader="Captured"
                    leads={group.leads.map((lead) => ({
                      magnitude: new Date(lead.capturedAt).toLocaleDateString(),
                      lead,
                    }))}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {leakage.data && leakage.data.outOfScope.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="size-4 text-muted-foreground" />
                What this report cannot see
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {leakage.data.outOfScope.map((note) => (
                <p key={note} className="text-sm text-muted-foreground">
                  {note}
                </p>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
