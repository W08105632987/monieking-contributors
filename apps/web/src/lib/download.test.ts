import { describe, it, expect } from 'vitest'
import { personFileName, safeName } from './download'

describe('download file names', () => {
  it('names slips after the person', () => expect(personFileName('NIN Slip', 'Ada Obi')).toBe('NIN Slip - Ada Obi.pdf'))
  it('strips characters that break file names', () => expect(safeName('A/B:C*?')).not.toMatch(/[\\/:*?"<>|]/))
  it('falls back cleanly when there is no name', () => expect(personFileName('BVN Slip', null)).toMatch(/^BVN Slip/))
})
