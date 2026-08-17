import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
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
import { useLeadSources } from '@/features/catalog/queries'
import { useUpdateLead, type UpdateLeadInput } from '@/features/leads/queries'
import { ApiError } from '@/lib/api'
import type { PublicLead } from '@/types/api'

/**
 * Editing mirrors `updateLeadSchema`, which deliberately excludes stage, status,
 * owner and every milestone — each of those has its own endpoint that writes a
 * timeline entry, and letting them through here would move the pipeline with no
 * record of who moved it.
 */
const formSchema = z.object({
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
  email: z.string().trim().email('Enter a valid email address').or(z.literal('')),
  phone: z
    .string()
    .trim()
    .regex(/^[+()\d][\d\s()+-]*$/, 'Digits, spaces and + ( ) - only')
    .min(6, 'Too short to be a phone number')
    .or(z.literal('')),
  whatsapp: z
    .string()
    .trim()
    .regex(/^[+()\d][\d\s()+-]*$/, 'Digits, spaces and + ( ) - only')
    .min(6, 'Too short to be a phone number')
    .or(z.literal('')),
  company: z.string().trim().max(200),
  jobTitle: z.string().trim().max(150),
  website: z.string().trim().url('Enter a valid URL').or(z.literal('')),

  sourceId: z.string().optional(),
  estimatedValue: z
    .string()
    .trim()
    .refine((value) => value === '' || Number(value) >= 0, 'Cannot be negative')
    .refine(
      (value) => value === '' || Math.round(Number(value) * 100) === Number(value) * 100,
      'At most 2 decimal places',
    ),
  currency: z.string().trim().length(3, 'Use a 3-letter code').or(z.literal('')),

  campaign: z.string().trim().max(200),
  landingPage: z.string().trim().max(2048),
  referrer: z.string().trim().max(2048),

  notes: z.string().trim().max(5000),
  lostReason: z.string().trim().max(500),
})

type FormValues = z.infer<typeof formSchema>

/**
 * Text fields the API cannot clear.
 *
 * `updateLeadSchema` runs them through a transform that turns `""` into
 * `undefined`, and the service skips every `undefined` key — so submitting a
 * blank one is a no-op that silently snaps back on the next read. Rather than
 * let that look like a failed save, blanking one is refused up front.
 */
const NOT_CLEARABLE = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'whatsapp',
  'company',
  'jobTitle',
  'website',
  'campaign',
  'landingPage',
  'referrer',
  'currency',
] as const satisfies readonly (keyof FormValues)[]

function toFormValues(lead: PublicLead): FormValues {
  return {
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    whatsapp: lead.whatsapp ?? '',
    company: lead.company ?? '',
    jobTitle: lead.jobTitle ?? '',
    website: lead.website ?? '',
    sourceId: lead.source?.id,
    estimatedValue: lead.estimatedValue === null ? '' : String(lead.estimatedValue),
    currency: lead.currency ?? '',
    campaign: lead.campaign ?? '',
    landingPage: lead.landingPage ?? '',
    referrer: lead.referrer ?? '',
    notes: lead.notes ?? '',
    lostReason: lead.lostReason ?? '',
  }
}

export function EditLeadDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: PublicLead
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const sources = useLeadSources()
  const updateLead = useUpdateLead(lead.id)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(lead),
  })

  // Reopening after an external change (a stage move, another tab) should show
  // the current lead, not the values captured when this component first mounted.
  useEffect(() => {
    if (open) form.reset(toFormValues(lead))
  }, [open, lead, form])

  const onSubmit = form.handleSubmit((values) => {
    const dirty = form.formState.dirtyFields

    const blanked = NOT_CLEARABLE.filter((name) => dirty[name] && values[name] === '')
    if (blanked.length > 0) {
      for (const name of blanked) {
        form.setError(name, {
          message: 'This field cannot be emptied — enter a value, or leave it as it was.',
        })
      }
      return
    }

    // Only what actually changed. Sending the whole form would rewrite fields
    // nobody touched, and the API rejects a patch with no keys at all.
    const patch: UpdateLeadInput = { id: lead.id }

    for (const name of NOT_CLEARABLE) {
      if (dirty[name] && values[name] !== '') {
        Object.assign(patch, {
          [name]: name === 'currency' ? values.currency.toUpperCase() : values[name],
        })
      }
    }

    if (dirty.sourceId && values.sourceId) patch.sourceId = values.sourceId

    // The three the schema marks nullable — these really can be cleared.
    if (dirty.estimatedValue) {
      patch.estimatedValue = values.estimatedValue === '' ? null : Number(values.estimatedValue)
    }
    if (dirty.notes) patch.notes = values.notes === '' ? null : values.notes
    if (dirty.lostReason) patch.lostReason = values.lostReason === '' ? null : values.lostReason

    if (Object.keys(patch).length === 1) {
      toast.info('Nothing changed')
      onOpenChange(false)
      return
    }

    updateLead.mutate(patch, {
      onSuccess: () => {
        toast.success('Lead updated')
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
    })
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit lead</DialogTitle>
          <DialogDescription>
            Stage, owner and status are changed from the panel on the right — each writes
            its own timeline entry.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="max-h-[60vh] overflow-y-auto px-1">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="edit-firstName">First name</FieldLabel>
                <Input id="edit-firstName" {...form.register('firstName')} />
                <FieldError errors={[form.formState.errors.firstName]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-lastName">Last name</FieldLabel>
                <Input id="edit-lastName" {...form.register('lastName')} />
                <FieldError errors={[form.formState.errors.lastName]} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="edit-email">Email</FieldLabel>
              <Input
                id="edit-email"
                type="email"
                aria-invalid={!!form.formState.errors.email}
                {...form.register('email')}
              />
              <FieldError errors={[form.formState.errors.email]} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="edit-phone">Phone</FieldLabel>
                <Input id="edit-phone" type="tel" {...form.register('phone')} />
                <FieldError errors={[form.formState.errors.phone]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-whatsapp">WhatsApp</FieldLabel>
                <Input id="edit-whatsapp" type="tel" {...form.register('whatsapp')} />
                <FieldError errors={[form.formState.errors.whatsapp]} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="edit-company">Company</FieldLabel>
                <Input id="edit-company" {...form.register('company')} />
                <FieldError errors={[form.formState.errors.company]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-jobTitle">Job title</FieldLabel>
                <Input id="edit-jobTitle" {...form.register('jobTitle')} />
                <FieldError errors={[form.formState.errors.jobTitle]} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="edit-website">Website</FieldLabel>
              <Input id="edit-website" {...form.register('website')} />
              <FieldError errors={[form.formState.errors.website]} />
            </Field>

            <Field>
              <FieldLabel>Source</FieldLabel>
              <Select
                value={form.watch('sourceId') ?? null}
                onValueChange={(value) =>
                  form.setValue('sourceId', (value as string) ?? undefined, {
                    shouldDirty: true,
                  })
                }
                items={(sources.data ?? []).map((source) => ({
                  value: source.id,
                  label: source.name,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No source" />
                </SelectTrigger>
                <SelectContent>
                  {(sources.data ?? []).map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Re-attributing a lead changes which source gets credit in every report.
              </FieldDescription>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="edit-estimatedValue">Estimated value</FieldLabel>
                <Input
                  id="edit-estimatedValue"
                  type="number"
                  min="0"
                  step="0.01"
                  aria-invalid={!!form.formState.errors.estimatedValue}
                  {...form.register('estimatedValue')}
                />
                <FieldDescription>Leave blank to clear it.</FieldDescription>
                <FieldError errors={[form.formState.errors.estimatedValue]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-currency">Currency</FieldLabel>
                <Input
                  id="edit-currency"
                  maxLength={3}
                  aria-invalid={!!form.formState.errors.currency}
                  {...form.register('currency')}
                />
                <FieldError errors={[form.formState.errors.currency]} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="edit-campaign">Campaign</FieldLabel>
              <Input id="edit-campaign" {...form.register('campaign')} />
              <FieldError errors={[form.formState.errors.campaign]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-landingPage">Landing page</FieldLabel>
              <Input id="edit-landingPage" {...form.register('landingPage')} />
              <FieldError errors={[form.formState.errors.landingPage]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-referrer">Referrer</FieldLabel>
              <Input id="edit-referrer" {...form.register('referrer')} />
              <FieldError errors={[form.formState.errors.referrer]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-notes">Notes</FieldLabel>
              <Textarea id="edit-notes" rows={3} {...form.register('notes')} />
              <FieldDescription>Leave blank to clear.</FieldDescription>
              <FieldError errors={[form.formState.errors.notes]} />
            </Field>

            {lead.status === 'LOST' && (
              <Field>
                <FieldLabel htmlFor="edit-lostReason">Lost reason</FieldLabel>
                <Textarea id="edit-lostReason" rows={2} {...form.register('lostReason')} />
                <FieldError errors={[form.formState.errors.lostReason]} />
              </Field>
            )}
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateLead.isPending}>
              {updateLead.isPending && <Spinner />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
