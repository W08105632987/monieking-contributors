import { describe, it, expect } from 'vitest'
import vectors from './__fixtures__/templateRules.vectors.json'
import type { TemplateSchema } from './templateRules'
import {
  conditionCandidates, setConditions, transitiveDependents, addSelectorOption, moveSelectorOption,
  removeSelectorOption, uniqueOptionValue, type PriceRule,
} from './templateBuilder'

const seeded = vectors.schemas as unknown as Record<string, TemplateSchema>
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

// kind of form a director could build: a type question, a dropdown, and fields hanging off both
const base = (): TemplateSchema => ({
  selectors: [{ key: 'service_type', label: 'Type', required: true, options: [
    { value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' },
  ] }],
  fields: [
    { key: 'only_a', label: 'Only for Alpha', type: 'text', visible_when: [{ field: 'service_type', in: ['a'] }] },
    { key: 'a_or_b', label: 'Alpha or Beta', type: 'text', visible_when: [{ field: 'service_type', in: ['a', 'b'] }] },
    { key: 'not_c', label: 'Not Gamma', type: 'text', visible_when: [{ field: 'service_type', not_in: ['c'] }] },
    { key: 'married', label: 'Married?', type: 'select', options: ['Yes', 'No'] },
    { key: 'spouse', label: 'Spouse', type: 'text', visible_when: [{ field: 'married', in: ['Yes'] }] },
    { key: 'always', label: 'Always', type: 'text' },
  ],
})
const rules = (): PriceRule[] => [
  { when: { service_type: ['a'] }, price_kobo: 100 },
  { when: { service_type: ['b', 'c'] }, price_kobo: 200 },
  { when: { service_type: ['a'], enrollment_bank: ['x'] }, price_kobo: 150 },
  { when: {}, price_kobo: 300 },
]

describe('condition choices', () => {
  it('offers the type questions and dropdown fields, never the field itself or its dependents', () => {
    const s = base()
    const keys = conditionCandidates(s, 'always').map((c) => c.key)
    expect(keys).toEqual(['service_type', 'married'])
    expect(conditionCandidates(s, 'married').map((c) => c.key)).toEqual(['service_type'])   // 'spouse' hangs off it
  })
  it('finds dependents through a chain', () => {
    const s = base()
    s.fields.push({ key: 'spouse_job', label: 'Job', type: 'select', options: ['x'], visible_when: [{ field: 'spouse', not_in: [''] }] })
    s.fields.push({ key: 'deep', label: 'Deep', type: 'text', visible_when: [{ field: 'spouse_job', in: ['x'] }] })
    expect([...transitiveDependents(s, 'married')].sort()).toEqual(['deep', 'spouse', 'spouse_job'])
    expect(conditionCandidates(s, 'spouse').map((c) => c.key)).not.toContain('deep')
  })
  it('works on every seeded service without throwing', () => {
    for (const s of Object.values(seeded)) for (const f of s.fields) expect(Array.isArray(conditionCandidates(s, f.key))).toBe(true)
  })
})

describe('setConditions', () => {
  it('sets, replaces and clears a field\'s visibility rules without touching others', () => {
    const s = base()
    const a = setConditions(s, 'always', [{ field: 'service_type', in: ['b'] }])
    expect(a.fields.find((f) => f.key === 'always')!.visible_when).toEqual([{ field: 'service_type', in: ['b'] }])
    expect(s.fields.find((f) => f.key === 'always')!.visible_when).toBeUndefined()
    const b = setConditions(a, 'always', [])
    expect('visible_when' in b.fields.find((f) => f.key === 'always')!).toBe(false)
    expect(b.fields.find((f) => f.key === 'only_a')).toEqual(s.fields.find((f) => f.key === 'only_a'))
  })
  it('drops rules that have no values', () => {
    const out = setConditions(base(), 'always', [{ field: 'service_type', in: [] }, { field: 'married', not_in: ['No'] }])
    expect(out.fields.find((f) => f.key === 'always')!.visible_when).toEqual([{ field: 'married', not_in: ['No'] }])
  })
})

describe('adding and ordering types', () => {
  it('adds a type with a unique stored value and does not touch the input', () => {
    const s = base()
    const before = clone(s)
    const { schema, value } = addSelectorOption(s, 'service_type', 'Delta Plus', ' extra ')
    expect(s).toEqual(before)
    expect(value).toBe('delta_plus')
    const opt = schema.selectors[0].options.find((o) => o.value === value)!
    expect(opt).toEqual({ value: 'delta_plus', label: 'Delta Plus', description: 'extra' })
    expect(addSelectorOption(schema, 'service_type', 'Delta Plus').value).toBe('delta_plus_2')
  })
  it('generated values are lowercase/underscore (what the price engine normalises to), even for odd labels', () => {
    for (const label of ['  ', '123', 'Ünïcode Café!', 'a b  c', 'x'.repeat(100)]) {
      const v = uniqueOptionValue(label, new Set())
      expect(v).toMatch(/^[a-z0-9_]+$/)
      expect(v.length).toBeGreaterThan(0)
    }
  })
  it('moves a type, stopping at the ends', () => {
    const s = base()
    const down = moveSelectorOption(s, 'service_type', 'a', 1)
    expect(down.selectors[0].options.map((o) => o.value)).toEqual(['b', 'a', 'c'])
    expect(moveSelectorOption(s, 'service_type', 'a', -1)).toEqual(s)
    expect(moveSelectorOption(s, 'service_type', 'c', 1)).toEqual(s)
  })
})

describe('removing a type', () => {
  it('removes a price rule that was only for that type; never widens a rule', () => {
    const r = removeSelectorOption(base(), rules(), 'service_type', 'a')
    // rule 1 (only a) gone; rule 3 (a + bank x) gone too, NOT turned into "bank x for everything"
    expect(r.rules.map((x) => x.price_kobo)).toEqual([200, 300])
    expect(r.droppedRules).toBe(2)
    expect(r.rules.every((x) => Object.keys(x.when).length === 0 || x.when.service_type)).toBe(true)
  })
  it('narrows a rule that covered several types', () => {
    const r = removeSelectorOption(base(), rules(), 'service_type', 'c')
    expect(r.rules.find((x) => x.price_kobo === 200)!.when.service_type).toEqual(['b'])
    expect(r.droppedRules).toBe(0)
  })
  it('removes a field that could only show for that type, narrows or frees the others', () => {
    const r = removeSelectorOption(base(), rules(), 'service_type', 'a')
    expect(r.droppedFields).toEqual(['Only for Alpha'])
    const byKey = Object.fromEntries(r.schema.fields.map((f) => [f.key, f]))
    expect(byKey.only_a).toBeUndefined()
    expect(byKey.a_or_b.visible_when).toEqual([{ field: 'service_type', in: ['b'] }])
    expect(r.schema.selectors[0].options.map((o) => o.value)).toEqual(['b', 'c'])
    const c = removeSelectorOption(base(), rules(), 'service_type', 'c')
    expect('visible_when' in c.schema.fields.find((f) => f.key === 'not_c')!).toBe(false)   // "not Gamma" has nothing left to exclude
  })
  it('a field that hung off a removed field loses that link too', () => {
    const s = base()
    s.fields.push({ key: 'child', label: 'Child', type: 'text', visible_when: [{ field: 'only_a', not_in: [''] }] })
    const r = removeSelectorOption(s, rules(), 'service_type', 'a')
    expect(r.schema.fields.find((f) => f.key === 'child')!.visible_when).toBeUndefined()
  })
  it('refuses the last type, an unknown type, and types the system relies on', () => {
    const s = base()
    s.selectors[0].options = [{ value: 'a', label: 'Alpha' }]
    expect(removeSelectorOption(s, rules(), 'service_type', 'a').blockedReason).toMatch(/at least one/)
    expect(removeSelectorOption(base(), rules(), 'service_type', 'zzz').blockedReason).toBeTruthy()
    const fixed = { ...base(), fixed_service_type: 'b' }
    expect(removeSelectorOption(fixed, rules(), 'service_type', 'b').blockedReason).toMatch(/system/)
    const qty: TemplateSchema = { ...base(), selectors: [{ key: 'submit_mode', label: 'Mode', options: [{ value: 'single', label: 'S' }, { value: 'bulk', label: 'B' }] }], quantity_from: { field: 'x', when: { submit_mode: 'bulk' } } }
    expect(removeSelectorOption(qty, [], 'submit_mode', 'bulk').blockedReason).toMatch(/system/)
    expect(removeSelectorOption(qty, [], 'submit_mode', 'single').blockedReason).toBeUndefined()
  })
  it('a blocked removal changes nothing, and success never mutates the input', () => {
    const s = base(); const rs = rules()
    const bs = clone(s); const brs = clone(rs)
    removeSelectorOption(s, rs, 'service_type', 'a')
    expect(s).toEqual(bs); expect(rs).toEqual(brs)
    const blocked = removeSelectorOption(s, rs, 'service_type', 'nope')
    expect(blocked.schema).toBe(s); expect(blocked.rules).toBe(rs)
  })
  it('removing any type from any seeded service keeps the form valid-looking (no dangling conditions, at least one type)', () => {
    for (const [code, s] of Object.entries(seeded)) {
      for (const sel of s.selectors) {
        for (const o of sel.options) {
          const r = removeSelectorOption(s, [], sel.key, o.value)
          if (r.blockedReason) continue
          const keys = new Set([...r.schema.selectors.map((x) => x.key), ...r.schema.fields.map((f) => f.key)])
          for (const f of r.schema.fields) for (const c of f.visible_when ?? []) expect(keys.has(c.field), `${code}/${f.key}`).toBe(true)
          expect(r.schema.selectors.find((x) => x.key === sel.key)!.options.length).toBeGreaterThan(0)
        }
      }
    }
  })
})
