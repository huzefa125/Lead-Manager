import { createFileRoute } from '@tanstack/react-router'
import { Lock, Plus } from 'lucide-react'
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
import {
  useCreateSource,
  useCreateStage,
  useLeadSources,
  useLeadStages,
  useUpdateSource,
} from '@/features/catalog/queries'
import { ApiError } from '@/lib/api'
import { CHANNEL_LABELS, formatNumber } from '@/lib/format'
import { Permissions, hasPermission } from '@/lib/permissions'
import { LEAD_CHANNELS } from '@/types/api'
import type { LeadChannel } from '@/types/api'

export const Route = createFileRoute('/_app/settings/pipeline')({
  component: PipelineSettingsPage,
})

function PipelineSettingsPage() {
  const { user } = Route.useRouteContext()

  const canEditSources = hasPermission(user.permissions, Permissions.LEAD_SOURCE_UPDATE)
  const canCreateSources = hasPermission(user.permissions, Permissions.LEAD_SOURCE_CREATE)
  const canCreateStages = hasPermission(user.permissions, Permissions.LEAD_STAGE_CREATE)

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
            <SourcesPanel canEdit={canEditSources} canCreate={canCreateSources} />
          </TabsContent>

          <TabsContent value="stages" className="mt-4">
            <StagesPanel canCreate={canCreateStages} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

function SourcesPanel({ canEdit, canCreate }: { canEdit: boolean; canCreate: boolean }) {
  const sources = useLeadSources(true)
  const updateSource = useUpdateSource()
  const [createOpen, setCreateOpen] = useState(false)

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

            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                disabled={updateSource.isPending}
                onClick={() =>
                  updateSource.mutate(
                    { id: source.id, isActive: !source.isActive },
                    {
                      onSuccess: () =>
                        toast.success(
                          source.isActive ? 'Source deactivated' : 'Source activated',
                        ),
                      onError: (error) =>
                        toast.error(
                          error instanceof ApiError ? error.message : 'Could not update',
                        ),
                    },
                  )
                }
              >
                {source.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            )}
          </div>
        ))}
      </CardContent>

      {canCreate && <CreateSourceDialog open={createOpen} onOpenChange={setCreateOpen} />}
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
                  onError: (error) =>
                    toast.error(error instanceof ApiError ? error.message : 'Could not create'),
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

function StagesPanel({ canCreate }: { canCreate: boolean }) {
  const stages = useLeadStages()
  const createStage = useCreateStage()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

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
            <Button size="sm" onClick={() => setOpen(true)}>
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

        {(stages.data ?? []).map((stage) => (
          <div
            key={stage.id}
            className="flex items-center justify-between gap-3 rounded-xl border p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
                {stage.position}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {stage.name}
                  {stage.isSystem && <Lock className="size-3 text-muted-foreground" />}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {stage.description ?? stage.key}
                  {stage.leadCount !== undefined && ` · ${formatNumber(stage.leadCount)} leads`}
                </p>
              </div>
            </div>

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
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
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
            <Button variant="outline" onClick={() => setOpen(false)}>
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
                      setOpen(false)
                    },
                    onError: (error) =>
                      toast.error(
                        error instanceof ApiError ? error.message : 'Could not create',
                      ),
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
    </Card>
  )
}
