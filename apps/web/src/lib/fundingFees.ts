import { formatNairaAmount } from '@/lib/utils'

export interface FeeTier { from: number; to: number | null; fee: number }

export const DEFAULT_TIERS: FeeTier[] = [
  { from: 0, to: 5000, fee: 10 },
  { from: 5001, to: 10000, fee: 20 },
  { from: 10001, to: 20000, fee: 30 },
  { from: 20001, to: null, fee: 50 },
]

const n = (x: number) => formatNairaAmount(x)

/** Same rules as the server: start at ₦0, no gaps, no overlaps, last range open-ended. */
export function validateTiers(tiers: FeeTier[]): string[] {
  if (!tiers.length) return ['Add at least one price range.']
  const out: string[] = []
  let prevTo: number | null = null
  tiers.forEach((t, i) => {
    const label = `Range ${i + 1}`
    const last = i === tiers.length - 1
    if (!Number.isFinite(t.fee) || t.fee < 0) out.push(`${label}: the fee cannot be negative.`)
    if (i === 0 && t.from !== 0) out.push(`${label} must start at ₦0, otherwise payments below ${n(t.from)} have no fee rule.`)
    if (prevTo !== null) {
      if (t.from > prevTo + 1) out.push(`Gap: payments from ${n(prevTo + 1)} to ${n(t.from - 1)} are not covered. ${label} should start at ${n(prevTo + 1)}.`)
      else if (t.from <= prevTo) out.push(`Overlap: ${label} starts at ${n(t.from)} but the range before it already covers up to ${n(prevTo)}. It should start at ${n(prevTo + 1)}.`)
    }
    if (t.to === null) {
      if (!last) out.push(`${label} has no upper limit, so nothing can come after it.`)
    } else {
      if (t.to < t.from) out.push(`${label}: the upper limit ${n(t.to)} is lower than its start ${n(t.from)}.`)
      if (last) out.push(`The last range must be open-ended ("and above"), otherwise payments above ${n(t.to)} have no fee rule.`)
    }
    prevTo = t.to
  })
  return out
}

/** Make every range start right after the one before it. */
export function closeGaps(tiers: FeeTier[]): FeeTier[] {
  return tiers.map((t, i) => (i === 0 ? { ...t, from: 0 } : { ...t, from: (tiers[i - 1].to ?? tiers[i - 1].from) + 1 }))
}
