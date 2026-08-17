import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber, formatPercent } from '@/lib/format'
import type { FunnelBreak, FunnelStep } from '@/types/api'

/**
 * The journey as ordered bars.
 *
 * One series — the bar's *length* is the encoding, so every bar wears the same
 * hue and there is no legend to read. The drop-off rides as a muted remainder
 * on the same row, separated by a 2px surface gap rather than a border, so the
 * loss between two steps is visible without a second chart.
 */
export function FunnelChart({
  steps,
  breakPoint,
}: {
  steps: FunnelStep[]
  breakPoint?: FunnelBreak | null
}) {
  const start = steps[0]?.count ?? 0

  if (start === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No leads captured in this period.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {steps.map((step, index) => {
        const width = (step.count / start) * 100
        const isBreak = breakPoint?.toKey === step.key
        const previous = steps[index - 1]

        return (
          <div key={step.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium">{step.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatNumber(step.count)}
                <span className="ml-2 text-xs">{formatPercent(step.conversionFromStart, 0)}</span>
              </span>
            </div>

            <Tooltip>
              <TooltipTrigger
                render={
                  // A bar is not a control; the row is a hover target only, so
                  // the whole mark is described to a screen reader instead.
                  <div
                    className="h-3 w-full overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${step.label}: ${step.count} leads, ${formatPercent(
                      step.conversionFromStart,
                      0,
                    )} of captured`}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${Math.max(width, step.count > 0 ? 1.5 : 0)}%` }}
                    />
                  </div>
                }
              />

              <TooltipContent side="top">
                <div className="space-y-0.5 text-xs">
                  <p className="font-medium">{step.label}</p>
                  <p>{formatNumber(step.count)} leads</p>
                  {index > 0 && previous && (
                    <p>
                      {formatPercent(step.conversionFromPrevious, 0)} of {previous.label} —{' '}
                      {formatNumber(step.droppedFromPrevious)} lost
                    </p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>

            {index > 0 && step.droppedFromPrevious > 0 && (
              <p
                className={
                  isBreak
                    ? 'text-xs font-medium text-status-critical'
                    : 'text-xs text-muted-foreground'
                }
              >
                {isBreak && '▲ '}
                {formatNumber(step.droppedFromPrevious)} lost here (
                {formatPercent(step.dropOffRate, 0)})
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
