import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { idempotencyKey } from './utils'

export interface ApiError {
  detail?: string | { code?: string; message?: string } | Array<{ msg?: string }>
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // same httpOnly session cookies as apps/web — see backend/app/core/cookies.py
})

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (['post', 'put', 'patch'].includes(config.method ?? '')) {
    config.headers['Idempotency-Key'] ??= idempotencyKey()
  }
  return config
})

let refreshInFlight: Promise<boolean> | null = null
let redirectingToLogin = false

async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = api.post('/auth/refresh')
      .then(() => true)
      .catch(() => false)
      .finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined

    const isAuthEndpoint = original?.url?.includes('/auth/admin/login')
      || original?.url?.includes('/auth/admin/verify-otp')
      || original?.url?.includes('/auth/refresh')
      || original?.url?.includes('/auth/logout')

    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !isAuthEndpoint
    ) {
      original._retried = true
      const refreshed = await tryRefresh()
      if (refreshed) return api(original)
      if (!redirectingToLogin && window.location.pathname !== '/login') {
        redirectingToLogin = true
        window.location.href = '/login'
      }
    }

    return Promise.reject(error)
  },
)

export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as any)?.detail
    if (detail) {
      if (typeof detail === 'string') return detail
      if (typeof detail === 'object' && detail !== null && 'message' in detail) return String((detail as any).message)
      if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join(', ')
      return JSON.stringify(detail)
    }
    if (error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout')) {
      return 'This is taking longer than expected. Check your connection and try again.'
    }
    if (error.code === 'ERR_NETWORK' || !error.response) {
      return 'Could not reach the server. Check your connection and try again.'
    }
    return error.message ?? 'An error occurred'
  }
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred'
}
