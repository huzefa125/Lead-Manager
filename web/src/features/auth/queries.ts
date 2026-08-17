import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, clearSession, restoreSession, setAccessToken } from '@/lib/api'
import type { PublicUser, SessionPayload } from '@/types/api'

export const sessionKey = ['session'] as const

/**
 * The session query.
 *
 * `restoreSession` hits `/auth/refresh`, which rotates the refresh cookie —
 * so this must not be retried or refetched casually. `staleTime: Infinity`
 * keeps it to one call per page load; login and logout write the cache
 * directly.
 *
 * Defined as options rather than only a hook because the route guard resolves
 * it in `beforeLoad`, before any component renders.
 */
export const sessionQueryOptions = queryOptions({
  queryKey: sessionKey,
  queryFn: async (): Promise<PublicUser | null> => {
    const session = await restoreSession()
    return session?.user ?? null
  },
  staleTime: Infinity,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
})

export function useSession() {
  return useQuery(sessionQueryOptions)
}

export interface LoginInput {
  email: string
  password: string
}

export function useLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: LoginInput) => api.post<SessionPayload>('/auth/login', input),
    onSuccess: (session) => {
      setAccessToken(session.accessToken)
      queryClient.setQueryData(sessionKey, session.user)
    },
  })
}

export interface RegisterInput {
  email: string
  password: string
  name?: string
  organizationName?: string
}

export function useRegister() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<SessionPayload>('/auth/register', input),
    onSuccess: (session) => {
      setAccessToken(session.accessToken)
      queryClient.setQueryData(sessionKey, session.user)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => api.post<{ message: string }>('/auth/logout'),
    // The local session is dropped whether or not the server call succeeded —
    // a network failure must not leave the user apparently signed in.
    onSettled: () => {
      clearSession()
      queryClient.setQueryData(sessionKey, null)
      queryClient.removeQueries({ predicate: (query) => query.queryKey !== sessionKey })
    },
  })
}
