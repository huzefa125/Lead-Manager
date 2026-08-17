import { zodResolver } from '@hookform/resolvers/zod'
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AuthShell } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { sessionQueryOptions, useLogin } from '@/features/auth/queries'
import { ApiError } from '@/lib/api'

const searchSchema = z.object({
  /** Where to return to once signed in, set by the `_app` guard. */
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    // Already signed in — skip the form rather than letting them log in twice.
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions)
    if (user) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

const formSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type FormValues = z.infer<typeof formSchema>

function LoginPage() {
  const { redirect: redirectTo } = Route.useSearch()
  const navigate = useNavigate()
  const login = useLogin()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = form.handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: () => {
        void navigate({ to: redirectTo ?? '/' })
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          for (const [field, message] of Object.entries(error.fieldErrors)) {
            form.setError(field as keyof FormValues, { message })
          }
        }
      },
    })
  })

  // Bad credentials come back without a field, so they belong above the form
  // rather than pinned to the email input.
  const formError =
    login.error instanceof ApiError && login.error.details.length === 0
      ? login.error.message
      : null

  return (
    <AuthShell
      title="Sign in"
      description="Work your pipeline, and see where it is leaking."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
            Create one
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
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
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
              autoComplete="current-password"
              aria-invalid={!!form.formState.errors.password}
              {...form.register('password')}
            />
            <FieldError errors={[form.formState.errors.password]} />
          </Field>

          <Button type="submit" disabled={login.isPending}>
            {login.isPending && <Spinner />}
            Sign in
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
