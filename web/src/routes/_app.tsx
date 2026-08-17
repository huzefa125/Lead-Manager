import { Outlet, createFileRoute, redirect, useRouterState } from '@tanstack/react-router'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { sessionQueryOptions } from '@/features/auth/queries'

/**
 * The authenticated shell.
 *
 * The guard runs in `beforeLoad`, so an expired session redirects before any
 * child route fires a request that would only 401. `ensureQueryData` shares
 * one refresh call across the whole navigation.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions)

    if (!user) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    return { user }
  },
  component: AppLayout,
})

function AppLayout() {
  const { user } = Route.useRouteContext()
  const isNavigating = useRouterState({ select: (state) => state.status === 'pending' })

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset className="min-w-0">
        {/* A hairline that fills while a route loads — enough feedback for a
            navigation without tearing the page down to skeletons. */}
        <div
          aria-hidden
          className={`fixed inset-x-0 top-0 z-50 h-0.5 bg-primary transition-opacity duration-200 ${
            isNavigating ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
