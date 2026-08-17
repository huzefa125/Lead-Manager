import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

/**
 * The bar every screen sits under: sidebar toggle, title, and a slot for the
 * page's primary actions.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur-md">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {description && (
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
