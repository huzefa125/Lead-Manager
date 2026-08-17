import { Badge } from '@/components/ui/badge'
import { CHANNEL_LABELS } from '@/lib/format'
import type { LeadChannel, LeadStageSummary, LeadStatus } from '@/types/api'

/**
 * Status is state, so it wears a status color — and always with its label, so
 * the color is never the only thing carrying the meaning.
 */
export function StatusBadge({ status }: { status: LeadStatus }) {
  if (status === 'WON') {
    return (
      <Badge variant="outline" className="border-status-good/40 text-status-good">
        Won
      </Badge>
    )
  }

  if (status === 'LOST') {
    return (
      <Badge variant="outline" className="border-status-critical/40 text-status-critical">
        Lost
      </Badge>
    )
  }

  return <Badge variant="secondary">Open</Badge>
}

/** The stage is identity, not state — it stays neutral so status stands out. */
export function StageBadge({ stage }: { stage: LeadStageSummary | null }) {
  if (!stage) return <span className="text-muted-foreground">—</span>
  return <Badge variant="outline">{stage.name}</Badge>
}

export function ChannelBadge({ channel }: { channel: LeadChannel | null }) {
  if (!channel) return <span className="text-muted-foreground">—</span>
  return (
    <Badge variant="ghost" className="text-muted-foreground">
      {CHANNEL_LABELS[channel]}
    </Badge>
  )
}
