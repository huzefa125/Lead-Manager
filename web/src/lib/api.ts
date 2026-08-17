import type { SessionPayload } from '@/types/api'

/**
 * The HTTP layer.
 *
 * Two things make this file worth reading before anything else:
 *
 * 1. The access token lives in a module variable, never in localStorage. That
 *    is what the server's `respondWithSession` is designed for — the refresh
 *    token is an httpOnly cookie the JS never sees, so an XSS payload can
 *    steal at most one access-token lifetime instead of a 7-day session.
 * 2. A 401 triggers exactly one refresh, shared by every request that raced
 *    into the same expiry, then the original requests are replayed. Callers
 *    never see the expiry.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ACCOUNT_DISABLED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

export interface ErrorDetail {
  field: string
  message: string
}

/** Mirrors the server's `ApiError` so callers branch on `code`, not on text. */
export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details: ErrorDetail[]

  constructor(status: number, code: ErrorCode, message: string, details: ErrorDetail[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Field errors keyed by name, ready to hand to react-hook-form's setError. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((detail) => [detail.field, detail.message]))
  }
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: { code: ErrorCode; message: string; details?: ErrorDetail[] }
}

// --- Access token store -----------------------------------------------------

let accessToken: string | null = null

/**
 * Set once a refresh has come back 401. Without it every query on the page
 * would fire its own refresh against an endpoint that rate-limits to 10
 * attempts per window, and a logged-out user would lock themselves out of
 * logging in.
 */
let knownAnonymous = false

let refreshInFlight: Promise<string | null> | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
  if (token) knownAnonymous = false
}

export function clearSession(): void {
  accessToken = null
  knownAnonymous = true
}

// --- Core request -----------------------------------------------------------

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Serialized with `toQueryString`; undefined and null entries are dropped. */
  query?: QueryParams
  signal?: AbortSignal
  /** Skips the refresh-and-retry dance. Used by the auth calls themselves. */
  skipAuthRetry?: boolean
}

export type QueryParams = Record<
  string,
  string | number | boolean | Date | readonly string[] | undefined | null
>

/**
 * The server reads repeatable filters as comma-separated (`?status=WON,LOST`)
 * and coerces dates from ISO strings.
 *
 * `false` is dropped rather than serialized, and that is not a shortcut. Every
 * boolean the API takes is parsed with zod's `z.coerce.boolean()`, which is
 * `Boolean(value)` over the raw query string — so the string `"false"` arrives
 * as `true`, the exact opposite of what was sent. Absence is the only way to
 * express false, and each of those schemas already declares `.default(false)`.
 * Sending `excludeSystem=false` is what made a lead's timeline render empty:
 * the server read it as "hide system entries" and hid the only entry there was.
 */
export function toQueryString(query: QueryParams): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || value === false) continue

    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','))
    } else if (value instanceof Date) {
      params.set(key, value.toISOString())
    } else {
      params.set(key, String(value))
    }
  }

  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const text = await response.text()

  let envelope: Envelope<T> | null = null
  try {
    envelope = text ? (JSON.parse(text) as Envelope<T>) : null
  } catch {
    envelope = null
  }

  if (!response.ok || !envelope?.success) {
    const error = envelope?.error
    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details ?? [],
    )
  }

  return envelope.data as T
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  return fetch(`${BASE_URL}${path}${options.query ? toQueryString(options.query) : ''}`, {
    method: options.method ?? 'GET',
    headers,
    // Carries the refresh cookie. Same-origin in dev via the Vite proxy.
    credentials: 'include',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
}

/** True for the two codes that mean "this access token is no longer usable". */
function isExpiredToken(response: Response, code: ErrorCode | undefined): boolean {
  return response.status === 401 && (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID')
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options)

  if (response.status === 401 && !options.skipAuthRetry) {
    // Peek at the code without consuming the body the caller may still need.
    const peeked = (await response
      .clone()
      .json()
      .catch(() => null)) as Envelope<T> | null

    if (isExpiredToken(response, peeked?.error?.code)) {
      const token = await refreshAccessToken()
      if (token) response = await send(path, options)
    }
  }

  return parseEnvelope<T>(response)
}

// --- Session ----------------------------------------------------------------

/**
 * Exchanges the refresh cookie for a new access token, at most once
 * concurrently. Returns null when there is no usable session — the caller's
 * job is then to send the user to the login screen, not to try again.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (knownAnonymous) return null
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const response = await send('/auth/refresh', { method: 'POST', body: {} })
      const session = await parseEnvelope<SessionPayload>(response)
      setAccessToken(session.accessToken)
      return session.accessToken
    } catch {
      clearSession()
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

/**
 * Restores the session on a cold page load. The refresh token rotates on every
 * call, so this both proves the session is alive and hands back the user.
 */
export async function restoreSession(): Promise<SessionPayload | null> {
  if (knownAnonymous) return null

  try {
    const session = await request<SessionPayload>('/auth/refresh', {
      method: 'POST',
      body: {},
      skipAuthRetry: true,
    })
    setAccessToken(session.accessToken)
    return session
  } catch {
    clearSession()
    return null
  }
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
