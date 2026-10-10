import { describe, it, expect } from 'vitest'
import vectors from './__fixtures__/templateRules.vectors.json'
import type { TemplateSchema } from './templateRules'
import {
  addField, removeField, updateField, moveField, dependents, uniqueKey, slugKey, RESERVED_KEYS, allKeys,
  optionsFromText, optionsToText, hasPlainOptions, updateSelectorOption, updateSelectorLabel,
  parseNaira, addRule, deleteRule, moveRule, updateRule, describeRule, isDefaultRule, type PriceRule,
} from './templateBuilder'

const schemas = vectors.schemas as unknown as Record<string, TemplateSchema>
const attest = schemas['nin_attestation']
const validation = schemas['nin_validation']

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

describe('keys', () => {
  it('makes safe lowercase keys', () => {
    expect(slugKey('Mother’s Maiden Name!')).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(slugKey('123 abc').startsWith('f_')).toBe(true)
    expect(slugKey('')).toBe('field')
    expect(slugKey('x'.repeat(200)).length).toBeLessThanOrEqual(50)
  })
  it('never returns a reserved or taken key', () => {
    expect(RESERVED_KEYS.has(uniqueKey('Price Kobo', new Set()))).toBe(false)
    expect(RESERVED_KEYS.has(uniqueKey('Status', new Set()))).toBe(false)
    expect(uniqueKey('First Name', new Set(['first_name']))).toBe('first_name_2')
    const taken = new Set(['a', 'a_2', 'a_3'])
    expect(uniqueKey('a', taken)).toBe('a_4')
  })
})

describe('fields', () => {
  it('adds a field with a unique key and does not touch the input', () => {
    const before = clone(attest)
    const { schema, key } = addField(attest, 'text', 'First Name')
    expect(attest).toEqual(before)
    expect(allKeys(attest).has(key)).toBe(false)
    expect(schema.fields.length).toBe(attest.fields.length + 1)
    expect(new Set(schema.fields.map((f) => f.key)).size).toBe(schema.fields.length)
  })
  it('new dropdown starts with options, new file field accepts files', () => {
    const sel = addField(attest, 'select', 'Pick').schema.fields
    expect(sel[sel.length - 1]!.options!.length).toBeGreaterThan(0)
    const fil = addField(attest, 'file', 'Doc').schema.fields
    expect(fil[fil.length - 1]!.accept).toBeTruthy()
  })
  it('update trims empty hint/help/section away', () => {
    const k = attest.fields[0].key
    const a = updateField(attest, k, { placeholder: 'e.g. X', help: 'h' })
    expect(a.fields[0].placeholder).toBe('e.g. X')
    const b = updateField(a, k, { placeholder: '  ', help: '' })
    expect('placeholder' in b.fields[0]).toBe(false)
    expect('help' in b.fields[0]).toBe(false)
  })
  it('removing a field leaves no dangling visibility rule (every seeded service)', () => {
    for (const [code, s] of Object.entries(schemas)) {
      for (const f of s.fields) {
        const out = removeField(s, f.key)
        const keys = allKeys(out)
        for (const g of out.fields) {
          for (const c of g.visible_when ?? []) {
            expect(keys.has(c.field), `${code}: ${g.key} still depends on removed ${f.key}`).toBe(true)
          }
        }
        expect(out.fields.some((x) => x.key === f.key)).toBe(false)
      }
    }
  })
  // The seeded services only hang fields off the "type" selectors, so build a schema where a field
  // depends on ANOTHER FIELD (a director can create that) and prove removal cleans it up.
  const chained: TemplateSchema = {
    selectors: [],
    fields: [
      { key: 'has_spouse', label: 'Married?', type: 'select', options: ['Yes', 'No'], required: true },
      { key: 'spouse_name', label: 'Spouse name', type: 'text', visible_when: [{ field: 'has_spouse', in: ['Yes'] }] },
      { key: 'spouse_job', label: 'Spouse job', type: 'text', visible_when: [{ field: 'has_spouse', in: ['Yes'] }, { field: 'spouse_name', not_in: [''] }] },
    ],
  }
  it('removing a field other fields depend on drops exactly those conditions', () => {
    const out = removeField(chained, 'has_spouse')
    expect(out.fields.map((f) => f.key)).toEqual(['spouse_name', 'spouse_job'])
    expect(out.fields[0].visible_when).toBeUndefined()
    expect(out.fields[1].visible_when).toEqual([{ field: 'spouse_name', not_in: [''] }])
    expect(chained.fields[1].visible_when).toBeDefined()   // input untouched
  })
  it('dependents lists what would be affected', () => {
    expect(dependents(chained, 'has_spouse')).toEqual(['Spouse name', 'Spouse job'])
    expect(dependents(chained, 'spouse_job')).toEqual([])
  })
  it('move keeps every field, only reorders within a section', () => {
    for (const s of Object.values(schemas)) {
      for (const f of s.fields) {
        for (const dir of [-1, 1] as const) {
          const out = moveField(s, f.key, dir)
          expect(out.fields.map((x) => x.key).sort()).toEqual(s.fields.map((x) => x.key).sort())
          const sections = (x: TemplateSchema) => x.fields.map((y) => y.section ?? null)
          // the sequence of section names is unchanged: fields never jump into another section
          expect(sections(out)).toEqual(sections(s))
        }
      }
    }
  })
  it('moving the first field up / last down does nothing', () => {
    expect(moveField(attest, attest.fields[0].key, -1)).toEqual(attest)
    expect(moveField(attest, attest.fields[attest.fields.length - 1]!.key, 1)).toEqual(attest)
  })
})

describe('dropdown options', () => {
  it('one per line, trimmed, de-duplicated, blank lines dropped', () => {
    expect(optionsFromText(' A \n\nB\nA\n  \nC')).toEqual(['A', 'B', 'C'])
    expect(optionsToText(['A', 'B'])).toBe('A\nB')
  })
  it('all seeded dropdowns are plain-text options (editable)', () => {
    for (const s of Object.values(schemas)) for (const f of s.fields) if (f.type === 'select') expect(hasPlainOptions(f)).toBe(true)
  })
})

describe('types (selectors)', () => {
  it('renames a type but never changes its stored value', () => {
    const out = updateSelectorOption(validation, 'service_type', 'sim_validation', { label: 'SIM check', description: 'x' })
    const o = out.selectors.find((s) => s.key === 'service_type')!.options.find((x) => x.value === 'sim_validation')!
    expect(o.label).toBe('SIM check')
    expect(o.value).toBe('sim_validation')
    const cleared = updateSelectorOption(out, 'service_type', 'sim_validation', { description: ' ' })
    expect('description' in cleared.selectors[1].options.find((x) => x.value === 'sim_validation')!).toBe(false)
  })
  it('renames a selector label only', () => {
    const out = updateSelectorLabel(validation, 'service_type', 'Kind')
    expect(out.selectors.find((s) => s.key === 'service_type')!.label).toBe('Kind')
  })
})

describe('prices', () => {
  it('parses naira text into kobo, rejecting nonsense', () => {
    expect(parseNaira('₦15,000')).toBe(1_500_000)
    expect(parseNaira('15000.5')).toBe(1_500_050)
    expect(parseNaira('0')).toBeNull()
    expect(parseNaira('-5')).toBeNull()
    expect(parseNaira('12.345')).toBeNull()
    expect(parseNaira('abc')).toBeNull()
    expect(parseNaira('')).toBeNull()
  })
  const rules: PriceRule[] = [
    { when: { service_type: ['a'] }, price_kobo: 100 },
    { when: { service_type: ['b'] }, price_kobo: 200 },
    { when: {}, price_kobo: 300 },
  ]
  it('the default rule cannot be deleted and nothing moves past it', () => {
    expect(deleteRule(rules, 2)).toEqual(rules)
    expect(moveRule(rules, 1, 1)).toEqual(rules)
    expect(moveRule(rules, 2, -1)).toEqual(rules)
    expect(isDefaultRule(rules[2])).toBe(true)
  })
  it('deleting and moving ordinary rules works', () => {
    expect(deleteRule(rules, 0).length).toBe(2)
    expect(moveRule(rules, 0, 1).map((r) => r.price_kobo)).toEqual([200, 100, 300])
  })
  it('new rules go before the default; an empty condition is refused', () => {
    const out = addRule(rules, { service_type: ['c'] }, 999)
    expect(out.map((r) => r.price_kobo)).toEqual([100, 200, 999, 300])
    expect(isDefaultRule(out[out.length - 1]!)).toBe(true)
    expect(addRule(rules, {}, 5)).toEqual(rules)
    expect(addRule(rules, { service_type: [] }, 5)).toEqual(rules)
  })
  it('edits price/per without touching others and without mutating', () => {
    const before = clone(rules)
    const out = updateRule(rules, 1, { price_kobo: 777, per: 'bulk_count' })
    expect(rules).toEqual(before)
    expect(out[1]).toMatchObject({ price_kobo: 777, per: 'bulk_count' })
    expect(out[0]).toEqual(rules[0])
  })
  it('describes rules in plain words', () => {
    const r: PriceRule = { when: { service_type: ['sim_validation', 'bank_validation'] }, price_kobo: 1 }
    expect(describeRule(validation, r)).toMatch(/Validation Type: .*SIM.* or .*Bank/i)
    expect(describeRule(validation, { when: {}, price_kobo: 1 })).toMatch(/default/i)
  })
})
