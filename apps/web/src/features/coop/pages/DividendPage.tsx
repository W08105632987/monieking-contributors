import { useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, Info, Lock, Sparkles, XCircle } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { useDividend } from '../api'
import { Bar, Card, CoopPage, Field, MoneyInput, SectionTitle, Skel, Stat, dShort, toKobo } from '../ui'

export default function DividendPage() {
  const [extra, setExtra] = useState('')
  const [debounced, setDebounced] = useState(0)
  useEffect(() => { const t = setTimeout(() => setDebounced(toKobo(extra)), 350); return () => clearTimeout(t) }, [extra])
  const { data: d } = useDividend(debounced)
  const me = d?.me
  return (
    <CoopPage title="Dividend" subtitle="Your share of the year's profit" back="/coop">
      {!d || !me ? <div className="space-y-3"><Skel h="h-40" /><Skel /></div> : (
        <>
          <div className="rounded-3xl bg-hero-gradient p-5 text-white dark:bg-night-gradient">
            <p className="text-xs font-semibold uppercase tracking-widest text-green-300">Estimated for {d.year}</p>
            <p className="mt-1 text-4xl font-extrabold">{formatNaira(me.total_kobo)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-green-200"><CalendarClock className="h-4 w-4" />Year ends {dShort(d.year_end)} · {d.days_left} days left</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-green-300">As contributor</p><p className="font-bold">{formatNaira(me.contribution_share_kobo)}</p></div>
              <div><p className="text-green-300">As guarantor</p><p className="font-bold">{formatNaira(me.guarantee_share_kobo)}</p></div>
            </div>
          </div>

          <Card className={`mt-3 ${me.qualifies ? '' : 'border-amber-300 bg-amber-50 dark:bg-amber-500/10'}`}>
            <div className="flex items-start gap-3">
              {me.qualifies ? <CheckCircle2 className="h-6 w-6 text-green-600" /> : <XCircle className="h-6 w-6 text-amber-600" />}
              <div><p className="font-bold text-green-900 dark:text-white">{me.qualifies ? 'You qualify so far' : 'You do not qualify yet'}</p>
                <p className="text-sm text-green-700 dark:text-night-200">{me.qualifies ? 'Keep your balance and stay a member to the year end.' : me.reason}</p></div>
            </div>
          </Card>

          <SectionTitle>What if I add more?</SectionTitle>
          <Card>
            <Field label="Add this much now and keep it in until year end" hint="A guess based on today's balances. Not a promise.">
              <MoneyInput value={extra} onChange={setExtra} />
            </Field>
            {me.with_extra && (
              <div className="mt-3 rounded-xl bg-green-100/70 p-3 dark:bg-night-600">
                <p className="text-sm text-green-800 dark:text-night-100">Your estimate would become</p>
                <p className="text-2xl font-extrabold text-green-900 dark:text-white">{formatNaira(me.with_extra.total_kobo)}</p>
                <p className="text-sm font-bold text-green-700 dark:text-green-300">{me.with_extra.gain_kobo >= 0 ? '+' : '−'}{formatNaira(Math.abs(me.with_extra.gain_kobo))} more than now</p>
                {!me.with_extra.qualifies && <p className="mt-1 text-xs text-amber-700">You must qualify first for this to count.</p>}
              </div>
            )}
          </Card>

          <SectionTitle>How your share is worked out</SectionTitle>
          <Card className="space-y-3">
            <div><div className="mb-1 flex justify-between text-sm"><span className="font-semibold text-green-800 dark:text-night-100">Your part of the contributors' pool</span><b>{me.contribution_weight_pct}%</b></div><Bar value={me.contribution_weight_pct} /></div>
            <div><div className="mb-1 flex justify-between text-sm"><span className="font-semibold text-green-800 dark:text-night-100">Your part of the guarantors' pool</span><b>{me.guarantee_weight_pct}%</b></div><Bar value={me.guarantee_weight_pct} tone="amber" /></div>
            <p className="flex gap-2 text-xs text-green-700 dark:text-night-200"><Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />More money held for longer earns a bigger share. Money added late in the year counts for fewer days.</p>
          </Card>
          <Card className="mt-3"><div className="grid grid-cols-2 gap-3">
            <Stat label={`Contributors ${d.contribution_pct}%`} value={formatNaira(d.contribution_pool_kobo)} />
            <Stat label={`Guarantors ${d.guarantee_pct}%`} value={formatNaira(d.guarantee_pool_kobo)} />
            <Stat label="Pool so far" value={formatNaira(d.pool_kobo)} /><Stat label="Qualified members" value={d.qualified_members} />
          </div></Card>
          <div className="mt-3 space-y-2 pb-2 text-xs text-green-700 dark:text-night-200">
            <p className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{d.basis}</p>
            <p className="flex gap-2"><Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{d.pool_note}</p>
          </div>
        </>
      )}
    </CoopPage>
  )
}
