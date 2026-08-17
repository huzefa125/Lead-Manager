import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Target,
  TrendingUp,
  UserX,
  Wallet,
} from 'lucide-react'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { StatCard, StatCardRow } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DateRangeFilter, RANGE_PRESETS, resolveRange } from '@/features/analytics/date-range'
import { FunnelChart } from '@/features/analytics/funnel-chart'
import { useFollowUps, useFunnel, useLeakage } from '@/features/analytics/queries'
import { formatCurrency, formatHours, formatNumber, formatPercent } from '@/lib/format'

const searchSchema = z.object({
  range: z.enum(RANGE_PRESETS).default('30d'),
})

export const Route = createFileRoute('/_app/')({
  validateSearch: searchSchema,
  component: DashboardPage,
})

function DashboardPage() {
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { capturedFrom, capturedTo } = resolveRange(range)

  const funnel = useFunnel({ capturedFrom, capturedTo })
  const leakage = useLeakage({ capturedFrom, capturedTo, sampleSize: 1 })
  const followUps = useFollowUps({ sampleSize: 1 })

  const totals = funnel.data?.totals
  const response = funnel.data?.responseTimes

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Where the pipeline stands, and where it is losing money."
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
            label="Captured"
            value={formatNumber(totals?.captured)}
            hint={`${formatNumber(totals?.open)} still open`}
            icon={Target}
            loading={funnel.isPending}
          />
          <StatCard
            label="Win rate"
            value={formatPercent(totals?.winRate, 0)}
            hint={`${formatNumber(totals?.won)} won · ${formatNumber(totals?.lost)} lost`}
            icon={TrendingUp}
            loading={funnel.isPending}
          />
          <StatCard
            label="Pipeline value"
            value={formatCurrency(totals?.estimatedValue)}
            hint={`${formatCurrency(totals?.wonValue)} won`}
            icon={Wallet}
            loading={funnel.isPending}
          />
          <StatCard
            label="Time to first contact"
            value={formatHours(response?.medianHoursToFirstContact)}
            hint={`median · mean ${formatHours(response?.averageHoursToFirstContact)}`}
            icon={Clock}
            tone={
              (response?.medianHoursToFirstContact ?? 0) > 24 ? 'warning' : 'default'
            }
            loading={funnel.isPending}
          />
        </StatCardRow>

        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Lead journey</CardTitle>
              <CardDescription>
                Every captured lead, and how far it got. Bar length is the share that
                reached each step.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {funnel.isPending ? (
                <div className="space-y-4">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="space-y-1.5">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))}
                </div>
              ) : (
                <FunnelChart
                  steps={funnel.data?.funnel ?? []}
                  breakPoint={funnel.data?.break ?? null}
                />
              )}
            </CardContent>
          </Card>

          <div className="space-y-4 lg:col-span-2">
            {funnel.data?.break && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="size-4 text-status-critical" />
                    Biggest drop-off
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{funnel.data.break.summary}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link to="/leakage" search={{ range }} />}
                  >
                    See why
                    <ArrowRight className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Needs attention now</CardTitle>
                <CardDescription>Independent of the date range above.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <AttentionRow
                  label="Follow-ups due"
                  value={followUps.data?.summary.totalDue}
                  detail={
                    followUps.data
                      ? `${followUps.data.summary.critical} critical`
                      : undefined
                  }
                  tone={followUps.data?.summary.critical ? 'critical' : 'default'}
                  to="/follow-ups"
                  loading={followUps.isPending}
                />
                <AttentionRow
                  label="Leads at risk"
                  value={leakage.data?.summary.totalOpenLeadsAtRisk}
                  detail={
                    leakage.data
                      ? formatCurrency(
                          leakage.data.summary.totalAtRiskValue,
                          leakage.data.summary.currency === 'MIXED'
                            ? undefined
                            : leakage.data.summary.currency,
                        )
                      : undefined
                  }
                  tone={leakage.data?.summary.totalOpenLeadsAtRisk ? 'warning' : 'default'}
                  to="/leakage"
                  loading={leakage.isPending}
                />
                <AttentionRow
                  label="Unassigned"
                  value={totals?.unassigned}
                  detail="nobody owns these"
                  tone={totals?.unassigned ? 'warning' : 'default'}
                  to="/leads"
                  search={{ unassigned: true }}
                  loading={funnel.isPending}
                  icon={UserX}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        {funnel.data && funnel.data.byStage.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Open pipeline by stage</CardTitle>
              <CardDescription>Where leads are sitting right now.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {funnel.data.byStage.map((entry) => (
                  <Link
                    key={entry.stage.id}
                    to="/leads"
                    search={{ stageId: entry.stage.id }}
                    className="rounded-xl border p-3 transition-colors hover:bg-muted/50"
                  >
                    <p className="truncate text-xs font-medium text-muted-foreground">
                      {entry.stage.name}
                    </p>
                    <p className="mt-1 text-xl font-semibold">{formatNumber(entry.count)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatCurrency(entry.value)}
                    </p>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

function AttentionRow({
  label,
  value,
  detail,
  tone,
  to,
  search,
  loading,
  icon: Icon = AlertTriangle,
}: {
  label: string
  value: number | undefined
  detail?: string
  tone: 'default' | 'warning' | 'critical'
  to: string
  search?: Record<string, unknown>
  loading: boolean
  icon?: React.ComponentType<{ className?: string }>
}) {
  const toneClass = {
    default: 'text-muted-foreground',
    warning: 'text-status-serious',
    critical: 'text-status-critical',
  }[tone]

  return (
    <Link
      to={to}
      search={search as never}
      className="flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={`size-4 shrink-0 ${toneClass}`} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{label}</span>
          {detail && (
            <span className="block truncate text-xs text-muted-foreground">{detail}</span>
          )}
        </span>
      </span>
      {loading ? (
        <Skeleton className="h-6 w-10" />
      ) : (
        <Badge variant={value ? 'outline' : 'ghost'} className="tabular-nums">
          {formatNumber(value ?? 0)}
        </Badge>
      )}
    </Link>
  )
}
