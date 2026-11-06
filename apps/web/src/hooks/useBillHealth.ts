import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ask } from '@/lib/dialog'
import type { BillerGroup } from '@/lib/billCatalog'

export type HealthLevel = 'good' | 'fair' | 'poor' | 'unknown'
export interface BillStat { success_rate: number | null; attempts: number; completed: number; failed: number; level: HealthLevel; provider?: string }
export interface MonnifyStatus {
  ok: boolean; level: 'operational' | 'degraded' | 'outage' | 'maintenance' | 'unknown'; description?: string | null
  incidents?: { name: string; status: string }[]; components?: { name: string; status: string }[]; maintenance?: { name: string; status: string }[]
}
export interface BillHealth {
  window_minutes: number; min_attempts: number; threshold_percent: number
  billers: Record<string, BillStat>   // biller id -> that biller's provider stat
  monnify: MonnifyStatus
}

export function levelFor(rate: number | null, attempts: number, minAttempts: number, threshold: number): HealthLevel {
  if (rate === null || attempts < minAttempts) return 'unknown'
  return rate < threshold ? 'poor' : rate < 80 ? 'fair' : 'good'
}

/** Live success rates for one category of billers, refreshed every minute, plus Monnify's own status. Never blocks the page: if it fails, bars simply do not show. */
export function useBillHealth(category: string) {
  return useQuery({
    queryKey: ['bill-health', category],
    queryFn: async () => (await api.get<BillHealth>('/bill-payments/health', { params: { category } })).data,
    staleTime: 30_000, refetchInterval: 60_000, retry: 0,
  })
}

/** One bar for a set of rows (a provider's products): sums each distinct provider once, so a provider with 40 data plans is not counted 40 times. */
export function statForRows(rows: { id: string }[], health?: Pick<BillHealth, 'billers' | 'min_attempts' | 'threshold_percent'>): BillStat | undefined {
  if (!health) return undefined
  const seen = new Set<string>()
  let completed = 0, failed = 0
  for (const r of rows) {
    const s = health.billers[r.id]
    if (!s) continue
    const key = s.provider ?? r.id
    if (seen.has(key)) continue
    seen.add(key); completed += s.completed; failed += s.failed
  }
  if (seen.size === 0) return undefined
  const attempts = completed + failed
  const rate = attempts ? Math.round((completed * 100) / attempts) : null
  return { success_rate: rate, attempts, completed, failed, level: levelFor(rate, attempts, health.min_attempts, health.threshold_percent) }
}

export const statForGroup = (g: BillerGroup, health?: BillHealth) => statForRows(g.products, health)

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
