import { Link } from '@tanstack/react-router'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency, leadLabel } from '@/lib/format'
import type { LeakLeadSummary } from '@/types/api'

/**
 * The table every report drills into: who the lead is, who owns it, what it is
 * worth, and how bad the number behind the flag is.
 */
export function LeadMiniTable({
  leads,
  magnitudeHeader,
}: {
  leads: { magnitude: string; lead: LeakLeadSummary }[]
  magnitudeHeader: string
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">{magnitudeHeader}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map(({ magnitude, lead }) => (
            <TableRow key={lead.id}>
              <TableCell>
                <Link
                  to="/leads/$leadId"
                  params={{ leadId: lead.id }}
                  className="block underline-offset-4 hover:underline"
                >
                  <span className="block font-medium">{leadLabel(lead)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {lead.company ?? lead.email ?? '—'}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="text-sm">
                {lead.assignedTo ? (
                  (lead.assignedTo.name ?? lead.assignedTo.email)
                ) : (
                  <span className="text-status-serious">Unassigned</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {lead.stage?.name ?? '—'}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums">
                {formatCurrency(lead.estimatedValue, lead.currency)}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums font-medium">
                {magnitude}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
