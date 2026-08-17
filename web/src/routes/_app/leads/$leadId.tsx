import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeft,
  Building2,
  Globe,
  Mail,
  MessageSquarePlus,
  Pencil,
  Phone,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useLeadStages } from '@/features/catalog/queries'
import { EditLeadDialog } from '@/features/leads/edit-lead-dialog'
import { JourneyTrack } from '@/features/leads/journey-track'
import { ChannelBadge, StatusBadge } from '@/features/leads/lead-badges'
import { LeadTimeline } from '@/features/leads/lead-timeline'
import { LogActivityDialog } from '@/features/leads/log-activity-dialog'
import {
  useAssignLead,
  useChangeStage,
  useDeleteLead,
  useLead,
} from '@/features/leads/queries'
import { useAssignableUsers } from '@/features/rbac/queries'
import { ApiError } from '@/lib/api'
import { formatCurrency, formatDateTime, leadLabel } from '@/lib/format'
import { Permissions, hasPermission } from '@/lib/permissions'

export const Route = createFileRoute('/_app/leads/$leadId')({
  component: LeadDetailPage,
})

const UNASSIGNED = '__unassigned__'

function LeadDetailPage() {
  const { leadId } = Route.useParams()
  const { user } = Route.useRouteContext()
  const navigate = Route.useNavigate()

  const lead = useLead(leadId)
  const stages = useLeadStages()
  const users = useAssignableUsers()

  const assign = useAssignLead(leadId)
  const changeStage = useChangeStage(leadId)
  const deleteLead = useDeleteLead()

  const [logOpen, setLogOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [lostFor, setLostFor] = useState<string | null>(null)
  const [lostReason, setLostReason] = useState('')

  const canUpdate = hasPermission(user.permissions, Permissions.LEAD_UPDATE)
  const canAssign = hasPermission(user.permissions, Permissions.LEAD_ASSIGN)
  const canDelete = hasPermission(user.permissions, Permissions.LEAD_DELETE)

  if (lead.isPending) {
    return (
      <>
        <PageHeader title="Lead" />
        <div className="grid gap-4 p-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </>
    )
  }

  if (lead.isError || !lead.data) {
    const message =
      lead.error instanceof ApiError ? lead.error.message : 'This lead could not be loaded.'
    return (
      <>
        <PageHeader title="Lead" />
        <div className="p-4">
          <Card>
            <CardContent className="space-y-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">{message}</p>
              <Button variant="outline" nativeButton={false} render={<Link to="/leads" />}>
                Back to leads
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  const data = lead.data

  const onStageChange = (stageId: string) => {
    const target = stages.data?.find((stage) => stage.id === stageId)

    // The server requires a reason when moving into a LOST stage, so ask for it
    // instead of firing a request that comes back 422.
    if (target?.type === 'LOST') {
      setLostFor(stageId)
      return
    }

    changeStage.mutate(
      { stageId },
      {
        onSuccess: () => toast.success(`Moved to ${target?.name ?? 'new stage'}`),
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : 'Could not change stage'),
      },
    )
  }

  return (
    <>
      <PageHeader
        title={leadLabel(data)}
        description={data.company ?? undefined}
        actions={
          <>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/leads" />}>
              <ArrowLeft className="size-4" />
              Leads
            </Button>
            {canUpdate && (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
                <Button size="sm" onClick={() => setLogOpen(true)}>
                  <MessageSquarePlus className="size-4" />
                  Log activity
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 p-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={data.status} />
                {/* The default sources are named after their channel, so
                    showing both would just repeat the same words twice. */}
                {data.source ? (
                  <Badge variant="ghost" className="text-muted-foreground">
                    {data.source.name}
                  </Badge>
                ) : (
                  <ChannelBadge channel={data.channel} />
                )}
                {data.estimatedValue !== null && (
                  <Badge variant="outline">
                    {formatCurrency(data.estimatedValue, data.currency)}
                  </Badge>
                )}
              </div>
              {data.lostReason && (
                <CardDescription className="text-status-critical">
                  Lost: {data.lostReason}
                </CardDescription>
              )}
            </CardHeader>

            <CardContent className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <ContactRow icon={Mail} label="Email" value={data.email} href={data.email ? `mailto:${data.email}` : undefined} />
                <ContactRow icon={Phone} label="Phone" value={data.phone} href={data.phone ? `tel:${data.phone}` : undefined} />
                <ContactRow icon={MessageSquarePlus} label="WhatsApp" value={data.whatsapp} />
                <ContactRow icon={Building2} label="Company" value={data.company} />
                <ContactRow icon={Building2} label="Job title" value={data.jobTitle} />
                <ContactRow
                  icon={Globe}
                  label="Website"
                  value={data.website}
                  href={data.website ?? undefined}
                />
              </dl>

              {data.notes && (
                <div className="rounded-xl bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Notes</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{data.notes}</p>
                </div>
              )}

              {(data.campaign || data.utm.source || data.utm.campaign) && (
                <div className="rounded-xl border p-3">
                  <p className="text-xs font-medium text-muted-foreground">Attribution</p>
                  <p className="mt-1 text-sm">
                    {[data.campaign, data.utm.source, data.utm.medium, data.utm.campaign]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>
                Everything that happened, including what the system recorded itself.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="all">
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="work">Logged work</TabsTrigger>
                </TabsList>
                <TabsContent value="all" className="mt-4">
                  <LeadTimeline leadId={leadId} excludeSystem={false} />
                </TabsContent>
                <TabsContent value="work" className="mt-4">
                  <LeadTimeline leadId={leadId} excludeSystem />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field>
                <FieldLabel>Stage</FieldLabel>
                <Select
                  value={data.stage?.id ?? null}
                  onValueChange={(value) => onStageChange(value as string)}
                  disabled={!canUpdate || changeStage.isPending}
                  // Without `items`, Base UI's SelectValue renders the raw
                  // value — a bare UUID — instead of the item's label.
                  items={(stages.data ?? []).map((stage) => ({
                    value: stage.id,
                    label: stage.name,
                  }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {(stages.data ?? []).map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Owner</FieldLabel>
                <Select
                  value={data.assignedTo?.id ?? UNASSIGNED}
                  onValueChange={(value) =>
                    assign.mutate(
                      { assignedToId: value === UNASSIGNED ? null : (value as string) },
                      {
                        onSuccess: () => toast.success('Owner updated'),
                        onError: (error) =>
                          toast.error(
                            error instanceof ApiError ? error.message : 'Could not assign',
                          ),
                      },
                    )
                  }
                  disabled={!canAssign || assign.isPending}
                  items={[
                    { value: UNASSIGNED, label: 'Unassigned' },
                    ...(users.data?.users ?? []).map((member) => ({
                      value: member.id,
                      label: member.name ?? member.email,
                    })),
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {(users.data?.users ?? []).map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name ?? member.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <p className="text-xs text-muted-foreground">
                Captured {formatDateTime(data.journey.capturedAt)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Journey</CardTitle>
              <CardDescription>
                {data.journey.nextStep
                  ? `Next: ${data.journey.nextStep.label}`
                  : 'This lead is closed.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <JourneyTrack journey={data.journey} />
            </CardContent>
          </Card>

          {canDelete && (
            <Button
              variant="ghost"
              className="w-full text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              Delete lead
            </Button>
          )}
        </div>
      </div>

      {canUpdate && (
        <>
          <LogActivityDialog leadId={leadId} open={logOpen} onOpenChange={setLogOpen} />
          <EditLeadDialog lead={data} open={editOpen} onOpenChange={setEditOpen} />
        </>
      )}

      {/* Moving to a lost stage needs a reason — the server rejects it otherwise,
          and the funnel's "why did we lose" report depends on it being here. */}
      <Dialog open={lostFor !== null} onOpenChange={(open) => !open && setLostFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark this lead as lost</DialogTitle>
            <DialogDescription>
              A reason is required — it is what makes "we lose 40% at quotation"
              answerable later.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="lostReason">Reason</FieldLabel>
            <Textarea
              id="lostReason"
              rows={3}
              value={lostReason}
              onChange={(event) => setLostReason(event.target.value)}
              placeholder="Went with a competitor on price"
            />
          </Field>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLostFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!lostReason.trim() || changeStage.isPending}
              onClick={() =>
                lostFor &&
                changeStage.mutate(
                  { stageId: lostFor, lostReason: lostReason.trim() },
                  {
                    onSuccess: () => {
                      toast.success('Marked as lost')
                      setLostFor(null)
                      setLostReason('')
                    },
                    onError: (error) =>
                      toast.error(
                        error instanceof ApiError ? error.message : 'Could not change stage',
                      ),
                  },
                )
              }
            >
              {changeStage.isPending && <Spinner />}
              Mark as lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this lead?</DialogTitle>
            <DialogDescription>
              The lead and its whole timeline are removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteLead.isPending}
              onClick={() =>
                deleteLead.mutate(leadId, {
                  onSuccess: () => {
                    toast.success('Lead deleted')
                    void navigate({ to: '/leads' })
                  },
                  onError: (error) =>
                    toast.error(error instanceof ApiError ? error.message : 'Could not delete'),
                })
              }
            >
              {deleteLead.isPending && <Spinner />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ContactRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | null
  href?: string
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm">
          {value ? (
            href ? (
              <a href={href} className="underline-offset-4 hover:underline">
                {value}
              </a>
            ) : (
              value
            )
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </dd>
      </div>
    </div>
  )
}
