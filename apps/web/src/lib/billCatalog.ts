import type { Biller } from '@/types'

/**
 * Pure helpers that turn Monnify's flat "one row per biller+product" catalogue
 * into what the screens need: providers with their products grouped under them,
 * prepaid/postpaid split, data plans bucketed by validity, and the right
 * airtime product per network. No React in here so it can be unit tested.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim()

// ── Providers (electricity DISCOs, TV providers, exam bodies) ─────────────

export interface BillerGroup {
  key: string
  name: string
  products: Biller[]
}

export function groupByBiller(rows: Biller[]): BillerGroup[] {
  const map = new Map<string, BillerGroup>()
  for (const row of rows) {
    const key = norm(row.name)
    const found = map.get(key)
    if (found) found.products.push(row)
    else map.set(key, { key, name: row.name, products: [row] })
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export type MeterKind = 'prepaid' | 'postpaid' | 'other'

/** Prepaid/postpaid from the product code or name ("product-ikedc-pre", "IKEDC POSTPAID"). */
export function meterKind(p: Pick<Biller, 'product_id' | 'product_name'>): MeterKind {
  const t = ` ${norm(`${p.product_id} ${p.product_name}`)} `
  if (/\b(post ?paid|postpaid|post)\b/.test(t)) return 'postpaid'
  if (/\b(pre ?paid|prepaid|pre)\b/.test(t)) return 'prepaid'
  return 'other'
}

export function meterKindsOf(products: Biller[]): MeterKind[] {
  const present = new Set(products.map(meterKind))
  return (['prepaid', 'postpaid', 'other'] as MeterKind[]).filter(k => present.has(k))
}

export const METER_LABEL: Record<MeterKind, string> = { prepaid: 'Prepaid', postpaid: 'Postpaid', other: 'Standard' }

// ── Data plans ────────────────────────────────────────────────────────────

export type PlanBucket = 'daily' | 'weekly' | 'monthly' | 'extended' | 'other'

export const BUCKET_ORDER: PlanBucket[] = ['daily', 'weekly', 'monthly', 'extended', 'other']
export const BUCKET_META: Record<PlanBucket, { label: string; hint: string }> = {
  daily:    { label: 'Daily',     hint: 'Up to 24 hours' },
  weekly:   { label: 'Weekly',    hint: '2 – 7 days' },
  monthly:  { label: 'Monthly',   hint: '8 – 31 days' },
  extended: { label: 'Long-term', hint: 'More than a month' },
  other:    { label: 'Other',     hint: 'Special bundles' },
}

export interface DataPlanInfo {
  sizeText: string | null
  sizeMb: number | null
  validityText: string | null
  days: number | null
  bucket: PlanBucket
}

function daysFrom(text: string): number | null {
  const t = text.toLowerCase()
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/)
  if (m) return Number(m[1]) / 24
  m = t.match(/(\d+)\s*days?\b/)
  if (m) return Number(m[1])
  m = t.match(/(\d+)\s*(?:weeks?|wks?)\b/)
  if (m) return Number(m[1]) * 7
  m = t.match(/(\d+)\s*(?:months?|mos?)\b/)
  if (m) return Number(m[1]) * 30
  m = t.match(/(\d+)\s*(?:years?|yrs?)\b/)
  if (m) return Number(m[1]) * 365
  if (/\b(daily|1 ?day|24 ?hrs?)\b/.test(t)) return 1
  if (/\bweekly\b/.test(t)) return 7
  if (/\bmonthly\b/.test(t)) return 30
  if (/\b(yearly|annual)\b/.test(t)) return 365
  return null
}

function validityLabel(days: number): string {
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} hr${Math.round(days * 24) === 1 ? '' : 's'}`
  if (days === 1) return '1 day'
  if (days >= 60 && days % 30 === 0) return `${days / 30} months`
  if (days === 30) return '30 days'
  if (days >= 365 && days % 365 === 0) return days === 365 ? '1 year' : `${days / 365} years`
  return `${days} days`
}

export function parseDataPlan(productName: string): DataPlanInfo {
  const size = productName.match(/(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/i)
  let sizeText: string | null = null
  let sizeMb: number | null = null
  if (size) {
    const value = Number(size[1])
    const unit = size[2].toUpperCase()
    sizeText = `${size[1]} ${unit}`
    sizeMb = unit === 'TB' ? value * 1024 * 1024 : unit === 'GB' ? value * 1024 : value
  }
  const days = daysFrom(productName)
  const bucket: PlanBucket =
    days == null ? 'other' : days <= 1 ? 'daily' : days <= 7 ? 'weekly' : days <= 31 ? 'monthly' : 'extended'
  return { sizeText, sizeMb, validityText: days == null ? null : validityLabel(days), days, bucket }
}

export interface PlanBucketGroup { bucket: PlanBucket; plans: Array<{ plan: Biller; info: DataPlanInfo }> }

/** Buckets (Daily/Weekly/Monthly/…) in display order, each sorted small → big then cheap → dear. */
export function bucketDataPlans(plans: Biller[]): PlanBucketGroup[] {
  const out = new Map<PlanBucket, PlanBucketGroup>()
  for (const plan of plans) {
    const info = parseDataPlan(plan.product_name)
    const g = out.get(info.bucket) ?? { bucket: info.bucket, plans: [] }
    g.plans.push({ plan, info })
    out.set(info.bucket, g)
  }
  for (const g of out.values()) {
    g.plans.sort((a, b) =>
      (a.info.sizeMb ?? Infinity) - (b.info.sizeMb ?? Infinity) ||
      (a.plan.price_kobo ?? 0) - (b.plan.price_kobo ?? 0))
  }
  return BUCKET_ORDER.filter(b => out.has(b)).map(b => out.get(b)!)
}

// ── Airtime ───────────────────────────────────────────────────────────────

const NETWORK_WORDS: Record<string, string[]> = {
  MTN: ['MTN'], Airtel: ['AIRTEL'], Glo: ['GLO'], '9mobile': ['9MOBILE', 'ETISALAT'],
}

export function matchesNetwork(row: Pick<Biller, 'name'>, network: string | null): boolean {
  if (!network) return true
  const up = row.name.toUpperCase()
  return (NETWORK_WORDS[network] ?? [network.toUpperCase()]).some(w => up.includes(w))
}

/**
 * The product used to buy plain airtime on a network: the VARIABLE-amount one
 * (no fixed price). Never a fixed-price row — buying one of those would charge
 * the bundle's price instead of the amount the customer typed.
 */
export function pickAirtimeProduct(rows: Biller[], network: string | null): Biller | undefined {
  if (!network) return undefined
  const pool = rows.filter(r => matchesNetwork(r, network))
  return pool.find(r => r.price_kobo == null)
}

// ── Tokens ────────────────────────────────────────────────────────────────

/** "12345678901234567890" -> "1234 5678 9012 3456 7890" (non-numeric PINs are left as they are). */
export function groupToken(token: string): string {
  const t = token.trim()
  if (!/^[\d\s-]+$/.test(t)) return t
  const digits = t.replace(/\D/g, '')
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ')
}

/** Spoken form: digits one by one, a pause (comma) between groups of four. */
export function tokenToSpeech(token: string): string {
  const t = token.trim()
  const chars = (/^[\d\s-]+$/.test(t) ? t.replace(/\D/g, '') : t.replace(/\s+/g, '')).split('')
  const groups: string[] = []
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4).join(' '))
  return groups.join(', ')
}
