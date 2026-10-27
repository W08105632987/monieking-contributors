/** Date and wording helpers for the Accounting Center. Dates are Nigeria calendar days, never UTC-shifted. */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

export interface Period { label: string; start: string; end: string }

export function presetPeriod(id: 'today' | '7d' | 'month' | 'lastmonth' | '90d', now = new Date()): Period {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (id) {
    case 'today': return { label: 'Today', start: ymd(today), end: ymd(today) }
    case '7d': return { label: 'Last 7 days', start: ymd(addDays(today, -6)), end: ymd(today) }
    case 'month': return { label: 'This month', start: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), end: ymd(today) }
    case 'lastmonth': return { label: 'Last month', start: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)), end: ymd(new Date(today.getFullYear(), today.getMonth(), 0)) }
    default: return { label: 'Last 90 days', start: ymd(addDays(today, -89)), end: ymd(today) }
  }
}

export const SOURCE_TEXT: Record<string, string> = {
  measured: 'Measured: read from a real record',
  rate: 'Calculated from the prices you entered',
  'measured + rate': 'Measured where the provider told us, otherwise your prices',
  missing: 'No price entered yet: cost shown as ₦0',
}

/** "1.5" naira-or-percent text -> number, or null when it is not a usable non-negative number. */
export function parseAmount(v: string): number | null {
  const n = Number(v.replace(/,/g, '').trim())
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null
}
