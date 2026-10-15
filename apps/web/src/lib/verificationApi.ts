import { api } from '@/lib/api'
import type { Lookup, SlipTier, VerifyKind, VerifyMethod, VerifyStatus } from '@/lib/verification'

// A paid provider call can take longer than the app's default 20s timeout.
const LONG = { timeout: 70_000 }

export const verifyStatus = async () => (await api.get<VerifyStatus>('/verifications/status')).data

export const createLookup = async (
  body: { method: VerifyMethod; fields: Record<string, string>; consent: boolean; client_request_id: string },
  customerId?: string,
) => (await api.post<Lookup>('/verifications/lookups', body, { ...LONG, params: customerId ? { customer_id: customerId } : {} })).data

export const getLookup = async (id: string) => (await api.get<Lookup>(`/verifications/lookups/${id}`)).data


export const buySlip = async (id: string, tier: SlipTier) =>
  (await api.post<{ tier: SlipTier; already_owned: boolean; price_kobo: number }>(`/verifications/lookups/${id}/slips`, { tier }, LONG)).data

async function saveBlob(path: string, filename: string, params?: Record<string, unknown>) {
  const res = await api.get<Blob>(path, { responseType: 'blob', params, ...LONG })
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const downloadSheet = (id: string, reveal: boolean) =>
  saveBlob(`/verifications/lookups/${id}/sheet.pdf`, 'monieking-verification-sheet.pdf', { reveal })
export const downloadSlip = (id: string, tier: SlipTier) =>
  saveBlob(`/verifications/lookups/${id}/slips/${tier}/pdf`, `monieking-${tier}-slip.pdf`)

export const adminGetSettings = async () => (await api.get('/verifications/admin/settings')).data
export const adminPutSettings = async (patch: Record<string, unknown>) => (await api.put('/verifications/admin/settings', patch)).data
export const adminResetBreaker = async (kind: VerifyKind) => (await api.post(`/verifications/admin/health/${kind}/reset`)).data
