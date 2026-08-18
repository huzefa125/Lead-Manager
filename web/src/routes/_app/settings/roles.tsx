import { createFileRoute } from '@tanstack/react-router'
import { Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { CreateRoleDialog } from '@/features/rbac/create-role-dialog'
import {
  useDeleteRole,
  usePermissions,
  useRoles,
  useSetRolePermissions,
  useUsers,
} from '@/features/rbac/queries'
import { ApiError } from '@/lib/api'
import { humanize } from '@/lib/format'
import { Permissions, hasPermission } from '@/lib/permissions'
import type { PublicPermission, PublicRoleDetail } from '@/types/api'

export const Route = createFileRoute('/_app/settings/roles')({
  component: RolesPage,
})

function RolesPage() {
  const { user } = Route.useRouteContext()
  const roles = useRoles()
  const users = useUsers({ limit: 100 })
  const deleteRole = useDeleteRole()

  const [editing, setEditing] = useState<PublicRoleDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<PublicRoleDetail | null>(null)

  const canEdit = hasPermission(user.permissions, Permissions.ROLE_UPDATE)
  const canCreate = hasPermission(user.permissions, Permissions.ROLE_CREATE)
  const canDelete = hasPermission(user.permissions, Permissions.ROLE_DELETE)

  /** How many people hold each role — the server refuses to delete one still in use. */
  const holdersOf = (roleName: string) =>
    (users.data?.users ?? []).filter((member) =>
      member.roles.some((role) => role.name === roleName),
    ).length

  /** Mirrors `role.service.deleteRole`. */
  const blockedReason = (role: PublicRoleDetail) => {
    if (role.isSystem) return 'This is a system role and cannot be deleted.'

    const holders = holdersOf(role.name)
    if (holders > 0) {
      return `${holders} user(s) hold this role. Remove those assignments before deleting it.`
    }

    return null
  }

  return (
    <>
      <PageHeader
        title="Roles"
        description="Permissions are rows, not code — a role grants whatever you tick."
        actions={
          canCreate && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New role
            </Button>
          )
        }
      />

      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.isPending &&
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full" />
          ))}

        {(roles.data ?? []).map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-muted-foreground" />
                {role.displayName}
                {role.isSystem && <Lock className="size-3 text-muted-foreground" />}
              </CardTitle>
              <CardDescription>{role.description ?? role.name}</CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {role.permissions.includes('*') ? (
                  <Badge>Full access</Badge>
                ) : (
                  <>
                    {role.permissions.slice(0, 6).map((action) => (
                      <Badge key={action} variant="ghost" className="text-muted-foreground">
                        {action}
                      </Badge>
                    ))}
                    {role.permissions.length > 6 && (
                      <Badge variant="ghost" className="text-muted-foreground">
                        +{role.permissions.length - 6} more
                      </Badge>
                    )}
                  </>
                )}
                {role.permissions.length === 0 && (
                  <span className="text-sm text-muted-foreground">No permissions</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => setEditing(role)}>
                    Edit permissions
                  </Button>
                )}
                {canDelete && !role.isSystem && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${role.displayName}`}
                    onClick={() => setDeleting(role)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {canEdit && (
        <EditPermissionsDialog role={editing} onClose={() => setEditing(null)} />
      )}

      {canCreate && <CreateRoleDialog open={creating} onOpenChange={setCreating} />}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the "${deleting?.displayName}" role?`}
        description="The role and its grants are removed permanently."
        blockedReason={deleting ? blockedReason(deleting) : null}
        pending={deleteRole.isPending}
        onConfirm={() =>
          deleting &&
          deleteRole.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Role deleted')
              setDeleting(null)
            },
            onError: (error) =>
              toast.error(error instanceof ApiError ? error.message : 'Could not delete the role'),
          })
        }
      />
    </>
  )
}

function EditPermissionsDialog({
  role,
  onClose,
}: {
  role: PublicRoleDetail | null
  onClose: () => void
}) {
  const permissions = usePermissions()
  const setRolePermissions = useSetRolePermissions()
  const [selected, setSelected] = useState<string[] | null>(null)

  const current = selected ?? role?.permissions ?? []

  // Grouped by resource, which is how permissions are actually reasoned about
  // ("can this role touch leads at all?").
  const byResource = (permissions.data ?? []).reduce<Record<string, PublicPermission[]>>(
    (accumulator, permission) => {
      const bucket = accumulator[permission.resource] ?? []
      bucket.push(permission)
      accumulator[permission.resource] = bucket
      return accumulator
    },
    {},
  )

  const toggle = (action: string) =>
    setSelected(
      current.includes(action)
        ? current.filter((entry) => entry !== action)
        : [...current, action],
    )

  const close = () => {
    setSelected(null)
    onClose()
  }

  const hasWildcard = current.includes('*')

  return (
    <Dialog open={role !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permissions for {role?.displayName}</DialogTitle>
          <DialogDescription>
            This replaces the role's grants entirely. Everyone holding it has their sessions
            revoked so the change applies immediately.
          </DialogDescription>
        </DialogHeader>

        {hasWildcard && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            This role holds the global wildcard <code>*</code>, which grants everything —
            including resources that do not exist yet. The individual ticks below are
            redundant while it is set.
          </p>
        )}

        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          {Object.entries(byResource).map(([resource, entries]) => (
            <div key={resource}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {humanize(resource)}
              </p>
              <div className="grid gap-1 sm:grid-cols-2">
                {entries.map((permission) => (
                  <label
                    key={permission.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={current.includes(permission.action)}
                      onChange={() => toggle(permission.action)}
                    />
                    <span className="min-w-0 truncate">
                      {humanize(permission.operation)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {permission.action}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={setRolePermissions.isPending}
            onClick={() =>
              role &&
              setRolePermissions.mutate(
                { roleId: role.id, permissions: current },
                {
                  onSuccess: () => {
                    toast.success('Permissions updated')
                    close()
                  },
                  onError: (error) =>
                    toast.error(error instanceof ApiError ? error.message : 'Could not update'),
                },
              )
            }
          >
            {setRolePermissions.isPending && <Spinner />}
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
