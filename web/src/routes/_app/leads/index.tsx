import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus, Search, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useLeadSources, useLeadStages } from '@/features/catalog/queries'
import { CreateLeadDialog } from '@/features/leads/create-lead-dialog'
import { ChannelBadge, StageBadge, StatusBadge } from '@/features/leads/lead-badges'
import { useLeads } from '@/features/leads/queries'
import { useAssignableUsers } from '@/features/rbac/queries'
import { formatCurrency, formatRelative, leadLabel } from '@/lib/format'
import { Permissions, hasPermission } from '@/lib/permissions'
import type { LeadStatus } from '@/types/api'

/**
 * Filters live in the URL, not in component state — a filtered pipeline is
 * the thing people paste into chat ("look at these 12 unassigned leads"), and
 * the dashboard links straight into pre-filtered views.
 */
const searchSchema = z.object({
  page: z.number().int().positive().default(1),
  search: z.string().optional(),
  status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
  stageId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  unassigned: z.boolean().optional(),
  sort: z.enum(['capturedAt', 'lastActivityAt', 'estimatedValue', 'updatedAt']).default('capturedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export const Route = createFileRoute('/_app/leads/')({
  validateSearch: searchSchema,
  component: LeadsPage,
})

const ANY = '__any__'

function LeadsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { user } = Route.useRouteContext()

  const [createOpen, setCreateOpen] = useState(false)
  const [searchText, setSearchText] = useState(search.search ?? '')

  // Debounced so typing does not fire a request per keystroke; the URL is the
  // source of truth, so a back-navigation still restores the input.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((search.search ?? '') === searchText) return
      void navigate({
        search: (previous) => ({
          ...previous,
          page: 1,
          search: searchText || undefined,
        }),
      })
    }, 300)

    return () => clearTimeout(timer)
  }, [searchText, search.search, navigate])

  useEffect(() => {
    setSearchText(search.search ?? '')
  }, [search.search])

  const stages = useLeadStages()
  const sources = useLeadSources()
  const users = useAssignableUsers()

  const leads = useLeads({
    page: search.page,
    limit: 20,
    ...(search.search ? { search: search.search } : {}),
    ...(search.status ? { status: [search.status as LeadStatus] } : {}),
    ...(search.stageId ? { stageId: search.stageId } : {}),
    ...(search.sourceId ? { sourceId: search.sourceId } : {}),
    ...(search.assignedToId ? { assignedToId: search.assignedToId } : {}),
    ...(search.unassigned ? { unassigned: true } : {}),
    sort: search.sort,
    order: search.order,
  })

  const setFilter = (patch: Record<string, unknown>) =>
    void navigate({ search: (previous) => ({ ...previous, page: 1, ...patch }) })

  const activeFilters = [
    search.status,
    search.stageId,
    search.sourceId,
    search.assignedToId,
    search.unassigned,
  ].filter(Boolean).length

  const canCreate = hasPermission(user.permissions, Permissions.LEAD_CREATE)
  const pagination = leads.data?.pagination

  return (
    <>
      <PageHeader
        title="Leads"
        description={
          pagination ? `${pagination.total} matching this view` : 'Your pipeline'
        }
        actions={
          canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New lead
            </Button>
          )
        }
      />

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Name, company, email or phone"
              className="pl-9"
              aria-label="Search leads"
            />
          </div>

          <FilterSelect
            label="Status"
            value={search.status ?? ANY}
            onChange={(value) => setFilter({ status: value === ANY ? undefined : value })}
            options={[
              { value: 'OPEN', label: 'Open' },
              { value: 'WON', label: 'Won' },
              { value: 'LOST', label: 'Lost' },
            ]}
          />

          <FilterSelect
            label="Stage"
            value={search.stageId ?? ANY}
            onChange={(value) => setFilter({ stageId: value === ANY ? undefined : value })}
            options={(stages.data ?? []).map((stage) => ({
              value: stage.id,
              label: stage.name,
            }))}
          />

          <FilterSelect
            label="Source"
            value={search.sourceId ?? ANY}
            onChange={(value) => setFilter({ sourceId: value === ANY ? undefined : value })}
            options={(sources.data ?? []).map((source) => ({
              value: source.id,
              label: source.name,
            }))}
          />

          <FilterSelect
            label="Owner"
            value={search.unassigned ? 'unassigned' : (search.assignedToId ?? ANY)}
            onChange={(value) =>
              setFilter(
                value === ANY
                  ? { assignedToId: undefined, unassigned: undefined }
                  : value === 'unassigned'
                    ? { assignedToId: undefined, unassigned: true }
                    : { assignedToId: value, unassigned: undefined },
              )
            }
            options={[
              { value: 'unassigned', label: 'Unassigned' },
              ...(users.data?.users ?? []).map((member) => ({
                value: member.id,
                label: member.name ?? member.email,
              })),
            ]}
          />

          {activeFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void navigate({
                  search: (previous) => ({
                    page: 1,
                    sort: previous.sort,
                    order: previous.order,
                    ...(previous.search ? { search: previous.search } : {}),
                  }),
                })
              }
            >
              <X className="size-4" />
              Clear ({activeFilters})
            </Button>
          )}
        </div>

        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Last activity</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {leads.isPending &&
                    Array.from({ length: 8 }).map((_, index) => (
                      <TableRow key={index}>
                        {Array.from({ length: 7 }).map((__, cell) => (
                          <TableCell key={cell}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}

                  {leads.data?.leads.map((lead) => (
                    <TableRow key={lead.id} className="cursor-pointer">
                      <TableCell>
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: lead.id }}
                          className="block"
                        >
                          <span className="block font-medium">{leadLabel(lead)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {lead.company ?? lead.email ?? lead.phone ?? '—'}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StageBadge stage={lead.stage} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={lead.status} />
                      </TableCell>
                      <TableCell>
                        <ChannelBadge channel={lead.channel} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {lead.assignedTo ? (
                          (lead.assignedTo.name ?? lead.assignedTo.email)
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-status-serious/40 text-status-serious"
                          >
                            Unassigned
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatCurrency(lead.estimatedValue, lead.currency)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatRelative(lead.lastActivityAt ?? lead.journey.capturedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {leads.data?.leads.length === 0 && (
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Users />
                  </EmptyMedia>
                  <EmptyTitle>No leads match this view</EmptyTitle>
                  <EmptyDescription>
                    {activeFilters > 0 || search.search
                      ? 'Try widening the filters above.'
                      : 'Captured leads will appear here.'}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() =>
                  void navigate({
                    search: (previous) => ({ ...previous, page: previous.page - 1 }),
                  })
                }
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() =>
                  void navigate({
                    search: (previous) => ({ ...previous, page: previous.page + 1 }),
                  })
                }
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {canCreate && <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as string)}>
      <SelectTrigger size="default" className="w-[150px]" aria-label={label}>
        <SelectValue placeholder={label}>
          {(selected: string) =>
            selected === ANY
              ? label
              : (options.find((option) => option.value === selected)?.label ?? label)
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>All {label.toLowerCase()}s</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
