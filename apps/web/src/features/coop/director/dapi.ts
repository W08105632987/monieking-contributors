import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const useAdmin = <T = any>(key: string, url: string, params?: Record<string, unknown>) =>
  useQuery<T>({ queryKey: ['coop', 'admin', key, params], queryFn: async () => (await api.get(url, { params })).data })

export interface SettingItem {
  key: string; group: string; label: string; kind: string; unit: string; value: string; default: string; options: string[]
  min: number | null; max: number | null; confirmed: boolean; effect: string; effect_label: string; note: string
  readonly: boolean; required_for_live: boolean
  pending: null | { id: string; new_value: string; reason: string | null; approvals: number; needed: number; you_voted: boolean }
  scheduled: null | { id: string; new_value: string; effective_on: string | null }
}

/** Show a stored setting value in friendly units. */
export function showValue(s: { kind: string; value: string; unit?: string }): string {
  const v = s.value
  if (s.kind === 'kobo') return '₦' + new Intl.NumberFormat('en-NG').format(Number(v) / 100)
  if (s.kind === 'bps') return `${+(Number(v) / 100).toFixed(2)}%`
  if (s.kind === 'bool') return v === 'true' ? 'On' : 'Off'
  if (s.kind === 'int') return `${v}${s.unit ? ' ' + s.unit.replace(/^%.*/, '%') : ''}`.trim()
  return v || '—'
}
