import { describe, expect, it } from 'vitest'
import { isIdentityHiddenKey, withoutHiddenInPlayApp } from '@/lib/playApp'

const svc = (code: string, category: string) => ({ code, category })

describe('playApp', () => {
  it('knows which keys are identity services', () => {
    for (const k of ['nin', 'bvn', 'nimc', 'nin_modification', 'bvn-retrieval', 'ipe_clearance']) expect(isIdentityHiddenKey(k)).toBe(true)
    for (const k of ['airtime', 'bill_payments', 'tin_registration', 'cac_registration', 'attestation', 'ninja', '']) expect(isIdentityHiddenKey(k)).toBe(false)
  })
  it('hides identity services only in the Play app', () => {
    const list = [svc('nin_modification', 'nimc'), svc('bvn_retrieval', 'bvn'), svc('ipe_clearance', 'nimc'), svc('tin_registration', 'tin'), svc('airtime', 'airtime')]
    expect(withoutHiddenInPlayApp(list, true).map((s) => s.code)).toEqual(['airtime'])
    expect(withoutHiddenInPlayApp([svc('cac_registration', 'cac'), svc('bills', 'bills')], true).map((s) => s.code)).toEqual(['bills'])
    expect(withoutHiddenInPlayApp(list, false)).toHaveLength(5)
  })
})
