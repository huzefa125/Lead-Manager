import { Link, useRouter } from '@tanstack/react-router'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ApiError } from '@/lib/api'

/**
 * The last line of defence for a thrown render or loader error.
 *
 * `ApiError` carries a message the server already decided was safe to show, so
 * it is surfaced verbatim. Anything else is a bug and gets a generic line —
 * an unexpected exception's message is for the console, not the user.
 */
export function RouteError({ error }: { error: Error }) {
  const router = useRouter()
  const isApiError = error instanceof ApiError

  const title = isApiError && error.status === 403 ? 'Not allowed' : 'Something went wrong'

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangle />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>
            {isApiError ? error.message : 'An unexpected error stopped this page from loading.'}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void router.invalidate()}>
              <RotateCw className="size-4" />
              Try again
            </Button>
            <Button render={<Link to="/" />}>Go to dashboard</Button>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}
