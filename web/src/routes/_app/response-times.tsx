import { createFileRoute } from '@tanstack/react-router'
import { Gauge, TrendingDown, Trophy } from 'lucide-react'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DateRangeFilter, RANGE_PRESETS, resolveRange } from '@/features/analytics/date-range'
import { useResponseTimes } from '@/features/analytics/queries'
import { formatHours, formatNumber } from '@/lib/format'
import type { ResponseMetricReport } from '@/types/api'

const searchSchema = z.object({
  range: z.enum(RANGE_PRESETS).default('30d'),
})

export const Route = createFileRoute('/_app/response-times')({
  validateSearch: searchSchema,
  component: ResponseTimesPage,
})

function ResponseTimesPage() {
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { capturedFrom, capturedTo } = resolveRange(range)

  const report = useResponseTimes({ capturedFrom, capturedTo })
  const measured = (report.data?.metrics ?? []).filter((metric) => metric.count > 0)

  return (
    <>
      <PageHeader
        title="Response times"
        description="Six gaps in the journey, and whether being slow is costing deals."
        actions={
          <DateRangeFilter
            value={range}
            onChange={(next) => void navigate({ search: { range: next } })}
          />
        }
      />

      <div className="space-y-4 p-4">
        {report.data?.speedToLossCorrelation.headline && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingDown className="size-4 text-status-serious" />
                Speed and losses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{report.data.speedToLossCorrelation.headline}</p>
            </CardContent>
          </Card>
        )}

        {report.data && report.data.headlines.length > 0 && (
          <Card>
            <CardContent className="space-y-1 p-4">
              {report.data.headlines.map((headline) => (
                <p key={headline} className="text-sm">
                  {headline}
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        {report.isPending && <Skeleton className="h-64 w-full" />}

        {report.data && measured.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Gauge />
              </EmptyMedia>
              <EmptyTitle>Nothing measured yet</EmptyTitle>
              <EmptyDescription>
                Response times appear once leads in this period have been contacted and
                replied to.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {measured.map((metric) => (
            <MetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      </div>
    </>
  )
}

function MetricCard({ metric }: { metric: ResponseMetricReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{metric.label}</CardTitle>
        <CardDescription>
          {formatNumber(metric.count)} leads measured
          {!metric.attributedToSalesperson && ' · not a single rep’s to own'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">Median</p>
            <p className="text-xl font-semibold">{formatHours(metric.medianHours)}</p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">Mean</p>
            <p className="text-xl font-semibold">{formatHours(metric.averageHours)}</p>
          </div>
        </div>

        {metric.attributedToSalesperson && (metric.best || metric.worst) && (
          <div className="flex flex-wrap gap-2">
            {metric.best && (
              <Badge variant="outline" className="border-status-good/40 text-status-good">
                <Trophy className="size-3" />
                Fastest: {metric.best.name ?? metric.best.email} —{' '}
                {formatHours(metric.best.averageHours)}
              </Badge>
            )}
            {metric.worst && metric.worst.id !== metric.best?.id && (
              <Badge
                variant="outline"
                className="border-status-serious/40 text-status-serious"
              >
                Slowest: {metric.worst.name ?? metric.worst.email} —{' '}
                {formatHours(metric.worst.averageHours)}
              </Badge>
            )}
          </div>
        )}

        {metric.bySalesperson && metric.bySalesperson.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Average</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metric.bySalesperson.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="text-sm">{person.name ?? person.email}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatNumber(person.count)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatHours(person.averageHours)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
