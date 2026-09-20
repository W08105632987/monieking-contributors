import { useMemo, useState } from 'react'

export type StatsRangeKey = 'all' | 'today' | '7d' | 'custom'

function fmt(d: Date) {
  return d.toISOString().slice(0, 10)
}

/**
 * The All time / Today / 7 days / Custom range filter used everywhere
 * the Customer Statistics panel appears. Defaults to 'all' — an officer
 * or director landing on their dashboard sees the whole picture first,
 * and narrows down from there, rather than starting on "today" and
 * having to remember to widen it.
 *
 * start_date/end_date are undefined (not today's date) for 'all' — the
 * backend's date_range_filters() already treats missing start/end as
 * "no filter, all time" everywhere this hook's output gets sent, so
 * "all time" here means "send nothing" rather than a huge fake range.
 */
export function useStatsRangeFilter() {
  const [rangeKey, setRangeKey] = useState<StatsRangeKey>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const { start_date, end_date, label } = useMemo(() => {
    const today = fmt(new Date())
    if (rangeKey === 'all') {
      return { start_date: undefined as string | undefined, end_date: undefined as string | undefined, label: 'All time' }
    }
    if (rangeKey === 'today') {
      return { start_date: today, end_date: today, label: 'Today' }
    }
    if (rangeKey === '7d') {
      const start = new Date()
      start.setDate(start.getDate() - 6) // inclusive of today = 7 days
      return { start_date: fmt(start), end_date: today, label: 'Last 7 days' }
    }
    if (customStart && customEnd) {
      return { start_date: customStart, end_date: customEnd, label: `${customStart} → ${customEnd}` }
    }
    return { start_date: undefined as string | undefined, end_date: undefined as string | undefined, label: 'All time' }
  }, [rangeKey, customStart, customEnd])

  return { rangeKey, setRangeKey, customStart, setCustomStart, customEnd, setCustomEnd, start_date, end_date, label }
}
