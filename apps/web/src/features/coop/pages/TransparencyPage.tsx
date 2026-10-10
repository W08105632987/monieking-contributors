import { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { useTransparency } from '../api'
import { Bar, Card, CoopPage, SectionTitle, Skel, Stat, compactNaira, dDay, dShort, inputCls, pctText } from '../ui'

const RANGES = [['7d', '7 days'], ['30d', '30 days'], ['year', 'This year'], ['custom', 'Custom']] as const

export default function TransparencyPage() {
  const [range, setRange] = useState<string>('30d')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [pick, setPick] = useState<number | null>(null)
  const { data: t, isFetching, error } = useTransparency(range, start || undefined, end || undefined)
  const max = useMemo(() => Math.max(1, ...(t?.series.map((d) => d.contributed_kobo) ?? [1])), [t])
  const p = t?.profit
  const shown = pick !== null ? t?.series[pick] : null
  const bars = t?.series ?? []
  const dense = bars.length > 45

  return (
    <CoopPage title="Transparency" subtitle="What the cooperative holds, every day" back="/coop">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {RANGES.map(([k, l]) => (
          <button key={k} onClick={() => { setRange(k); setPick(null) }}
            className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-bold ${range === k ? 'bg-green-700 text-white dark:bg-green-600' : 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100'}`}>{l}</button>
        ))}
      </div>
      {range === 'custom' && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} aria-label="From" />
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} aria-label="To" />
        </div>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-red-600">{(error as any)?.response?.data?.detail ?? 'Could not load this range'}</p>}

      {!t ? <div className="mt-4 space-y-3"><Skel h="h-48" /><Skel /></div> : (
        <>
          <Card className="mt-4">
            <div className="flex items-end justify-between">
              <Stat label="Contributed in this period" value={formatNaira(t.range_totals.contributed_kobo)} sub={`${dShort(t.range.start)} to ${dShort(t.range.end)}`} />
              {isFetching && <span className="h-4 w-4 animate-spin rounded-full border-2 border-green-500 border-t-transparent" />}
            </div>
            <div className="mt-4 flex h-32 items-end gap-[3px]" role="img" aria-label="Daily contributions">
              {bars.map((d, i) => (
                <button key={d.date} onClick={() => setPick(pick === i ? null : i)} aria-label={`${dDay(d.date)}: ${formatNaira(d.contributed_kobo)}`}
                  className={`min-w-[2px] flex-1 rounded-t ${pick === i ? 'bg-amber-400' : 'bg-green-500 dark:bg-green-400'}`}
                  style={{ height: `${Math.max(d.contributed_kobo ? 4 : 1, (d.contributed_kobo / max) * 100)}%`, opacity: d.contributed_kobo ? 1 : 0.25 }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-green-500 dark:text-night-300">
              <span>{dDay(t.range.start)}</span>{!dense && <span>{compactNaira(max)} peak</span>}<span>{dDay(t.range.end)}</span>
            </div>
            <p className="mt-2 min-h-[1.25rem] text-sm font-semibold text-green-800 dark:text-night-100">
              {shown ? `${dShort(shown.date)}: ${formatNaira(shown.contributed_kobo)} in${shown.withdrawn_kobo ? `, ${formatNaira(shown.withdrawn_kobo)} out` : ''}` : 'Tap a bar to see that day.'}
            </p>
          </Card>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Card><Stat label="Members" value={t.cooperative.members} /></Card>
            <Card><Stat label="Total held" value={compactNaira(t.cooperative.total_contributions_kobo)} /></Card>
            <Card><Stat label="Loans out" value={compactNaira(t.cooperative.loans_outstanding_kobo)} sub={`${t.cooperative.loans_active} active`} /></Card>
            <Card><Stat label="Withdrawn (period)" value={compactNaira(t.range_totals.withdrawn_kobo)} /></Card>
          </div>

          <SectionTitle>Profit for {p!.year}</SectionTitle>
          <Card>
            <Stat label="Dividend pool so far" value={formatNaira(p!.dividend_pool_kobo)} sub="Money actually received" />
            <div className="mt-3 space-y-2 text-sm">
              <Row l="Interest received" v={p!.interest_realised_kobo} />
              <Row l="Less running costs" v={-p!.running_cost_kobo} />
              <Row l="Overdue charges received" v={p!.overdue_charges_received_kobo} />
              <Row l="Early withdrawal charges" v={p!.withdrawal_charges_kobo} />
            </div>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs font-bold text-green-800 dark:text-night-100">
                <span>Contributors {pctText(p!.contribution_pct * 100)}</span><span>Guarantors {pctText(p!.guarantee_pct * 100)}</span></div>
              <Bar value={p!.contribution_pct} max={100} tone="green" />
              <div className="mt-1 flex justify-between text-xs text-green-700 dark:text-night-200">
                <span>{formatNaira(p!.contribution_share_kobo)}</span><span>{formatNaira(p!.guarantee_share_kobo)}</span></div>
            </div>
          </Card>
          <Card className="mt-3 bg-amber-50 dark:bg-amber-500/10">
            <div className="flex gap-2"><Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="text-xs text-amber-900 dark:text-amber-200">
                <p><b>Owed but not yet received:</b> {formatNaira(p!.overdue_charges_accrued_uncollected_kobo)} in overdue charges. This is NOT counted in the pool until it is actually paid.</p>
                <p className="mt-1">{p!.note}</p></div></div>
          </Card>
        </>
      )}
    </CoopPage>
  )
}

function Row({ l, v }: { l: string; v: number }) {
  return <div className="flex justify-between text-green-800 dark:text-night-100"><span>{l}</span><span className={`font-bold ${v < 0 ? 'text-red-600' : ''}`}>{v < 0 ? '−' : ''}{formatNaira(Math.abs(v))}</span></div>
}
