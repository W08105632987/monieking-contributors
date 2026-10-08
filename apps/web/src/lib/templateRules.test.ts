import { describe, it, expect } from 'vitest'
import vectors from './__fixtures__/templateRules.vectors.json'
import {
  visibleFields, missingRequired, stripHidden, parseNinList, normalizeValue, isBlank,
  type TemplateSchema,
} from './templateRules'

const schemas = vectors.schemas as unknown as Record<string, TemplateSchema>

describe('templateRules matches the Python engine', () => {
  it('has vectors to replay', () => {
    expect(vectors.cases.length).toBeGreaterThan(200)
    expect(Object.keys(schemas).length).toBe(10)
  })

  for (const [i, c] of (vectors.cases as any[]).entries()) {
    it(`#${i} ${c.service} / ${c.label}`, () => {
      const schema = schemas[c.service]
      expect(visibleFields(schema, c.answers).map((f) => f.key)).toEqual(c.visible)
      expect(missingRequired(schema, c.answers)).toEqual(c.missing)
      expect(stripHidden(schema, c.answers)).toEqual(c.stripped)
    })
  }
})

describe('helpers', () => {
  it('normalizes like the backend (lowercase, spaces to underscores)', () => {
    expect(normalizeValue(' GT Bank ')).toBe('gt_bank')
  })
  it('treats empty things as blank', () => {
    for (const v of [null, undefined, '', '   ', [], {}]) expect(isBlank(v)).toBe(true)
    for (const v of ['x', 0, false, ['a']]) expect(isBlank(v)).toBe(false)
  })
  it('parses NINs from text, ignoring junk lines', () => {
    expect(parseNinList('12345678901\nnope\n 987-654-32101 \n')).toEqual(['12345678901', '98765432101'])
    expect(parseNinList(['12345678901', '123'])).toEqual(['12345678901'])
    expect(parseNinList(null)).toEqual([])
  })
})
