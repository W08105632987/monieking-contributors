import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes safely */
/**
 * navigator.clipboard only exists in secure contexts (HTTPS, or exactly
 * "localhost") — it's undefined on plain HTTP, including testing over a
 * LAN IP like http://192.168.x.x, which is a very normal way to test a
 * mobile web app during development. Calling .writeText on undefined
 * there throws, and with no fallback the button just silently does
 * nothing. This tries the modern API first, then falls back to the
 * classic hidden-textarea + execCommand('copy') trick, which works in
 * that situation too.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the fallback below
    }
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return success
  } catch {
    return false
  }
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Convert kobo (integer) to formatted Naira string  e.g. 100000 → ₦1,000 */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(naira)
}

/** Convert Naira input string to kobo integer  e.g. "1000" → 100000 */
export function nairaToKobo(naira: number | string): number {
  return Math.round(Number(naira) * 100)
}

/** Convert kobo to naira number */
export function koboToNaira(kobo: number): number {
  return kobo / 100
}

/** Format a date string to a readable format */
export function formatDate(date: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...opts,
  }).format(new Date(date))
}

/** Format date with time */
export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

/** Relative time  e.g. "2 hours ago" */
export function timeAgo(date: string | Date): string {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const diff = (new Date(date).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60)    return rtf.format(Math.round(diff), 'second')
  if (abs < 3600)  return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

/** Groups a list of items into "Today", "Yesterday", then "Month Year" buckets,
 *  ordered newest-first — the same pattern most banking apps use for history lists. */
export function groupByDateBucket<T>(items: T[], getDate: (item: T) => string | Date): { label: string; items: T[] }[] {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today     = startOfDay(now)
  const yesterday = today - 86400_000

  const buckets = new Map<string, T[]>()
  const order: string[] = []

  for (const item of items) {
    const d = new Date(getDate(item))
    const dayStart = startOfDay(d)
    let label: string
    if (dayStart === today)          label = 'Today'
    else if (dayStart === yesterday) label = 'Yesterday'
    else label = new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric' }).format(d)

    if (!buckets.has(label)) {
      buckets.set(label, [])
      order.push(label)
    }
    buckets.get(label)!.push(item)
  }

  return order.map(label => ({ label, items: buckets.get(label)! }))
}

/**
 * Validate that a contribution amount is a valid multiple of the card rate.
 * Both values in kobo.
 */
export function isValidContribution(amountKobo: number, rateKobo: number): boolean {
  if (amountKobo <= 0) return false
  return amountKobo % rateKobo === 0
}

/** How many days does a contribution amount represent */
export function daysFromContribution(amountKobo: number, rateKobo: number): number {
  return Math.floor(amountKobo / rateKobo)
}

/** Calculate withdrawal charge (= one day rate) and net payable */
export function calcWithdrawal(amountKobo: number, rateKobo: number) {
  const charge = rateKobo
  const net = amountKobo - charge
  return { charge, net }
}

/** Total days on a card (12 months × 31 days) */
export const CARD_TOTAL_DAYS = 12 * 31  // 372

/** Progress percentage on a card (0–100) */
export function cardProgress(daysContributed: number): number {
  return Math.min(100, Math.round((daysContributed / CARD_TOTAL_DAYS) * 100))
}

/**
 * Convert a sequential day number (1–372) to a logical month/day position.
 * e.g. day 32 → { month: 2, day: 1 }
 */
export function dayToGridPosition(dayNumber: number): { month: number; day: number } {
  const month = Math.ceil(dayNumber / 31)
  const day = dayNumber - (month - 1) * 31
  return { month, day }
}

/** Initials from a full name  e.g. "Emeka Okafor" → "EO" */
export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

/** Mask account number  e.g. "0123456789" → "****6789" */
export function maskAccount(account: string): string {
  if (account.length <= 4) return account
  return '*'.repeat(account.length - 4) + account.slice(-4)
}

/** Generate a unique idempotency key */
export function idempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for insecure contexts (e.g. http://<lan-ip>) where
  // crypto.randomUUID is unavailable — getRandomValues still works everywhere.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Month names for card grid display */
export const MONTH_NAMES = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec',
]

/** Logical month label */
export function monthLabel(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month)
}
