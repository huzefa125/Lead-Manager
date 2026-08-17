import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRoles, useSetUserRoles, useUsers } from '@/features/rbac/queries'
import { ApiError } from '@/lib/api'
import { initials } from '@/lib/format'
import { Permissions, hasPermission } from '@/lib/permissions'
import type { PublicUser } from '@/types/api'

export const Route = createFileRoute('/_app/settings/team')({
  component: TeamPage,
})

function TeamPage() {
  const { user } = Route.useRouteContext()
  const users = useUsers({ limit: 50 })
  const [editing, setEditing] = useState<PublicUser | null>(null)

  const canAssignRoles = hasPermission(user.permissions, Permissions.ROLE_ASSIGN)

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone in this organization, and what they are allowed to do."
      />

      <div className="p-4">
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Status</TableHead>
                    {canAssignRoles && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {users.isPending &&
                    Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={index}>
                        {Array.from({ length: canAssignRoles ? 4 : 3 }).map((__, cell) => (
                          <TableCell key={cell}>
                            <Skeleton className="h-6 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}

                  {(users.data?.users ?? []).map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarFallback>
                              {initials(member.name, member.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {member.name ?? member.email}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {member.roles.length > 0 ? (
                            member.roles.map((role) => (
                              <Badge key={role.id} variant="secondary">
                                {role.displayName}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">No roles</span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>
                        {member.isActive ? (
                          <Badge variant="outline" className="border-status-good/40 text-status-good">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-status-critical/40 text-status-critical">
                            Disabled
                          </Badge>
                        )}
                      </TableCell>

                      {canAssignRoles && (
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setEditing(member)}>
                            Edit roles
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {canAssignRoles && (
        <EditRolesDialog member={editing} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

function EditRolesDialog({
  member,
  onClose,
}: {
  member: PublicUser | null
  onClose: () => void
}) {
  const roles = useRoles()
  const setUserRoles = useSetUserRoles()
  const [selected, setSelected] = useState<string[] | null>(null)

  // Initialised from the member the first time the dialog opens for them.
  const current = selected ?? member?.roles.map((role) => role.name) ?? []

  const toggle = (name: string) =>
    setSelected(
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    )

  const close = () => {
    setSelected(null)
    onClose()
  }

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roles for {member?.name ?? member?.email}</DialogTitle>
          <DialogDescription>
            Saving revokes this user's sessions, so the change takes effect on their next
            request rather than whenever their token happens to expire.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {(roles.data ?? []).map((role) => {
            const checked = current.includes(role.name)

            return (
              <label
                key={role.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={checked}
                  onChange={() => toggle(role.name)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{role.displayName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {role.description ?? `${role.permissions.length} permissions`}
                  </span>
                </span>
              </label>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={setUserRoles.isPending}
            onClick={() =>
              member &&
              setUserRoles.mutate(
                { userId: member.id, roles: current },
                {
                  onSuccess: () => {
                    toast.success('Roles updated — their sessions were revoked')
                    close()
                  },
                  onError: (error) =>
                    toast.error(error instanceof ApiError ? error.message : 'Could not update'),
                },
              )
            }
          >
            {setUserRoles.isPending && <Spinner />}
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
