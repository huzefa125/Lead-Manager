import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NotFound } from '@/components/not-found'
import { RouteError } from '@/components/route-error'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
})

function RootLayout() {
  return (
    <TooltipProvider>
      <Outlet />
      <Toaster position="top-right" richColors />
    </TooltipProvider>
  )
}
