export interface DayPoint { date: string; contributed_kobo: number; withdrawn_kobo: number }
export interface Bucket { start: string; end: string; contributed_kobo: number; withdrawn_kobo: number; days: number }

/** Never draw more than this many bars, so a long range cannot overflow a phone screen. */
export const MAX_BARS = 31

/** Size of one bar in days: a day, a week, two weeks, then roughly a month. */
export function bucketDays(n: number, maxBars = MAX_BARS): number {
  if (n <= maxBars) return 1
  const need = Math.ceil(n / maxBars)
  for (const size of [7, 14, 30, 60, 91]) if (need <= size) return size
  return Math.ceil(need / 30) * 30
}

/** Group the daily series into at most `maxBars` bars; nothing is lost, totals always match. */
export function bucketSeries(series: DayPoint[], maxBars = MAX_BARS): Bucket[] {
  const size = bucketDays(series.length, maxBars)
  const out: Bucket[] = []
  for (let i = 0; i < series.length; i += size) {
    const part = series.slice(i, i + size)
    out.push({
      start: part[0].date,
      end: part[part.length - 1].date,
      contributed_kobo: part.reduce((s, d) => s + d.contributed_kobo, 0),
      withdrawn_kobo: part.reduce((s, d) => s + d.withdrawn_kobo, 0),
      days: part.length,
    })
  }
  return out
}
