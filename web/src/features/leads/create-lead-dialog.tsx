import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
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
import { useCreateLead } from '@/features/leads/queries'
import { ApiError } from '@/lib/api'

/**
 * Mirrors `createLeadSchema`, including its cross-field rule: a lead nobody can
 * be reached at is rejected at the server's door, so it is rejected here too
 * rather than sending a request that is guaranteed to fail.
 */
const formSchema = z
  .object({
    firstName: z.string().trim().max(100),
    lastName: z.string().trim().max(100),
    email: z.string().trim().email('Enter a valid email address').or(z.literal('')),
    phone: z.string().trim().max(32),
    company: z.string().trim().max(200),
    jobTitle: z.string().trim().max(150),
    sourceId: z.string().optional(),
    estimatedValue: z.string().trim(),
    currency: z.string().trim().length(3, 'Use a 3-letter code').or(z.literal('')),
    notes: z.string().trim().max(5000),
  })
  .refine((value) => Boolean(value.email || value.phone), {
    message: 'Provide at least an email or a phone number',
    path: ['email'],
  })

type FormValues = z.infer<typeof formSchema>

const EMPTY: FormValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  company: '',
  jobTitle: '',
  sourceId: undefined,
  estimatedValue: '',
  currency: '',
  notes: '',
}

export function CreateLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const sources = useLeadSources()
  const createLead = useCreateLead()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: EMPTY,
  })

  const onSubmit = form.handleSubmit((values) => {
    createLead.mutate(
      {
        ...(values.firstName ? { firstName: values.firstName } : {}),
        ...(values.lastName ? { lastName: values.lastName } : {}),
        ...(values.email ? { email: values.email } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.company ? { company: values.company } : {}),
        ...(values.jobTitle ? { jobTitle: values.jobTitle } : {}),
        ...(values.sourceId ? { sourceId: values.sourceId } : {}),
        ...(values.estimatedValue ? { estimatedValue: Number(values.estimatedValue) } : {}),
        ...(values.currency ? { currency: values.currency.toUpperCase() } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
      },
      {
        onSuccess: (result) => {
          // The server dedupes on contact details, so "created" is the honest
          // word only when a row actually appeared.
          toast.success(result.created ? 'Lead created' : 'Matched an existing open lead')
          form.reset(EMPTY)
          onOpenChange(false)
          void navigate({ to: '/leads/$leadId', params: { leadId: result.lead.id } })
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New lead</DialogTitle>
          <DialogDescription>
            Starts at the top of the pipeline, with a timeline entry recording who added it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="max-h-[60vh] overflow-y-auto px-1">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="firstName">First name</FieldLabel>
                <Input id="firstName" {...form.register('firstName')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="lastName">Last name</FieldLabel>
                <Input id="lastName" {...form.register('lastName')} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                aria-invalid={!!form.formState.errors.email}
                {...form.register('email')}
              />
              <FieldDescription>An email or a phone number is required.</FieldDescription>
              <FieldError errors={[form.formState.errors.email]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="phone">Phone</FieldLabel>
              <Input id="phone" type="tel" {...form.register('phone')} />
              <FieldError errors={[form.formState.errors.phone]} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="company">Company</FieldLabel>
                <Input id="company" {...form.register('company')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="jobTitle">Job title</FieldLabel>
                <Input id="jobTitle" {...form.register('jobTitle')} />
              </Field>
            </div>

            <Field>
              <FieldLabel>Source</FieldLabel>
              <Select
                value={form.watch('sourceId') ?? null}
                onValueChange={(value) => form.setValue('sourceId', (value as string) ?? undefined)}
                // Maps the selected id back to a name for the trigger.
                items={(sources.data ?? []).map((source) => ({
                  value: source.id,
                  label: source.name,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a source" />
                </SelectTrigger>
                <SelectContent>
                  {(sources.data ?? []).map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="estimatedValue">Estimated value</FieldLabel>
                <Input
                  id="estimatedValue"
                  type="number"
                  min="0"
                  step="0.01"
                  {...form.register('estimatedValue')}
                />
                <FieldError errors={[form.formState.errors.estimatedValue]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="currency">Currency</FieldLabel>
                <Input
                  id="currency"
                  placeholder="USD"
                  maxLength={3}
                  aria-invalid={!!form.formState.errors.currency}
                  {...form.register('currency')}
                />
                <FieldError errors={[form.formState.errors.currency]} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="notes">Notes</FieldLabel>
              <Textarea id="notes" rows={3} {...form.register('notes')} />
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createLead.isPending}>
              {createLead.isPending && <Spinner />}
              Create lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
