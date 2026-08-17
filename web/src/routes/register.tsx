import { zodResolver } from '@hookform/resolvers/zod'
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AuthShell } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { sessionQueryOptions, useRegister } from '@/features/auth/queries'
import { ApiError } from '@/lib/api'

export const Route = createFileRoute('/register')({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions)
    if (user) throw redirect({ to: '/' })
  },
  component: RegisterPage,
})

/** Mirrors the server's `registerSchema`, so the rules are shown before submit. */
const formSchema = z.object({
  name: z.string().trim().max(100).optional(),
  organizationName: z
    .string()
    .trim()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100)
    .optional()
    .or(z.literal('')),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/\d/, 'Password must contain a number'),
})

type FormValues = z.infer<typeof formSchema>

function RegisterPage() {
  const navigate = useNavigate()
  const register = useRegister()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', organizationName: '', email: '', password: '' },
  })

  const onSubmit = form.handleSubmit((values) => {
    register.mutate(
      {
        email: values.email,
        password: values.password,
        // Empty optional strings are omitted rather than sent as "" — the
        // server derives a personal organization name when it is absent.
        ...(values.name ? { name: values.name } : {}),
        ...(values.organizationName ? { organizationName: values.organizationName } : {}),
      },
      {
        onSuccess: () => {
          void navigate({ to: '/' })
        },
        onError: (error) => {
          if (error instanceof ApiError) {
            for (const [field, message] of Object.entries(error.fieldErrors)) {
              form.setError(field as keyof FormValues, { message })
            }
          }
        },
      },
    )
  })

  const formError =
    register.error instanceof ApiError && register.error.details.length === 0
      ? register.error.message
      : null

  return (
    <AuthShell
      title="Create your workspace"
      description="Sets up an organization with the default pipeline, ready to take a lead."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          {formError && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <Field>
            <FieldLabel htmlFor="name">Your name</FieldLabel>
            <Input id="name" autoComplete="name" autoFocus {...form.register('name')} />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="organizationName">Organization</FieldLabel>
            <Input
              id="organizationName"
              autoComplete="organization"
              aria-invalid={!!form.formState.errors.organizationName}
              {...form.register('organizationName')}
            />
            <FieldDescription>Optional — one is created from your name if left blank.</FieldDescription>
            <FieldError errors={[form.formState.errors.organizationName]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!form.formState.errors.email}
              {...form.register('email')}
            />
            <FieldError errors={[form.formState.errors.email]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!form.formState.errors.password}
              {...form.register('password')}
            />
            <FieldDescription>
              At least 8 characters, with an uppercase letter, a lowercase letter and a number.
            </FieldDescription>
            <FieldError errors={[form.formState.errors.password]} />
          </Field>

          <Button type="submit" disabled={register.isPending}>
            {register.isPending && <Spinner />}
            Create account
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
