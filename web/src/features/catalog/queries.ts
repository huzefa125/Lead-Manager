import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { LeadChannel, PublicLeadSource, PublicLeadStage } from '@/types/api'

/**
 * Sources and stages — the tenant-owned pipeline configuration. Both are small,
 * rarely-changing lists that nearly every screen needs, so they get a long
 * stale time and are shared through the query cache rather than prop-drilled.
 */

const FIVE_MINUTES = 5 * 60 * 1000

export const catalogKeys = {
  sources: (includeInactive = false) => ['lead-sources', { includeInactive }] as const,
  stages: () => ['lead-stages'] as const,
}

export function useLeadSources(includeInactive = false) {
  return useQuery({
    queryKey: catalogKeys.sources(includeInactive),
    queryFn: ({ signal }) =>
      api
        .get<{ sources: PublicLeadSource[] }>('/lead-sources', { includeInactive }, signal)
        .then((data) => data.sources),
    staleTime: FIVE_MINUTES,
  })
}

export function useLeadStages() {
  return useQuery({
    queryKey: catalogKeys.stages(),
    queryFn: ({ signal }) =>
      api.get<{ stages: PublicLeadStage[] }>('/lead-stages', undefined, signal).then((data) => data.stages),
    staleTime: FIVE_MINUTES,
  })
}

// --- Sources ----------------------------------------------------------------

export interface CreateSourceInput {
  name: string
  channel: LeadChannel
  key?: string
  description?: string
}

export function useCreateSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateSourceInput) =>
      api.post<{ source: PublicLeadSource }>('/lead-sources', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-sources'] }),
  })
}

export interface UpdateSourceInput {
  id: string
  name?: string
  description?: string | null
  isActive?: boolean
}

export function useUpdateSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, ...body }: UpdateSourceInput) =>
      api.patch<{ source: PublicLeadSource }>(`/lead-sources/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-sources'] }),
  })
}

export function useDeleteSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete<{ message: string }>(`/lead-sources/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-sources'] }),
  })
}

// --- Stages -----------------------------------------------------------------

export interface CreateStageInput {
  name: string
  key?: string
  description?: string
  position?: number
  type?: 'OPEN' | 'WON' | 'LOST'
}

export function useCreateStage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateStageInput) =>
      api.post<{ stage: PublicLeadStage }>('/lead-stages', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.stages() }),
  })
}

export interface UpdateStageInput {
  id: string
  name?: string
  description?: string | null
  position?: number
}

export function useUpdateStage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, ...body }: UpdateStageInput) =>
      api.patch<{ stage: PublicLeadStage }>(`/lead-stages/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.stages() }),
  })
}

export function useDeleteStage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete<{ message: string }>(`/lead-stages/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.stages() }),
  })
}
