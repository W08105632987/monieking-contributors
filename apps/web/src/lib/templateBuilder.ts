/**
 * Pure helpers for the director's template builder (Phase 4b).
 * No React, no network: every edit takes a schema/rules and returns a NEW one, so the
 * screen can keep a draft and undo is simply "go back to the saved version".
 *
 * The server is the authority: it re-validates everything on preview and publish.
 * These helpers only make sure the screen never builds something obviously impossible.
 */
import type { TemplateField, TemplateSchema, TemplateSelector } from './templateRules'

export interface PriceRule {
  when: Record<string, string[]>
  price_kobo: number
  per?: 'flat' | 'bulk_count'
}

export const ADDABLE_FIELD_TYPES: Array<{ type: TemplateField['type']; label: string }> = [
  { type: 'text', label: 'Short text' },
  { type: 'textarea', label: 'Long text' },
  { type: 'phone', label: 'Phone number' },
  { type: 'email', label: 'Email' },
  { type: 'date', label: 'Date' },
  { type: 'select', label: 'Dropdown' },
  { type: 'digits', label: 'Digits only (e.g. NIN)' },
  { type: 'file', label: 'File upload' },
]

/** Mirrors the backend's reserved names. (The server still decides; this just avoids picking one.) */
export const RESERVED_KEYS = new Set([
  'id', 'user_id', 'price_kobo', 'status', 'consent_given', 'service_category', 'service_type',
  'enrollment_bank', 'bulk_count', 'uploaded_files', 'referral_code', 'referred_worker',
  'referred_worker_id', 'submitted_by_officer_id', 'worker_status', 'worker_response', 'worker_remarks',
  'worker_additional_info', 'worker_result_file_url', 'worker_commission_kobo', 'form_data', 'created_at',
  'updated_at', 'claimed_at', 'completed_at', 'expires_at', 'template_version_id', 'withdrawal_password',
  'transaction_pin',
])

export function slugKey(label: string): string {
  let k = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!k) k = 'field'
  if (!/^[a-z]/.test(k)) k = `f_${k}`
  return k.slice(0, 50)
}

export function allKeys(schema: TemplateSchema): Set<string> {
  return new Set([...schema.selectors.map((s) => s.key), ...schema.fields.map((f) => f.key)])
}

/** A key that is not reserved and not used by any field/selector. */
export function uniqueKey(label: string, taken: Set<string>): string {
  const base = slugKey(label)
  let k = base
  let n = 2
  while (taken.has(k) || RESERVED_KEYS.has(k)) {
    k = `${base.slice(0, 55)}_${n}`
    n += 1
  }
  return k
}

// ─── Fields ──────────────────────────────────────────────────────────────────

export function addField(
  schema: TemplateSchema, type: TemplateField['type'], label: string, section?: string,
): { schema: TemplateSchema; key: string } {
  const key = uniqueKey(label, allKeys(schema))
  const f: TemplateField = { key, label: label.trim() || 'New field', type, required: false, width: 'full' }
  if (section) f.section = section
  if (type === 'select') f.options = ['Option 1', 'Option 2']
  if (type === 'file') f.accept = 'image/*,application/pdf'
  return { schema: { ...schema, fields: [...schema.fields, f] }, key }
}

/** Remove a field. Fields other fields depend on lose those conditions too, so nothing dangles. */
export function removeField(schema: TemplateSchema, key: string): TemplateSchema {
  const fields = schema.fields
    .filter((f) => f.key !== key)
    .map((f) => {
      if (!f.visible_when?.some((c) => c.field === key)) return f
      const rest = f.visible_when.filter((c) => c.field !== key)
      const { visible_when: _drop, ...without } = f
      return rest.length ? { ...f, visible_when: rest } : (without as TemplateField)
    })
  return { ...schema, fields }
}

/** Fields whose visibility depends on this field (shown to the director before removing it). */
export function dependents(schema: TemplateSchema, key: string): string[] {
  return schema.fields.filter((f) => f.visible_when?.some((c) => c.field === key)).map((f) => f.label)
}

type FieldPatch = Partial<Pick<TemplateField, 'label' | 'placeholder' | 'help' | 'required' | 'width' | 'section' | 'options' | 'length' | 'max_items'>>

export function updateField(schema: TemplateSchema, key: string, patch: FieldPatch): TemplateSchema {
  return {
    ...schema,
    fields: schema.fields.map((f) => {
      if (f.key !== key) return f
      const next: TemplateField = { ...f, ...patch }
      // an emptied text box means "none", not an empty string stored forever
      for (const k of ['placeholder', 'help', 'section'] as const) {
        if (typeof next[k] === 'string' && next[k]!.trim() === '') delete next[k]
      }
      return next
    }),
  }
}

/** Move a field one place up/down among fields that share its section, keeping other sections in place. */
export function moveField(schema: TemplateSchema, key: string, dir: -1 | 1): TemplateSchema {
  const i = schema.fields.findIndex((f) => f.key === key)
  if (i < 0) return schema
  const section = schema.fields[i].section ?? null
  let j = i + dir
  while (j >= 0 && j < schema.fields.length && (schema.fields[j].section ?? null) !== section) j += dir
  if (j < 0 || j >= schema.fields.length) return schema
  const fields = [...schema.fields]
  ;[fields[i], fields[j]] = [fields[j], fields[i]]
  return { ...schema, fields }
}

export function optionsFromText(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of text.split('\n')) {
    const v = line.trim()
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

export function optionsToText(options: TemplateField['options']): string {
  return (options ?? []).map((o) => (typeof o === 'string' ? o : o.label)).join('\n')
}

/** Dropdown options written as { value, label } pairs are managed by the system; text options are editable. */
export function hasPlainOptions(f: TemplateField): boolean {
  return (f.options ?? []).every((o) => typeof o === 'string')
}

// ─── Selectors ("types") ─────────────────────────────────────────────────────

/** Rename a type or its description. The stored value never changes (old orders and prices use it). */
export function updateSelectorOption(
  schema: TemplateSchema, selectorKey: string, value: string, patch: { label?: string; description?: string },
): TemplateSchema {
  return {
    ...schema,
    selectors: schema.selectors.map((s): TemplateSelector => {
      if (s.key !== selectorKey) return s
      return {
        ...s,
        options: s.options.map((o) => {
          if (o.value !== value) return o
          const next = { ...o, ...patch }
          if (typeof next.description === 'string' && next.description.trim() === '') delete next.description
          return next
        }),
      }
    }),
  }
}

export function updateSelectorLabel(schema: TemplateSchema, selectorKey: string, label: string): TemplateSchema {
  return { ...schema, selectors: schema.selectors.map((s) => (s.key === selectorKey ? { ...s, label } : s)) }
}

// ─── Price rules ─────────────────────────────────────────────────────────────

/** "₦15,000", "15,000", "15000.50" -> kobo. null when it isn't a positive amount with at most 2 decimals. */
export function parseNaira(text: string): number | null {
  const t = text.replace(/[₦\s,]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const kobo = Math.round(Number(t) * 100)
  return Number.isSafeInteger(kobo) && kobo > 0 ? kobo : null
}

export function isDefaultRule(r: PriceRule): boolean {
  return Object.keys(r.when).length === 0
}

export function updateRule(rules: PriceRule[], index: number, patch: Partial<Pick<PriceRule, 'price_kobo' | 'per'>>): PriceRule[] {
  return rules.map((r, i) => (i === index ? { ...r, ...patch } : r))
}

/** The default (match-everything) rule must stay last, so it can't be deleted, and nothing moves past it. */
export function deleteRule(rules: PriceRule[], index: number): PriceRule[] {
  if (index < 0 || index >= rules.length || isDefaultRule(rules[index])) return rules
  return rules.filter((_, i) => i !== index)
}

export function moveRule(rules: PriceRule[], index: number, dir: -1 | 1): PriceRule[] {
  const j = index + dir
  if (index < 0 || j < 0 || index >= rules.length || j >= rules.length) return rules
  if (isDefaultRule(rules[index]) || isDefaultRule(rules[j])) return rules
  const next = [...rules]
  ;[next[index], next[j]] = [next[j], next[index]]
  return next
}

/** New rules go in front of the default, which stays last. */
export function addRule(rules: PriceRule[], when: Record<string, string[]>, price_kobo: number, per: 'flat' | 'bulk_count' = 'flat'): PriceRule[] {
  const clean: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(when)) if (v.length) clean[k] = v
  if (!Object.keys(clean).length) return rules
  const last = rules.length && isDefaultRule(rules[rules.length - 1]) ? rules.length - 1 : rules.length
  return [...rules.slice(0, last), { when: clean, price_kobo, per }, ...rules.slice(last)]
}

/** Plain-English condition for a rule: 'Validation Type: SIM Validation or Bank Validation'. */
export function describeRule(schema: TemplateSchema, rule: PriceRule): string {
  const parts = Object.entries(rule.when).map(([dim, values]) => {
    const sel = schema.selectors.find((s) => s.key === dim)
    const name = sel?.label ?? dim
    const labels = values.map((v) => sel?.options.find((o) => o.value === v)?.label ?? v)
    return `${name}: ${labels.join(' or ')}`
  })
  return parts.length ? parts.join(' + ') : 'Everything else (default price)'
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
