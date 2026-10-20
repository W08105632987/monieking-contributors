import { api } from '@/lib/api'

export interface ProviderService {
  service_code: string
  title: string
  enabled: boolean
  endpoint: string
  field_map: Record<string, string>
  file_params: Record<string, string>
  applies_when: Record<string, string[]>
  status_param: string
  refund_on_failure: boolean
  alert_after_days: number
  poll_minutes: number
  template_exists: boolean
  template_enabled: boolean
  form_keys: string[]
  open_tickets: number
  saved: boolean
}

export interface Attention {
  id: string
  job_id: string
  service_code: string
  title: string
  status: 'unknown' | 'pending' | 'sending'
  ticket_ref: string | null
  days_waiting: number
  note: string | null
}

export const getProviderServices = async () =>
  (await api.get<{ services: ProviderService[]; techhub_key_set: boolean }>('/provider/admin/services')).data
export const putProviderService = async (code: string, patch: Record<string, unknown>) =>
  (await api.put(`/provider/admin/services/${code}`, patch)).data
export const getAttention = async () => (await api.get<Attention[]>('/provider/admin/attention')).data
export const resolveTicket = async (id: string, body: { action: string; ticket_ref?: string; note?: string }) =>
  (await api.post(`/provider/admin/tickets/${id}/resolve`, body)).data
