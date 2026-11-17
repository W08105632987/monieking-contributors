import { api } from '@/lib/api'
import { ask } from '@/lib/dialog'

export type HealthLevel = 'good' | 'fair' | 'poor' | 'unknown'
export interface BillStat { success_rate: number | null; attempts: number; completed: number; failed: number; level: HealthLevel; provider?: string }
export interface MonnifyStatus {
  ok: boolean; level: 'operational' | 'degraded' | 'outage' | 'maintenance' | 'unknown'; description?: string | null
  incidents?: { name: string; status: string }[]; components?: { name: string; status: string }[]; maintenance?: { name: string; status: string }[]
}
export function windowText(minutes: number) {
  if (minutes % 60 === 0) { const h = minutes / 60; return h === 1 ? 'hour' : `${h} hours` }
  return `${minutes} minutes`
}

interface Verdict extends BillStat { name: string | null; threshold_percent: number; window_minutes?: number; monnify?: MonnifyStatus }

/**
 * Asked right before a purchase. If this biller has been failing (success rate below the director's threshold, default 30%),
 * or Monnify reports an outage, the customer gets a plain warning and chooses whether to continue. If the check itself fails
 * for any reason we let the purchase go ahead: a broken health check must never stop someone paying.
 */
export async function confirmIfRisky(billerId: string): Promise<boolean> {
  let v: Verdict
  try { v = (await api.get<Verdict>(`/bill-payments/health/${billerId}`, { timeout: 6000 })).data } catch { return true }
  const poor = v.level === 'poor'
  const outage = v.monnify?.level === 'outage'
  if (!poor && !outage) return true
  const lines: string[] = []
  if (poor) lines.push(`${v.name ?? 'This biller'} is struggling right now: only ${v.success_rate}% of the last ${v.attempts} purchases went through (past ${windowText(v.window_minutes ?? 180)}).`)
  if (outage) lines.push('Our payment provider is reporting an outage at the moment.')
  lines.push('This purchase might fail because of a bad network. If it does, your money goes back to your wallet. Do you want to continue anyway?')
  return ask(lines.join('\n\n'), { title: 'This may fail', confirmLabel: 'Continue anyway', cancelLabel: 'Not now', tone: 'danger' })
}
