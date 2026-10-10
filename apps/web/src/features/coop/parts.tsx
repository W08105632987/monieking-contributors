import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ShieldCheck, Star } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { BigButton, Field, MoneyInput, Pill, Sheet, toKobo, pctText } from './ui'
import { post, useCoopAction, type MemberSummary, type PublicRules } from './api'
import { api } from '@/lib/api'

export function ReliabilityBadge({ pct, has }: { pct: number | null; has: boolean }) {
  if (!has || pct === null) return <Pill tone="grey">No loan history yet</Pill>
  const tone = pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red'
  return <Pill tone={tone}><Star className="h-3 w-3" />{pct}% on time</Pill>
}

export function TopUpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [v, setV] = useState('')
  const m = useCoopAction((k: number) => post('/coop/contributions', { amount_kobo: k }), {
    success: 'Test contribution added', onSuccess: () => { setV(''); onClose() },
  })
  return (
    <Sheet open={open} onClose={onClose} title="Add test contribution">
      <p className="mb-3 text-sm text-green-700 dark:text-night-200">This adds test money to your cooperative balance. No real wallet is used in the preview.</p>
      <Field label="Amount"><MoneyInput value={v} onChange={setV} autoFocus /></Field>
      <div className="mt-2 flex gap-2">
        {[5_000, 20_000, 100_000].map((n) => (
          <button key={n} onClick={() => setV(String(n))} className="flex-1 rounded-full border border-green-200 py-1.5 text-xs font-bold text-green-800 dark:border-night-400 dark:text-night-100">+₦{n.toLocaleString()}</button>
        ))}
      </div>
      <div className="mt-4"><BigButton loading={m.isPending} disabled={toKobo(v) <= 0} onClick={() => m.mutate(toKobo(v))}>Add contribution</BigButton></div>
    </Sheet>
  )
}

export function WithdrawSheet({ open, onClose, member, rules }: { open: boolean; onClose: () => void; member: MemberSummary; rules: PublicRules }) {
  const [v, setV] = useState('')
  const [preview, setPreview] = useState<{ charge_kobo: number; you_receive_kobo: number; loses_dividend: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const reset = () => { setPreview(null); setErr('') }
  const check = async () => {
    setBusy(true); setErr('')
    try { setPreview((await api.post('/coop/withdrawals', { amount_kobo: toKobo(v) })).data) }
    catch (e: any) { setErr(e?.response?.data?.detail ?? 'Could not check that amount') }
    finally { setBusy(false) }
  }
  const run = useCoopAction(() => post('/coop/withdrawals', { amount_kobo: toKobo(v), confirm: true }), {
    success: 'Withdrawal recorded (test money)', onSuccess: () => { setV(''); reset(); onClose() },
  })
  return (
    <Sheet open={open} onClose={() => { reset(); onClose() }} title="Withdraw contribution">
      <p className="mb-3 text-sm text-green-700 dark:text-night-200">You can withdraw only money that is not locked behind a guarantee. You have <b>{formatNaira(member.free_kobo)}</b> free.</p>
      <Field label="Amount"><MoneyInput value={v} onChange={(x) => { setV(x); reset() }} /></Field>
      {err && <p className="mt-2 text-sm font-semibold text-red-600">{err}</p>}
      {!preview ? (
        <div className="mt-4"><BigButton tone="ghost" loading={busy} disabled={toKobo(v) <= 0} onClick={check}>See what this costs</BigButton></div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <p>Early withdrawal charge ({pctText(rules.early_withdrawal_bps)}): <b>{formatNaira(preview.charge_kobo)}</b>, which goes to the dividend pool.</p>
            <p className="mt-1">You receive: <b>{formatNaira(preview.you_receive_kobo)}</b></p>
            {preview.loses_dividend && <p className="mt-2 font-bold">You will not share this year's dividend if you withdraw.</p>}
          </div>
          <BigButton tone="red" loading={run.isPending} onClick={() => run.mutate(undefined as never)}>Confirm withdrawal</BigButton>
        </div>
      )}
    </Sheet>
  )
}

export function MemberRow({ to, name, sub, right }: { to: string; name: string; sub: string; right?: React.ReactNode }) {
  const nav = useNavigate()
  return (
    <button onClick={() => nav(to)} className="flex w-full items-center gap-3 rounded-2xl border border-green-100 bg-white p-3 text-left shadow-card dark:border-night-500 dark:bg-night-700">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-extrabold text-green-800 dark:bg-night-600 dark:text-night-100">
        {name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-green-900 dark:text-white">{name}</p>
        <p className="truncate text-xs text-green-600 dark:text-night-200">{sub}</p>
      </div>
      {right ?? <ChevronRight className="h-4 w-4 text-green-300 dark:text-night-400" />}
    </button>
  )
}

export function SafetyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-xl bg-green-100/70 p-3 text-xs text-green-800 dark:bg-night-600 dark:text-night-100">
      <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" /><div>{children}</div>
    </div>
  )
}
