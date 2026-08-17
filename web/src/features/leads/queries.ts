import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  LeadActivityDirection,
  LeadActivityType,
  LeadChannel,
  LeadStatus,
  Pagination,
  PublicLead,
  PublicLeadActivity,
} from '@/types/api'

/**
 * Everything the list screen can filter and sort by. Mirrors
 * `listLeadsQuerySchema`. A type alias rather than an interface so it satisfies
 * `QueryParams`' index signature.
 */
export type LeadListParams = {
  page?: number
  limit?: number
  search?: string
  status?: LeadStatus[]
  channel?: LeadChannel[]
  stageId?: string
  sourceId?: string
  assignedToId?: string
  unassigned?: boolean
  capturedFrom?: string
  capturedTo?: string
  staleForDays?: number
  sort?: 'capturedAt' | 'lastActivityAt' | 'estimatedValue' | 'updatedAt'
  order?: 'asc' | 'desc'
}

export interface LeadListResult {
  leads: PublicLead[]
  pagination: Pagination
}

export const leadKeys = {
  all: ['leads'] as const,
  list: (params: LeadListParams) => ['leads', 'list', params] as const,
  detail: (id: string) => ['leads', 'detail', id] as const,
  timeline: (id: string, params: TimelineParams) => ['leads', 'timeline', id, params] as const,
}

export function useLeads(params: LeadListParams) {
  return useQuery({
    queryKey: leadKeys.list(params),
    queryFn: ({ signal }) => api.get<LeadListResult>('/leads', params, signal),
    // Keeps the table on screen while a new page or filter loads, instead of
    // collapsing to a spinner on every keystroke.
    placeholderData: (previous) => previous,
  })
}

export function useLead(id: string) {
  return useQuery({
    queryKey: leadKeys.detail(id),
    queryFn: ({ signal }) =>
      api.get<{ lead: PublicLead }>(`/leads/${id}`, undefined, signal).then((data) => data.lead),
  })
}

export type TimelineParams = {
  page?: number
  limit?: number
  excludeSystem?: boolean
  order?: 'asc' | 'desc'
}

export function useLeadTimeline(id: string, params: TimelineParams) {
  return useQuery({
    queryKey: leadKeys.timeline(id, params),
    queryFn: ({ signal }) =>
      api.get<{ activities: PublicLeadActivity[]; pagination: Pagination }>(
        `/leads/${id}/timeline`,
        params,
        signal,
      ),
    placeholderData: (previous) => previous,
  })
}

// --- Mutations --------------------------------------------------------------

/**
 * Every lead mutation invalidates the whole `leads` tree.
 *
 * Logging one activity can move a milestone, change the stage, and shift the
 * funnel — surgical cache patching would have to reimplement the server's
 * journey rules to stay correct, so the cheap refetch is the honest option.
 */
function useLeadMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  leadId?: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['analytics'] })
      if (leadId) void queryClient.invalidateQueries({ queryKey: leadKeys.detail(leadId) })
    },
  })
}

export interface CreateLeadInput {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  whatsapp?: string
  company?: string
  jobTitle?: string
  website?: string
  sourceId?: string
  channel?: LeadChannel
  stageId?: string
  assignedToId?: string
  estimatedValue?: number
  currency?: string
  campaign?: string
  notes?: string
}

export function useCreateLead() {
  return useLeadMutation((input: CreateLeadInput) =>
    api.post<{ lead: PublicLead; created: boolean }>('/leads', input),
  )
}

export interface UpdateLeadInput {
  id: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  whatsapp?: string
  company?: string
  jobTitle?: string
  website?: string
  estimatedValue?: number | null
  currency?: string
  notes?: string | null
  lostReason?: string | null
  sourceId?: string
}

export function useUpdateLead(id: string) {
  return useLeadMutation(
    ({ id: leadId, ...body }: UpdateLeadInput) =>
      api.patch<{ lead: PublicLead }>(`/leads/${leadId}`, body),
    id,
  )
}

export function useDeleteLead() {
  return useLeadMutation((id: string) => api.delete<{ message: string }>(`/leads/${id}`))
}

export function useAssignLead(id: string) {
  return useLeadMutation(
    (input: { assignedToId: string | null; note?: string }) =>
      api.put<{ lead: PublicLead }>(`/leads/${id}/assignment`, input),
    id,
  )
}

export function useChangeStage(id: string) {
  return useLeadMutation(
    (input: { stageId: string; lostReason?: string; note?: string }) =>
      api.put<{ lead: PublicLead }>(`/leads/${id}/stage`, input),
    id,
  )
}

export interface LogActivityInput {
  type: LeadActivityType
  direction: LeadActivityDirection
  subject?: string
  body?: string
  durationMinutes?: number
  occurredAt?: string
}

/** `advanced` names the milestones this entry moved, so the UI can say so. */
export interface LogActivityResult {
  activity: PublicLeadActivity
  lead: PublicLead
  advanced: string[]
}

export function useLogActivity(id: string) {
  return useLeadMutation(
    (input: LogActivityInput) => api.post<LogActivityResult>(`/leads/${id}/activities`, input),
    id,
  )
}
