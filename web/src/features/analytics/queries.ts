import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  FollowUpDashboard,
  FunnelReport,
  LeadChannel,
  LeakageReport,
  ResponseTimeReport,
} from '@/types/api'

/** Filters shared by every report. Mirrors `analyticsQuerySchema`. */
export type AnalyticsParams = {
  capturedFrom?: string
  capturedTo?: string
  sourceId?: string
  channel?: LeadChannel[]
  assignedToId?: string
}

export type FunnelParams = AnalyticsParams & {
  groupBy?: 'none' | 'source' | 'channel' | 'owner'
}

export const analyticsKeys = {
  funnel: (params: FunnelParams) => ['analytics', 'funnel', params] as const,
  leakage: (params: LeakageParams) => ['analytics', 'leakage', params] as const,
  responseTimes: (params: ResponseTimeParams) => ['analytics', 'response-times', params] as const,
  followUps: (params: FollowUpParams) => ['analytics', 'follow-ups', params] as const,
}

export function useFunnel(params: FunnelParams) {
  return useQuery({
    queryKey: analyticsKeys.funnel(params),
    queryFn: ({ signal }) => api.get<FunnelReport>('/leads/funnel', params, signal),
    placeholderData: (previous) => previous,
  })
}

export type LeakageParams = AnalyticsParams & {
  sampleSize?: number
}

export function useLeakage(params: LeakageParams) {
  return useQuery({
    queryKey: analyticsKeys.leakage(params),
    queryFn: ({ signal }) => api.get<LeakageReport>('/leads/leakage', params, signal),
    placeholderData: (previous) => previous,
  })
}

export type ResponseTimeParams = AnalyticsParams & {
  contactSpeedThresholdHours?: number
  minSampleSize?: number
}

export function useResponseTimes(params: ResponseTimeParams) {
  return useQuery({
    queryKey: analyticsKeys.responseTimes(params),
    queryFn: ({ signal }) =>
      api.get<ResponseTimeReport>('/leads/response-times', params, signal),
    placeholderData: (previous) => previous,
  })
}

export type FollowUpParams = {
  sourceId?: string
  channel?: LeadChannel[]
  assignedToId?: string
  sampleSize?: number
  followUpAfterDays?: number
  criticalOverdueDays?: number
}

export function useFollowUps(params: FollowUpParams) {
  return useQuery({
    queryKey: analyticsKeys.followUps(params),
    queryFn: ({ signal }) =>
      api.get<FollowUpDashboard>('/leads/follow-ups', params, signal),
    placeholderData: (previous) => previous,
  })
}
