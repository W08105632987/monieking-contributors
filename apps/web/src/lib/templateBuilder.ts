/**
 * Pure helpers for the director's template builder (Phase 4b).
 * No React, no network: every edit takes a schema/rules and returns a NEW one, so the
 * screen can keep a draft and undo is simply "go back to the saved version".
 *
 * The server is the authority: it re-validates everything on preview and publish.
 * These helpers only make sure the screen never builds something obviously impossible.
 */
import type { TemplateField, TemplateSchema, TemplateSelector, VisibilityRule } from './templateRules'

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

// ─── Conditions: "show this field only when…" (Phase 4c) ─────────────────────

export interface ConditionChoice { key: string; label: string; options: Array<{ value: string; label: string }> }

/** Fields that (directly or through others) depend on `key`. A field can never be controlled by one of these (it would loop). */
export function transitiveDependents(schema: TemplateSchema, key: string): Set<string> {
  const out = new Set<string>()
  const stack = [key]
  while (stack.length) {
    const k = stack.pop()!
    for (const f of schema.fields) {
      if (!out.has(f.key) && f.visible_when?.some((c) => c.field === k)) {
        out.add(f.key)
        stack.push(f.key)
      }
    }
  }
  return out
}

/** What a field's visibility can be tied to: the type questions, and dropdown fields (never itself or its own dependents). */
export function conditionCandidates(schema: TemplateSchema, key: string): ConditionChoice[] {
  const banned = transitiveDependents(schema, key)
  banned.add(key)
  const fromSelectors: ConditionChoice[] = schema.selectors.map((s) => ({
    key: s.key, label: s.label, options: s.options.map((o) => ({ value: o.value, label: o.label })),
  }))
  const fromFields: ConditionChoice[] = schema.fields
    .filter((f) => f.type === 'select' && !banned.has(f.key) && hasPlainOptions(f) && (f.options ?? []).length > 0)
    .map((f) => ({ key: f.key, label: f.label, options: (f.options as string[]).map((o) => ({ value: o, label: o })) }))
  return [...fromSelectors, ...fromFields]
}

/** Replace a field's visibility rules (none = always shown). Rules with no values are dropped. */
export function setConditions(schema: TemplateSchema, key: string, conds: VisibilityRule[]): TemplateSchema {
  const clean = conds.filter((c) => (c.in && c.in.length) || (c.not_in && c.not_in.length))
  return {
    ...schema,
    fields: schema.fields.map((f) => {
      if (f.key !== key) return f
      if (!clean.length) {
        const { visible_when: _drop, ...rest } = f
        return rest as TemplateField
      }
      return { ...f, visible_when: clean }
    }),
  }
}

// ─── Types (selector options): add, remove, reorder (Phase 4c) ───────────────

/** Stored value for a new type: lowercase_with_underscores, unique within the question, never empty. */
export function uniqueOptionValue(label: string, taken: Set<string>): string {
  const base = slugKey(label).replace(/^f_/, '') || 'option'
  let v = base
  let n = 2
  while (taken.has(v)) {
    v = `${base}_${n}`
    n += 1
  }
  return v
}

export function addSelectorOption(
  schema: TemplateSchema, selectorKey: string, label: string, description?: string,
): { schema: TemplateSchema; value: string } {
  const sel = schema.selectors.find((s) => s.key === selectorKey)
  const value = uniqueOptionValue(label, new Set((sel?.options ?? []).map((o) => o.value)))
  const opt: { value: string; label: string; description?: string } = { value, label: label.trim() }
  if (description?.trim()) opt.description = description.trim()
  return {
    value,
    schema: { ...schema, selectors: schema.selectors.map((s) => (s.key === selectorKey ? { ...s, options: [...s.options, opt] } : s)) },
  }
}

export function moveSelectorOption(schema: TemplateSchema, selectorKey: string, value: string, dir: -1 | 1): TemplateSchema {
  return {
    ...schema,
    selectors: schema.selectors.map((s) => {
      if (s.key !== selectorKey) return s
      const i = s.options.findIndex((o) => o.value === value)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.options.length) return s
      const options = [...s.options]
      ;[options[i], options[j]] = [options[j], options[i]]
      return { ...s, options }
    }),
  }
}

export interface RemoveTypeResult {
  schema: TemplateSchema
  rules: PriceRule[]
  droppedFields: string[]     // labels of fields that could only ever have shown for this type, now removed
  droppedRules: number        // price rules that could only ever have matched this type, now removed
  blockedReason?: string      // set => nothing changed
}

/**
 * Remove a type. Everything that pointed at it is cleaned up so nothing is left that could
 * never match or, worse, silently match MORE than before:
 *  - a price rule that was for this type is removed (never "narrowed" into a broader rule);
 *  - a field shown only for this type is removed;
 *  - the last type can't be removed, nor one the system itself relies on.
 */
export function removeSelectorOption(schema: TemplateSchema, rules: PriceRule[], selectorKey: string, value: string): RemoveTypeResult {
  const unchanged = (blockedReason: string): RemoveTypeResult => ({ schema, rules, droppedFields: [], droppedRules: 0, blockedReason })
  const sel = schema.selectors.find((s) => s.key === selectorKey)
  if (!sel || !sel.options.some((o) => o.value === value)) return unchanged('That type no longer exists.')
  if (sel.options.length <= 1) return unchanged('A question needs at least one type.')
  if (selectorKey === 'service_type' && schema.fixed_service_type === value) return unchanged('The system relies on this type; it can\'t be removed.')
  const q = schema.quantity_from
  if (q && String(q.when?.[selectorKey]) === value) return unchanged('The system relies on this type (it counts items from it); it can\'t be removed.')

  const selectors = schema.selectors.map((s) => (s.key === selectorKey ? { ...s, options: s.options.filter((o) => o.value !== value) } : s))

  const dropped = new Set<string>()
  let fields: TemplateField[] = schema.fields.map((f) => {
    if (!f.visible_when) return f
    const conds: VisibilityRule[] = []
    for (const c of f.visible_when) {
      if (c.field !== selectorKey) { conds.push(c); continue }
      if (c.in) {
        const rest = c.in.filter((v) => v !== value)
        if (rest.length === 0) dropped.add(f.key)         // could only show for the removed type
        else conds.push({ ...c, in: rest })
      } else if (c.not_in) {
        const rest = c.not_in.filter((v) => v !== value)
        if (rest.length) conds.push({ ...c, not_in: rest })   // an empty "is not" list excludes nothing: drop the rule
      }
    }
    if (dropped.has(f.key)) return f
    if (conds.length === f.visible_when.length && conds.every((c, i) => sameJson(c, f.visible_when![i]))) return f
    if (!conds.length) { const { visible_when: _x, ...rest } = f; return rest as TemplateField }
    return { ...f, visible_when: conds }
  })
  const droppedLabels = fields.filter((f) => dropped.has(f.key)).map((f) => f.label)
  fields = fields.filter((f) => !dropped.has(f.key))
  let next: TemplateSchema = { ...schema, selectors, fields }
  for (const k of dropped) next = removeField(next, k)   // anything that hung off a removed field loses that link too

  let removedRules = 0
  const newRules: PriceRule[] = []
  for (const r of rules) {
    const vals = r.when[selectorKey]
    if (!vals) { newRules.push(r); continue }
    const rest = vals.filter((v) => v !== value)
    if (rest.length === 0) { removedRules += 1; continue }
    newRules.push({ ...r, when: { ...r.when, [selectorKey]: rest } })
  }
  return { schema: next, rules: newRules, droppedFields: droppedLabels, droppedRules: removedRules }
}
