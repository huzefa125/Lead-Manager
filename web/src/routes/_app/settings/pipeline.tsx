import { createFileRoute } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  useCreateSource,
  useCreateStage,
  useDeleteSource,
  useDeleteStage,
  useLeadSources,
  useLeadStages,
  useUpdateSource,
  useUpdateStage,
} from '@/features/catalog/queries'
import { ApiError } from '@/lib/api'
import { CHANNEL_LABELS, formatNumber } from '@/lib/format'
import { Permissions, hasPermission } from '@/lib/permissions'
import { LEAD_CHANNELS } from '@/types/api'
import type { LeadChannel, PublicLeadSource, PublicLeadStage } from '@/types/api'

export const Route = createFileRoute('/_app/settings/pipeline')({
  component: PipelineSettingsPage,
})

/** Turns a failed mutation into a toast, preferring the server's own wording. */
function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback)
}

function PipelineSettingsPage() {
  const { user } = Route.useRouteContext()

  const can = (permission: string) => hasPermission(user.permissions, permission)

  return (
    <>
      <PageHeader
        title="Sources & stages"
        description="Your pipeline is data, not code — rename, add and deactivate freely."
      />

      <div className="p-4">
        <Tabs defaultValue="sources">
          <TabsList>
            <TabsTrigger value="sources">Sources</TabsTrigger>
            <TabsTrigger value="stages">Stages</TabsTrigger>
          </TabsList>

          <TabsContent value="sources" className="mt-4">
            <SourcesPanel
              canEdit={can(Permissions.LEAD_SOURCE_UPDATE)}
              canCreate={can(Permissions.LEAD_SOURCE_CREATE)}
              canDelete={can(Permissions.LEAD_SOURCE_DELETE)}
            />
          </TabsContent>

          <TabsContent value="stages" className="mt-4">
            <StagesPanel
              canEdit={can(Permissions.LEAD_STAGE_UPDATE)}
              canCreate={can(Permissions.LEAD_STAGE_CREATE)}
              canDelete={can(Permissions.LEAD_STAGE_DELETE)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

// --- Sources ----------------------------------------------------------------

function SourcesPanel({
  canEdit,
  canCreate,
  canDelete,
}: {
  canEdit: boolean
  canCreate: boolean
  canDelete: boolean
}) {
  const sources = useLeadSources(true)
  const updateSource = useUpdateSource()
  const deleteSource = useDeleteSource()

  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<PublicLeadSource | null>(null)

  /**
   * Mirrors `catalog.service.deleteSource`. Checked here so the button explains
   * itself instead of the user discovering the rule through a 409.
   */
  const blockedReason = (source: PublicLeadSource) => {
    if (source.isSystem) return 'This is a system source. Deactivate it instead of deleting it.'
    if (source.leadCount) {
      return `${formatNumber(source.leadCount)} lead(s) came from this source. Deleting it would erase their attribution — deactivate it instead.`
    }
    return null
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Lead sources</CardTitle>
            <CardDescription>
              Where leads come from. A source's key and channel are fixed once created —
              integrations address it by key, and changing the channel would re-attribute
              every lead that ever came through it.
            </CardDescription>
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Add
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {sources.isPending &&
          Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}

        {(sources.data ?? []).map((source) => (
          <div
            key={source.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm font-medium">
                {source.name}
                {source.isSystem && <Lock className="size-3 text-muted-foreground" />}
                {!source.isActive && (
                  <Badge variant="ghost" className="text-muted-foreground">
                    Inactive
                  </Badge>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {/* The seeded sources are named after their channel; repeating
                    it adds a word and no information. */}
                {[
                  CHANNEL_LABELS[source.channel] === source.name
                    ? null
                    : CHANNEL_LABELS[source.channel],
                  source.key,
                  source.leadCount === undefined
                    ? null
                    : `${formatNumber(source.leadCount)} leads`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {canEdit && (
                // A system source is what capture falls back to when an
                // integration names none, so switching it off would send the
                // next webhook nowhere — the server refuses, and so does this.
                <ActionButton
                  label={source.isActive ? 'Deactivate' : 'Activate'}
                  disabledReason={
                    source.isSystem && source.isActive
                      ? 'Capture falls back to this source, so it cannot be switched off.'
                      : null
                  }
                  pending={updateSource.isPending}
                  onClick={() =>
                    updateSource.mutate(
                      { id: source.id, isActive: !source.isActive },
                      {
                        onSuccess: () =>
                          toast.success(
                            source.isActive ? 'Source deactivated' : 'Source activated',
                          ),
                        onError: (error) => reportError(error, 'Could not update the source'),
                      },
                    )
                  }
                />
              )}

              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${source.name}`}
                  onClick={() => setDeleting(source)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      {canCreate && <CreateSourceDialog open={createOpen} onOpenChange={setCreateOpen} />}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="The source is removed permanently. Leads already attributed to it would lose that attribution, so this is only possible while none exist."
        blockedReason={deleting ? blockedReason(deleting) : null}
        pending={deleteSource.isPending}
        onConfirm={() =>
          deleting &&
          deleteSource.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Source deleted')
              setDeleting(null)
            },
            onError: (error) => reportError(error, 'Could not delete the source'),
          })
        }
      />
    </Card>
  )
}

function CreateSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createSource = useCreateSource()
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<LeadChannel>('WEBSITE_FORM')
  const [description, setDescription] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New lead source</DialogTitle>
          <DialogDescription>
            Split a channel as finely as you need — "Google Ads — Brand" and "Google Ads —
            Competitor" are two sources over one channel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="sourceName">Name</FieldLabel>
            <Input
              id="sourceName"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>Channel</FieldLabel>
            <Select
              value={channel}
              onValueChange={(value) => setChannel(value as LeadChannel)}
              items={LEAD_CHANNELS.map((option) => ({
                value: option,
                label: CHANNEL_LABELS[option],
              }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_CHANNELS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {CHANNEL_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Cannot be changed later.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="sourceDescription">Description</FieldLabel>
            <Textarea
              id="sourceDescription"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={name.trim().length < 2 || createSource.isPending}
            onClick={() =>
              createSource.mutate(
                {
                  name: name.trim(),
                  channel,
                  ...(description.trim() ? { description: description.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    toast.success('Source created')
                    setName('')
                    setDescription('')
                    onOpenChange(false)
                  },
                  onError: (error) => reportError(error, 'Could not create the source'),
                },
              )
            }
          >
            {createSource.isPending && <Spinner />}
            Create source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Stages -----------------------------------------------------------------

function StagesPanel({
  canEdit,
  canCreate,
  canDelete,
}: {
  canEdit: boolean
  canCreate: boolean
  canDelete: boolean
}) {
  const stages = useLeadStages()
  const updateStage = useUpdateStage()
  const deleteStage = useDeleteStage()

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<PublicLeadStage | null>(null)
  const [deleting, setDeleting] = useState<PublicLeadStage | null>(null)

  const ordered = [...(stages.data ?? [])].sort((a, b) => a.position - b.position)

  /**
   * Reordering swaps the two rows' `position` values. `position` is indexed but
   * not unique, so a plain swap needs no temporary value — and the two writes
   * are issued together so the list never renders half-swapped.
   */
  const move = (index: number, direction: -1 | 1) => {
    const current = ordered[index]
    const neighbour = ordered[index + direction]
    if (!current || !neighbour) return

    Promise.all([
      updateStage.mutateAsync({ id: current.id, position: neighbour.position }),
      updateStage.mutateAsync({ id: neighbour.id, position: current.position }),
    ])
      .then(() => toast.success(`Moved "${current.name}"`))
      .catch((error) => reportError(error, 'Could not reorder the stages'))
  }

  /** Mirrors `catalog.service.deleteStage`. */
  const blockedReason = (stage: PublicLeadStage) => {
    if (stage.isSystem) {
      return 'This is a system stage — the journey engine and the funnel are defined in terms of it.'
    }
    if (stage.leadCount) {
      return `${formatNumber(stage.leadCount)} lead(s) are in this stage. Move them elsewhere first.`
    }
    return null
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Pipeline stages</CardTitle>
            <CardDescription>
              Ordered by position. A stage's type is fixed once created — flipping one from
              open to won would silently reclassify every lead sitting in it as revenue.
            </CardDescription>
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Add
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {stages.isPending &&
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}

        {ordered.map((stage, index) => (
          <div
            key={stage.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              {canEdit && (
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-5"
                    aria-label={`Move ${stage.name} earlier`}
                    disabled={index === 0 || updateStage.isPending}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-5"
                    aria-label={`Move ${stage.name} later`}
                    disabled={index === ordered.length - 1 || updateStage.isPending}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown className="size-3" />
                  </Button>
                </div>
              )}

              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
                {stage.position}
              </span>

              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {stage.name}
                  {stage.isSystem && <Lock className="size-3 text-muted-foreground" />}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    stage.description ?? stage.key,
                    stage.leadCount === undefined
                      ? null
                      : `${formatNumber(stage.leadCount)} leads`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant="outline"
                className={
                  stage.type === 'WON'
                    ? 'border-status-good/40 text-status-good'
                    : stage.type === 'LOST'
                      ? 'border-status-critical/40 text-status-critical'
                      : undefined
                }
              >
                {stage.type === 'OPEN' ? 'Open' : stage.type === 'WON' ? 'Won' : 'Lost'}
              </Badge>

              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${stage.name}`}
                  onClick={() => setEditing(stage)}
                >
                  <Pencil className="size-4" />
                </Button>
              )}

              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${stage.name}`}
                  onClick={() => setDeleting(stage)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      {canCreate && <CreateStageDialog open={createOpen} onOpenChange={setCreateOpen} />}

      {canEdit && (
        <EditStageDialog stage={editing} onClose={() => setEditing(null)} />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="The stage is removed from the pipeline permanently."
        blockedReason={deleting ? blockedReason(deleting) : null}
        pending={deleteStage.isPending}
        onConfirm={() =>
          deleting &&
          deleteStage.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Stage deleted')
              setDeleting(null)
            },
            onError: (error) => reportError(error, 'Could not delete the stage'),
          })
        }
      />
    </Card>
  )
}

function EditStageDialog({
  stage,
  onClose,
}: {
  stage: PublicLeadStage | null
  onClose: () => void
}) {
  const updateStage = useUpdateStage()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loaded, setLoaded] = useState<string | null>(null)

  // Load the stage's values the first time the dialog opens for it, without
  // clobbering what the user has typed on every re-render.
  if (stage && loaded !== stage.id) {
    setLoaded(stage.id)
    setName(stage.name)
    setDescription(stage.description ?? '')
  }

  const close = () => {
    setLoaded(null)
    onClose()
  }

  return (
    <Dialog open={stage !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit stage</DialogTitle>
          <DialogDescription>
            The key and the type stay as they are: integrations address the stage by key,
            and its type decides whether landing here counts as revenue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="stageEditName">Name</FieldLabel>
            <Input
              id="stageEditName"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="stageEditDescription">Description</FieldLabel>
            <Textarea
              id="stageEditDescription"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <FieldDescription>Leave blank to clear.</FieldDescription>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={name.trim().length < 2 || updateStage.isPending}
            onClick={() =>
              stage &&
              updateStage.mutate(
                {
                  id: stage.id,
                  name: name.trim(),
                  description: description.trim() === '' ? null : description.trim(),
                },
                {
                  onSuccess: () => {
                    toast.success('Stage updated')
                    close()
                  },
                  onError: (error) => reportError(error, 'Could not update the stage'),
                },
              )
            }
          >
            {updateStage.isPending && <Spinner />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateStageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createStage = useCreateStage()
  const [name, setName] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New stage</DialogTitle>
          <DialogDescription>
            Added as an open stage at the end of the pipeline.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="stageName">Name</FieldLabel>
          <Input
            id="stageName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Negotiation"
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={name.trim().length < 2 || createStage.isPending}
            onClick={() =>
              createStage.mutate(
                { name: name.trim(), type: 'OPEN' },
                {
                  onSuccess: () => {
                    toast.success('Stage created')
                    setName('')
                    onOpenChange(false)
                  },
                  onError: (error) => reportError(error, 'Could not create the stage'),
                },
              )
            }
          >
            {createStage.isPending && <Spinner />}
            Create stage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A button that explains, on hover, why it is unavailable. */
function ActionButton({
  label,
  disabledReason,
  pending,
  onClick,
}: {
  label: string
  disabledReason: string | null
  pending: boolean
  onClick: () => void
}) {
  const button = (
    <Button variant="outline" size="sm" disabled={pending || Boolean(disabledReason)} onClick={onClick}>
      {label}
    </Button>
  )

  if (!disabledReason) return button

  return (
    <Tooltip>
      {/* A disabled button fires no pointer events, so the tooltip needs a
          wrapper that can still receive them. */}
      <TooltipTrigger render={<span tabIndex={0} />}>{button}</TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  )
}
