import { api } from '@/lib/api'
import { downloadFromApi, personFileName } from '@/lib/download'
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

export const downloadSheet = (id: string, reveal: boolean, kind: VerifyKind, person?: string | null) =>
  downloadFromApi(`/verifications/lookups/${id}/sheet.pdf`, personFileName(`${kind.toUpperCase()} Slip`, person), { params: { reveal }, label: 'Preparing your slip' })
export const downloadSlip = (id: string, tier: SlipTier, kind: VerifyKind, person?: string | null) =>
  downloadFromApi(`/verifications/lookups/${id}/slips/${tier}/pdf`, personFileName(`${kind.toUpperCase()} ${tier[0].toUpperCase()}${tier.slice(1)} Slip`, person), { label: 'Preparing your slip' })

export const adminGetSettings = async () => (await api.get('/verifications/admin/settings')).data
export const adminPutSettings = async (patch: Record<string, unknown>) => (await api.put('/verifications/admin/settings', patch)).data
export const adminResetBreaker = async (kind: VerifyKind) => (await api.post(`/verifications/admin/health/${kind}/reset`)).data
