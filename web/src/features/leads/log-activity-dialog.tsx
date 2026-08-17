import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useLogActivity } from '@/features/leads/queries'
import { ApiError } from '@/lib/api'
import { ACTIVITY_LABELS, milestoneLabel } from '@/lib/format'
import { LOGGABLE_ACTIVITY_TYPES } from '@/types/api'
import type { LeadActivityDirection, LeadActivityType } from '@/types/api'

const formSchema = z.object({
  type: z.string().min(1),
  direction: z.string().min(1),
  subject: z.string().trim().max(200),
  body: z.string().trim().max(10_000),
  durationMinutes: z.string().trim(),
})

type FormValues = z.infer<typeof formSchema>

const DIRECTIONS: { value: LeadActivityDirection; label: string; hint: string }[] = [
  { value: 'OUTBOUND', label: 'Outbound', hint: 'We reached out' },
  { value: 'INBOUND', label: 'Inbound', hint: 'They came to us' },
  { value: 'INTERNAL', label: 'Internal', hint: 'Not contact — does not move the funnel' },
]

/**
 * Logging work is the one write that moves the journey: an OUTBOUND call sets
 * first contact, an INBOUND one sets first reply. The direction field is
 * therefore not a detail — it decides what the funnel says — so its meaning is
 * spelled out rather than left to the label.
 */
export function LogActivityDialog({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const logActivity = useLogActivity(leadId)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: 'CALL',
      direction: 'OUTBOUND',
      subject: '',
      body: '',
      durationMinutes: '',
    },
  })

  const direction = form.watch('direction')

  const onSubmit = form.handleSubmit((values) => {
    logActivity.mutate(
      {
        type: values.type as LeadActivityType,
        direction: values.direction as LeadActivityDirection,
        ...(values.subject ? { subject: values.subject } : {}),
        ...(values.body ? { body: values.body } : {}),
        ...(values.durationMinutes
          ? { durationMinutes: Number(values.durationMinutes) }
          : {}),
      },
      {
        onSuccess: (result) => {
          // `advanced` names the milestones this entry moved — telling the user
          // beats leaving them to spot a number changing elsewhere.
          toast.success(
            result.advanced.length > 0
              ? `Logged — this lead now counts as ${result.advanced
                  .map(milestoneLabel)
                  .join(', ')}`
              : 'Activity logged',
          )
          form.reset()
          onOpenChange(false)
        },
        onError: (error) => {
          if (error instanceof ApiError) {
            for (const [field, message] of Object.entries(error.fieldErrors)) {
              form.setError(field as keyof FormValues, { message })
            }
            if (error.details.length === 0) toast.error(error.message)
          }
        },
      },
    )
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log activity</DialogTitle>
          <DialogDescription>
            Recorded on the timeline and used to advance this lead's journey.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Type</FieldLabel>
                <Select
                  value={form.watch('type')}
                  onValueChange={(value) => form.setValue('type', value as string)}
                  items={LOGGABLE_ACTIVITY_TYPES.map((type) => ({
                    value: type,
                    label: ACTIVITY_LABELS[type],
                  }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOGGABLE_ACTIVITY_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {ACTIVITY_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Direction</FieldLabel>
                <Select
                  value={direction}
                  onValueChange={(value) => form.setValue('direction', value as string)}
                  items={DIRECTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIRECTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {DIRECTIONS.find((option) => option.value === direction)?.hint}
                </FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="subject">Subject</FieldLabel>
              <Input id="subject" {...form.register('subject')} />
              <FieldError errors={[form.formState.errors.subject]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="body">Notes</FieldLabel>
              <Textarea id="body" rows={4} {...form.register('body')} />
              <FieldError errors={[form.formState.errors.body]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="durationMinutes">Duration (minutes)</FieldLabel>
              <Input
                id="durationMinutes"
                type="number"
                min="0"
                max="1440"
                {...form.register('durationMinutes')}
              />
              <FieldError errors={[form.formState.errors.durationMinutes]} />
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={logActivity.isPending}>
              {logActivity.isPending && <Spinner />}
              Log activity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
