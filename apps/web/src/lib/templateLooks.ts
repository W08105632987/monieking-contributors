/**
 * Phase 5: the look of a service's order form.
 * A look only changes how the form is laid out. It never changes what is asked, what is
 * required, or what is charged (prices still come from the same price matrix).
 * Pure logic, no React, so it can be tested.
 */
import { isBlank, type TemplateField, type TemplateSchema, type Answers } from './templateRules'

export type LookId = 'classic' | 'compact' | 'guided'

export interface LookInfo { id: LookId; name: string; blurb: string }

export const LOOKS: LookInfo[] = [
  { id: 'classic', name: 'Classic', blurb: 'Roomy cards, one box per section. The look every service has today.' },
  { id: 'compact', name: 'Compact', blurb: 'Tighter spacing and chip choices. Best for forms with many short fields.' },
  { id: 'guided', name: 'Step by step', blurb: 'One section open at a time with a tick when it is done. Best for long forms.' },
]

const IDS = new Set<string>(LOOKS.map((l) => l.id))

/** Anything missing or unknown shows as Classic, so an old or odd value can never break a form. */
export function normalizeLook(v: unknown): LookId {
  return typeof v === 'string' && IDS.has(v) ? (v as LookId) : 'classic'
}

/** Copy of the schema with the look set. Classic is stored as "no look" so untouched services stay untouched. */
export function setLook(schema: TemplateSchema, look: LookId): TemplateSchema {
  const { look: _old, ...rest } = schema
  return look === 'classic' ? (rest as TemplateSchema) : { ...rest, look }
}

export interface Section { title: string | null; fields: TemplateField[] }

/** Group the visible fields into titled sections, in the order the template lists them. */
export function groupSections(fields: TemplateField[]): Section[] {
  const out: Section[] = []
  for (const f of fields) {
    const title = f.section ?? null
    const last = out[out.length - 1]
    if (last && last.title === title) last.fields.push(f)
    else out.push({ title, fields: [f] })
  }
  return out
}

/** Is everything this section needs filled in? (Same rules the form uses to block a submit.) */
export function sectionDone(fields: TemplateField[], answers: Answers): boolean {
  for (const f of fields) {
    const v = answers[f.key]
    if (f.required && isBlank(v)) return false
    if (f.type === 'digits' && !isBlank(v) && f.length) {
      const s = String(v)
      if (!(/^\d+$/.test(s) && s.length === f.length)) return false
    }
  }
  return true
}
