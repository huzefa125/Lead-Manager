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
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useCreateRole } from '@/features/rbac/queries'
import { ApiError } from '@/lib/api'

/**
 * Mirrors `createRoleSchema`.
 *
 * `name` is the machine identifier that seeds and code reference, so the server
 * constrains it to lower_snake_case and refuses to let it change afterwards —
 * both facts are stated here rather than discovered through a 422.
 */
const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(50)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Lowercase letters, digits and underscores only, starting with a letter',
    ),
  displayName: z.string().trim().min(1, 'Required').max(100),
  description: z.string().trim().max(500),
})

type FormValues = z.infer<typeof formSchema>

/** "Finance Manager" -> "finance_manager", so the key does not have to be typed twice. */
function toRoleKey(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
}

export function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createRole = useCreateRole()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', displayName: '', description: '' },
  })

  const onSubmit = form.handleSubmit((values) => {
    createRole.mutate(
      {
        name: values.name,
        displayName: values.displayName,
        ...(values.description ? { description: values.description } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Role created — it starts with no permissions')
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
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            Created with no permissions. Grant them from the role's card once it exists.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="roleDisplayName">Display name</FieldLabel>
              <Input
                id="roleDisplayName"
                placeholder="Finance Manager"
                aria-invalid={!!form.formState.errors.displayName}
                {...form.register('displayName', {
                  // Fill the key from the label until the key is edited by hand.
                  onChange: (event) => {
                    if (!form.formState.dirtyFields.name) {
                      form.setValue('name', toRoleKey(event.target.value))
                    }
                  },
                })}
              />
              <FieldError errors={[form.formState.errors.displayName]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="roleName">Key</FieldLabel>
              <Input
                id="roleName"
                placeholder="finance_manager"
                aria-invalid={!!form.formState.errors.name}
                {...form.register('name')}
              />
              <FieldDescription>
                How code and seeds refer to this role. It cannot be changed later.
              </FieldDescription>
              <FieldError errors={[form.formState.errors.name]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="roleDescription">Description</FieldLabel>
              <Textarea id="roleDescription" rows={2} {...form.register('description')} />
              <FieldError errors={[form.formState.errors.description]} />
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createRole.isPending}>
              {createRole.isPending && <Spinner />}
              Create role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
