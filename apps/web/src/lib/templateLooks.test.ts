import { describe, expect, test } from 'vitest'
import { LOOKS, normalizeLook, setLook, groupSections, sectionDone } from './templateLooks'
import type { TemplateField, TemplateSchema } from './templateRules'

const f = (key: string, extra: Partial<TemplateField> = {}): TemplateField =>
  ({ key, label: key, type: 'text', required: false, ...extra }) as TemplateField
const schema: TemplateSchema = { selectors: [], fields: [f('a')] }

describe('normalizeLook', () => {
  test('known looks pass through', () => { for (const l of LOOKS) expect(normalizeLook(l.id)).toBe(l.id) })
  test('missing or unknown means classic', () => {
    for (const v of [undefined, null, '', 'fancy', 3, {}]) expect(normalizeLook(v)).toBe('classic')
  })
})

describe('setLook', () => {
  test('sets and replaces the look without touching anything else', () => {
    const a = setLook(schema, 'guided')
    expect(a.look).toBe('guided')
    expect(a.fields).toEqual(schema.fields)
    expect(setLook(a, 'compact').look).toBe('compact')
  })
  test('classic is stored as no look at all, so untouched services stay identical', () => {
    expect(setLook(setLook(schema, 'compact'), 'classic')).toEqual(schema)
    expect('look' in setLook(schema, 'classic')).toBe(false)
  })
  test('does not change the input', () => {
    const before = JSON.stringify(schema)
    setLook(schema, 'guided')
    expect(JSON.stringify(schema)).toBe(before)
  })
})

describe('groupSections', () => {
  test('groups neighbours with the same title, keeps order', () => {
    const s = groupSections([f('a', { section: 'X' }), f('b', { section: 'X' }), f('c'), f('d', { section: 'X' })])
    expect(s.map((x) => [x.title, x.fields.map((y) => y.key)])).toEqual([['X', ['a', 'b']], [null, ['c']], ['X', ['d']]])
  })
  test('empty gives no sections', () => { expect(groupSections([])).toEqual([]) })
})

describe('sectionDone', () => {
  test('required blank is not done, filled is done', () => {
    expect(sectionDone([f('a', { required: true })], {})).toBe(false)
    expect(sectionDone([f('a', { required: true })], { a: '  ' })).toBe(false)
    expect(sectionDone([f('a', { required: true })], { a: 'x' })).toBe(true)
  })
  test('optional blank is done', () => { expect(sectionDone([f('a')], {})).toBe(true) })
  test('digits must be the exact length when filled', () => {
    const d = f('n', { type: 'digits', length: 11, required: true } as Partial<TemplateField>)
    expect(sectionDone([d], { n: '123' })).toBe(false)
    expect(sectionDone([d], { n: '12345678901' })).toBe(true)
  })
})

import {
  addField, removeField, updateField, moveField, setConditions, addSelectorOption, moveSelectorOption, removeSelectorOption,
} from './templateBuilder'

describe('the look survives every builder edit', () => {
  const base: TemplateSchema = {
    look: 'guided',
    selectors: [{ key: 'service_type', label: 'Type', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }],
    fields: [f('one'), f('two')],
  } as TemplateSchema

  test.each([
    ['addField', (s: TemplateSchema) => addField(s, 'text', 'New').schema],
    ['removeField', (s: TemplateSchema) => removeField(s, 'two')],
    ['updateField', (s: TemplateSchema) => updateField(s, 'one', { label: 'Renamed' })],
    ['moveField', (s: TemplateSchema) => moveField(s, 'two', -1)],
    ['setConditions', (s: TemplateSchema) => setConditions(s, 'one', [{ field: 'service_type', in: ['a'] }])],
    ['addSelectorOption', (s: TemplateSchema) => addSelectorOption(s, 'service_type', 'C').schema],
    ['moveSelectorOption', (s: TemplateSchema) => moveSelectorOption(s, 'service_type', 'b', -1)],
    ['removeSelectorOption', (s: TemplateSchema) => removeSelectorOption(s, [], 'service_type', 'b').schema],
  ])('%s', (_name, op) => {
    expect(op(base).look).toBe('guided')
  })
})
