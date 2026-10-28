// Techhub-backed NIN / BVN verification — shared types and pure helpers.
// Everything here is pure (no React, no network) so it can be unit-tested.

export type VerifyKind = 'nin' | 'bvn'
export type VerifyMethod = 'nin' | 'phone' | 'demographic' | 'bvn'
export type SlipTier = 'regular' | 'standard' | 'premium'

export interface MethodDef {
  id: VerifyMethod
  title: string
  blurb: string
  fields: FieldDef[]
}
export interface FieldDef {
  key: string
  label: string
  type: 'digits' | 'phone' | 'text' | 'date' | 'gender'
  required: boolean
  hint?: string
}

export const METHODS: Record<VerifyKind, MethodDef[]> = {
  nin: [
    { id: 'nin', title: 'By NIN', blurb: 'Enter the 11-digit NIN.',
      fields: [{ key: 'nin', label: 'NIN', type: 'digits', required: true, hint: '11 digits' }] },
    { id: 'phone', title: 'By phone number', blurb: 'The phone number the NIN is registered with.',
      fields: [{ key: 'phone', label: 'Phone number', type: 'phone', required: true, hint: '08012345678' }] },
    { id: 'demographic', title: 'By name & date of birth', blurb: 'When you do not have the NIN or phone.',
      fields: [
        { key: 'firstname', label: 'First name', type: 'text', required: true },
        { key: 'lastname', label: 'Last name', type: 'text', required: true },
        { key: 'dob', label: 'Date of birth', type: 'date', required: true },
        { key: 'gender', label: 'Gender (optional)', type: 'gender', required: false },
      ] },
  ],
  bvn: [
    { id: 'bvn', title: 'By BVN', blurb: 'Enter the 11-digit BVN.',
      fields: [{ key: 'bvn', label: 'BVN', type: 'digits', required: true, hint: '11 digits' }] },
  ],
}

export const CONSENT_TEXT: Record<VerifyKind, string> = {
  nin: "I confirm I have this person's permission to check their NIN, and I understand the result is kept for {hours} hours.",
  bvn: "I confirm I have this person's permission to check their BVN. I understand a BVN is highly sensitive, I will not share it, and the result is kept for {hours} hours.",
}

export const DISCLAIMER: Record<VerifyKind, string> = {
  nin: 'This is a MonieKing verification sheet. It is not an official NIMC document.',
  bvn: 'This is a MonieKing verification sheet. It is not an official bank or NIBSS document.',
}

export const TIER_LABEL: Record<SlipTier, string> = { regular: 'Regular', standard: 'Standard', premium: 'Premium' }
export const TIERS: Record<VerifyKind, SlipTier[]> = { nin: ['regular', 'standard', 'premium'], bvn: ['standard', 'premium'] }

export interface VerifyStatus {
  enabled: boolean
  retention_hours: number
  retention_never?: boolean
  nin_auth_url: string | null
  fees: Partial<Record<VerifyMethod, number>>
  slips: Record<string, number>          // "nin.regular" -> kobo, only priced ones
  services: Record<VerifyKind, { available: boolean; reason: string | null; retry_at: string | null }>
}

export interface LookupResult {
  nin?: string | null; bvn?: string | null
  first_name?: string | null; middle_name?: string | null; last_name?: string | null; full_name: string
  gender?: string | null; date_of_birth?: string | null; phone_number?: string | null; address?: string | null
}
export interface Lookup {
  id: string; kind: VerifyKind; method: VerifyMethod
  status: 'pending' | 'found' | 'not_found' | 'failed'
  failure_reason: string | null; fee_kobo: number
  summary: { method?: string; name?: string; id_masked?: string }
  created_at: string; expires_at: string | null; expired: boolean; by_officer: boolean
  slips?: SlipTier[]; result?: LookupResult | null; photo_b64?: string | null
}

export const isDigits11 = (v: string) => /^\d{11}$/.test(v.replace(/[\s-]/g, ''))

/** First problem with the form, or null. Mirrors the server rules so mistakes show before a paid call. */
export function validateFields(method: VerifyMethod, kind: VerifyKind, values: Record<string, string>): string | null {
  const def = METHODS[kind].find(m => m.id === method)
  if (!def) return 'Pick a method.'
  for (const f of def.fields) {
    const v = (values[f.key] ?? '').trim()
    if (!v) { if (f.required) return `Enter ${f.label.toLowerCase()}.`; continue }
    if (f.type === 'digits' && !isDigits11(v)) return `Enter a valid 11-digit ${f.label}.`
    if (f.type === 'phone' && !/^(\+?234|0)?[789]\d{9}$/.test(v.replace(/[\s-]/g, ''))) return 'Enter a valid phone number.'
    if (f.type === 'text' && !/^[A-Za-z][A-Za-z '\-]{0,59}$/.test(v)) return `Enter a valid ${f.label.toLowerCase()}.`
    if (f.type === 'date') {
      const d = new Date(v)
      if (Number.isNaN(d.getTime()) || d > new Date() || d.getFullYear() < 1900) return 'Enter a valid date of birth.'
    }
  }
  return null
}

/** Only the current method's fields are sent, never leftovers from another method. */
export function fieldsFor(method: VerifyMethod, kind: VerifyKind, values: Record<string, string>): Record<string, string> {
  const def = METHODS[kind].find(m => m.id === method)
  const out: Record<string, string> = {}
  for (const f of def?.fields ?? []) {
    const v = (values[f.key] ?? '').trim()
    if (v) out[f.key] = v
  }
  return out
}

export function maskId(v: string | null | undefined): string {
  const s = String(v ?? '')
  if (s.length < 8) return '•'.repeat(s.length)
  return `${s.slice(0, 3)}${'•'.repeat(s.length - 6)}${s.slice(-3)}`
}

export function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return ((p[0][0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}

export const feeFor = (s: VerifyStatus | undefined, method: VerifyMethod): number | null => {
  const v = s?.fees?.[method]
  return typeof v === 'number' && v > 0 ? v : null
}

export interface SlipOption { tier: SlipTier; price: number; owned: boolean }
/** Tiers to offer. A tier with no price set is never offered. Owned tiers are free to re-download. */
export function slipOptions(s: VerifyStatus | undefined, kind: VerifyKind, owned: SlipTier[] = []): SlipOption[] {
  const out: SlipOption[] = []
  for (const tier of TIERS[kind]) {
    const price = s?.slips?.[`${kind}.${tier}`]
    const has = owned.includes(tier)
    if (has || (typeof price === 'number' && price > 0)) out.push({ tier, price: has ? 0 : (price as number), owned: has })
  }
  return out
}

export type Availability = 'available' | 'unavailable' | 'off'
export function availability(s: VerifyStatus | undefined, kind: VerifyKind): Availability {
  if (!s || !s.enabled) return 'off'
  return s.services?.[kind]?.available ? 'available' : 'unavailable'
}

export const hoursText = (h: number) => (h === 1 ? '1 hour' : `${h} hours`)

export function consentText(kind: VerifyKind, hours: number, never = false): string {
  const t = CONSENT_TEXT[kind]
  return never ? t.replace('kept for {hours} hours', 'stored securely and not deleted') : t.replace('{hours}', String(hours))
}

export function newRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** "Expires in 5h 12m" / "Expired" */
export function expiryText(expiresAt: string | null, now: Date = new Date()): string {
  if (!expiresAt) return ''
  const ms = new Date(expiresAt).getTime() - now.getTime()
  if (ms <= 0) return 'Expired'
  const mins = Math.floor(ms / 60000)
  const h = Math.floor(mins / 60)
  return h >= 1 ? `Kept for ${h}h ${mins % 60}m more` : `Kept for ${mins}m more`
}

export const isNinKind = (k: string | undefined): k is VerifyKind => k === 'nin' || k === 'bvn'
