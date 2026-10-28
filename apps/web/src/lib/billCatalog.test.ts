import { describe, it, expect } from 'vitest'
import type { Biller } from '@/types'
import {
  groupByBiller, meterKind, meterKindsOf, parseDataPlan, bucketDataPlans, pickAirtimeProduct, matchesNetwork, groupToken, tokenToSpeech,
} from './billCatalog'

const row = (over: Partial<Biller>): Biller => ({
  id: Math.random().toString(36).slice(2), category: 'electricity', name: 'Ikeja Electric', product_id: 'p', product_name: 'p',
  price_kobo: null, requires_validation: true, ...over,
})

describe('providers', () => {
  it('groups products under their provider and sorts providers by name', () => {
    const groups = groupByBiller([
      row({ name: 'Ikeja Electric', product_id: 'product-ikedc-pre' }),
      row({ name: 'Abuja Electricity', product_id: 'product-aedc-pre' }),
      row({ name: 'Ikeja Electric', product_id: 'product-ikedc-post' }),
    ])
    expect(groups.map(g => g.name)).toEqual(['Abuja Electricity', 'Ikeja Electric'])
    expect(groups[1].products).toHaveLength(2)
  })

  it('tells prepaid from postpaid by product code or name', () => {
    expect(meterKind({ product_id: 'product-ikedc-pre', product_name: 'x' })).toBe('prepaid')
    expect(meterKind({ product_id: 'product-ikedc-post', product_name: 'x' })).toBe('postpaid')
    expect(meterKind({ product_id: '1', product_name: 'IKEDC POSTPAID' })).toBe('postpaid')
    expect(meterKind({ product_id: '2', product_name: 'Eko Prepaid Meter' })).toBe('prepaid')
    expect(meterKind({ product_id: '3', product_name: 'Premium token' })).toBe('other')
  })

  it('lists only the meter kinds a provider really has, prepaid first', () => {
    const kinds = meterKindsOf([
      row({ product_id: 'a-post', product_name: 'a' }), row({ product_id: 'a-pre', product_name: 'b' }),
    ])
    expect(kinds).toEqual(['prepaid', 'postpaid'])
  })
})

describe('data plans', () => {
  it('parses size and validity', () => {
    expect(parseDataPlan('2GB 30 Days')).toMatchObject({ sizeText: '2 GB', sizeMb: 2048, days: 30, bucket: 'monthly', validityText: '30 days' })
    expect(parseDataPlan('1.5GB Daily')).toMatchObject({ sizeText: '1.5 GB', days: 1, bucket: 'daily' })
    expect(parseDataPlan('500MB 7 days')).toMatchObject({ sizeMb: 500, bucket: 'weekly' })
    expect(parseDataPlan('Weekly 3GB')).toMatchObject({ days: 7, bucket: 'weekly' })
    expect(parseDataPlan('10GB 2 Months')).toMatchObject({ days: 60, bucket: 'extended', validityText: '2 months' })
    expect(parseDataPlan('Mystery bundle')).toMatchObject({ sizeText: null, bucket: 'other' })
  })

  it('treats hours as a daily plan', () => {
    expect(parseDataPlan('100MB 12 hours')).toMatchObject({ bucket: 'daily', validityText: '12 hrs' })
  })

  it('orders buckets daily -> weekly -> monthly and each plan list small -> big', () => {
    const plans = [
      row({ category: 'data', product_name: '10GB 30 Days', price_kobo: 300000 }),
      row({ category: 'data', product_name: '1GB 1 Day', price_kobo: 30000 }),
      row({ category: 'data', product_name: '2GB 30 Days', price_kobo: 150000 }),
      row({ category: 'data', product_name: '1GB 7 Days', price_kobo: 80000 }),
    ]
    const groups = bucketDataPlans(plans)
    expect(groups.map(g => g.bucket)).toEqual(['daily', 'weekly', 'monthly'])
    expect(groups[2].plans.map(p => p.plan.product_name)).toEqual(['2GB 30 Days', '10GB 30 Days'])
  })
})

describe('airtime', () => {
  const rows = [
    row({ category: 'airtime', name: 'AIRTEL', product_id: '1849', product_name: '2GB 30 Days', price_kobo: 150000 }),
    row({ category: 'airtime', name: 'AIRTEL', product_id: '11', product_name: 'Airtel Mobile Top up', price_kobo: null }),
    row({ category: 'airtime', name: 'MTN', product_id: '5', product_name: 'MTN VTU', price_kobo: null }),
  ]
  it('picks the variable-amount product, never a fixed-price bundle', () => {
    expect(pickAirtimeProduct(rows, 'Airtel')?.product_id).toBe('11')
    expect(pickAirtimeProduct(rows, 'MTN')?.product_id).toBe('5')
  })
  it('returns nothing when a network has only bundles', () => {
    expect(pickAirtimeProduct(rows.slice(0, 1), 'Airtel')).toBeUndefined()
    expect(pickAirtimeProduct(rows, null)).toBeUndefined()
  })
  it('matches 9mobile by either name', () => {
    expect(matchesNetwork({ name: 'ETISALAT' }, '9mobile')).toBe(true)
    expect(matchesNetwork({ name: '9MOBILE' }, '9mobile')).toBe(true)
    expect(matchesNetwork({ name: 'MTN' }, '9mobile')).toBe(false)
  })
})

describe('tokens', () => {
  it('groups digits in fours for reading', () => {
    expect(groupToken('12345678901234567890')).toBe('1234 5678 9012 3456 7890')
    expect(groupToken('1234-5678-9012')).toBe('1234 5678 9012')
    expect(groupToken('AB12CD')).toBe('AB12CD')
  })
  it('speaks digits one at a time with a pause every four', () => {
    expect(tokenToSpeech('12345678')).toBe('1 2 3 4, 5 6 7 8')
    expect(tokenToSpeech('123456')).toBe('1 2 3 4, 5 6')
  })
})

import { providerName, groupByProvider, planExtras } from './billCatalog'

describe('provider grouping (Monnify names each DISCO per product)', () => {
  it('strips prepaid/postpaid so one provider holds both', () => {
    expect(providerName('Eko Electricity Distribution Prepaid')).toBe('Eko Electricity Distribution')
    expect(providerName('Eko Electricity Distribution Postpaid')).toBe('Eko Electricity Distribution')
    expect(providerName('BEDC')).toBe('BEDC')
    expect(providerName('Port Harcourt Electricity Distribution Pre-paid')).toBe('Port Harcourt Electricity Distribution')
  })
  it('gathers the prepaid and postpaid billers under one provider', () => {
    const mk = (name: string, product_id: string) => ({ id: product_id, category: 'electricity', name, product_id, product_name: name, price_kobo: null, requires_validation: true }) as never
    const groups = groupByProvider([
      mk('Eko Electricity Distribution Prepaid', 'product-ekedc-pre'), mk('Eko Electricity Distribution Postpaid', 'product-ekedc-post'),
      mk('Ikeja Electricity Distribution Prepaid', 'product-ikedc-pre'),
    ])
    expect(groups.map(g => g.name)).toEqual(['Eko Electricity Distribution', 'Ikeja Electricity Distribution'])
    expect(groups[0].products).toHaveLength(2)
  })
})

describe('planExtras', () => {
  it('keeps only what size and validity do not already show', () => {
    expect(planExtras('2GB 30 Days')).toBe('')
    expect(planExtras('1GB Weekly Plan Valid For 7 Days')).toBe('')
    expect(planExtras('60GB + 2GB Youtube Night + 200MB (YT, IG & Tiktok) Monthly Plan Valid For 30Days')).toContain('Youtube Night')
    expect(planExtras('ROUTER Unlimited 60MBPS 30 Days')).toContain('ROUTER')
  })
})
