import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Pagination, PublicPermission, PublicRoleDetail, PublicUser } from '@/types/api'

/**
 * Users, roles and permissions.
 *
 * The user list doubles as the assignee picker on the lead screens, so it is
 * cached with a generous stale time and requested at a large page size — a
 * tenant's sales team is tens of people, not thousands.
 */

const FIVE_MINUTES = 5 * 60 * 1000

export const rbacKeys = {
  users: (params: UserListParams) => ['users', params] as const,
  roles: () => ['roles'] as const,
  permissions: () => ['permissions'] as const,
}

/**
 * A type alias, not an interface, so it satisfies `QueryParams`' index
 * signature — TypeScript infers one for aliases but never for interfaces.
 * Every params shape passed to `api.get` follows this rule.
 */
export type UserListParams = {
  page?: number
  limit?: number
  search?: string
  role?: string
}

export interface UserListResult {
  users: PublicUser[]
  pagination: Pagination
}

export function useUsers(params: UserListParams = {}) {
  return useQuery({
    queryKey: rbacKeys.users(params),
    queryFn: ({ signal }) => api.get<UserListResult>('/users', params, signal),
    staleTime: FIVE_MINUTES,
    placeholderData: (previous) => previous,
  })
}

/** The assignee picker's source. Fails soft: a rep without `user.view` still works. */
export function useAssignableUsers() {
  return useQuery({
    queryKey: rbacKeys.users({ limit: 100 }),
    queryFn: ({ signal }) => api.get<UserListResult>('/users', { limit: 100 }, signal),
    staleTime: FIVE_MINUTES,
    retry: false,
  })
}

export function useRoles() {
  return useQuery({
    queryKey: rbacKeys.roles(),
    queryFn: ({ signal }) =>
      api
        .get<{ roles: PublicRoleDetail[]; pagination: Pagination }>(
          '/roles',
          { limit: 100 },
          signal,
        )
        .then((data) => data.roles),
    staleTime: FIVE_MINUTES,
  })
}

export function usePermissions() {
  return useQuery({
    queryKey: rbacKeys.permissions(),
    queryFn: ({ signal }) =>
      api
        .get<{ permissions: PublicPermission[]; pagination: Pagination }>(
          // 100 is the server's max page size; the seeded catalogue fits well inside it.
          '/permissions',
          { limit: 100 },
          signal,
        )
        .then((data) => data.permissions),
    staleTime: FIVE_MINUTES,
  })
}

export function useSetUserRoles() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, roles }: { userId: string; roles: string[] }) =>
      api.put<{ user: PublicUser; message: string }>(`/users/${userId}/roles`, { roles }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useSetRolePermissions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ roleId, permissions }: { roleId: string; permissions: string[] }) =>
      api.put<{ role: PublicRoleDetail }>(`/roles/${roleId}/permissions`, { permissions }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rbacKeys.roles() }),
  })
}

export interface CreateRoleInput {
  name: string
  displayName: string
  description?: string
  permissions?: string[]
}

export function useCreateRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateRoleInput) => api.post<{ role: PublicRoleDetail }>('/roles', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rbacKeys.roles() }),
  })
}

export function useDeleteRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete<{ message: string }>(`/roles/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rbacKeys.roles() }),
  })
}
