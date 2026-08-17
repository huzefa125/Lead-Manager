import { Link, useRouterState } from '@tanstack/react-router'
import {
  ChevronsUpDown,
  Droplets,
  GaugeCircle,
  LayoutDashboard,
  LogOut,
  Route as RouteIcon,
  Settings2,
  ShieldCheck,
  Timer,
  Users,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useLogout } from '@/features/auth/queries'
import { initials } from '@/lib/format'
import { Permissions, hasPermission } from '@/lib/permissions'
import type { PublicUser } from '@/types/api'

interface NavItem {
  title: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  /** Hidden when the user cannot use the screen at all. */
  permission?: string
}

const PIPELINE: NavItem[] = [
  { title: 'Dashboard', to: '/', icon: LayoutDashboard, permission: Permissions.LEAD_VIEW },
  { title: 'Leads', to: '/leads', icon: Users, permission: Permissions.LEAD_VIEW },
  { title: 'Follow-ups', to: '/follow-ups', icon: Timer, permission: Permissions.LEAD_VIEW },
]

const INTELLIGENCE: NavItem[] = [
  { title: 'Leakage', to: '/leakage', icon: Droplets, permission: Permissions.LEAD_VIEW },
  {
    title: 'Response times',
    to: '/response-times',
    icon: GaugeCircle,
    permission: Permissions.LEAD_VIEW,
  },
]

const CONFIGURATION: NavItem[] = [
  {
    title: 'Sources & stages',
    to: '/settings/pipeline',
    icon: RouteIcon,
    permission: Permissions.LEAD_SOURCE_VIEW,
  },
  { title: 'Team', to: '/settings/team', icon: Users, permission: Permissions.USER_VIEW },
  { title: 'Roles', to: '/settings/roles', icon: ShieldCheck, permission: Permissions.ROLE_VIEW },
]

export function AppSidebar({ user }: { user: PublicUser }) {
  const logout = useLogout()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  const visible = (items: NavItem[]) =>
    items.filter((item) => !item.permission || hasPermission(user.permissions, item.permission))

  const groups = [
    { label: 'Pipeline', items: visible(PIPELINE) },
    { label: 'Intelligence', items: visible(INTELLIGENCE) },
    { label: 'Configuration', items: visible(CONFIGURATION) },
  ].filter((group) => group.items.length > 0)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Settings2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">
                  {user.organization?.name ?? 'Lead Manager'}
                </span>
                <span className="truncate text-xs text-muted-foreground">Lead Manager</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      // `/` would otherwise match every route as a prefix.
                      isActive={
                        item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
                      }
                      tooltip={item.title}
                      render={<Link to={item.to} />}
                    >
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {initials(user.name, user.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">{user.name ?? user.email}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>

              <DropdownMenuContent side="top" align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="grid leading-tight">
                    <span className="truncate font-medium">{user.name ?? 'Signed in'}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {user.roles.map((role) => role.displayName).join(', ') || 'No roles'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={logout.isPending}
                  onClick={() => logout.mutate()}
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
