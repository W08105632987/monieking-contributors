import { Avatar } from '@/components/ui/Avatar'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ShieldCheck, Star } from 'lucide-react'
import { formatNaira, formatNairaAmount } from '@/lib/utils'
import { BigButton, Field, MoneyInput, Pill, Sheet, toKobo, pctText } from './ui'
import { postIdem, useCoopAction, useCoopStatus, type MemberSummary, type PublicRules } from './api'
import { newKey, useAuthPrompt } from './auth'
import { api } from '@/lib/api'
import { friendlyError } from '@/lib/errorText'

export function ReliabilityBadge({ pct, has }: { pct: number | null; has: boolean }) {
  if (!has || pct === null) return <Pill tone="grey">No loan history yet</Pill>
  const tone = pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red'
  return <Pill tone={tone}><Star className="h-3 w-3" />{pct}% on time</Pill>
}

export function TopUpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [v, setV] = useState('')
  const { data: st } = useCoopStatus()
  const live = st?.test_mode === false
  const stepUp = st?.rules?.step_up_required && st.rules.step_up_required !== 'off'
  const { ask, sheet } = useAuthPrompt()
  const m = useCoopAction(async (k: number) => {
    const auth = await ask(!!stepUp)
    if (auth === null) throw new Error('Cancelled')
    return postIdem('/coop/contributions', { amount_kobo: k, ...(auth ? { auth } : {}) }, newKey())
  }, {
    success: live ? 'Contribution added' : 'Test contribution added', onSuccess: () => { setV(''); onClose() },
  })
  return (
    <Sheet open={open} onClose={onClose} title={live ? 'Add to my contribution' : 'Add test contribution'}>
      {sheet}
      <p className="mb-3 text-sm text-green-700 dark:text-night-200">{live ? 'This moves money from your MonieKing wallet into your cooperative contribution.' : 'This adds test money to your cooperative balance. No real wallet is used in the preview.'}</p>
      <Field label="Amount"><MoneyInput value={v} onChange={setV} autoFocus /></Field>
      <div className="mt-2 flex gap-2">
        {[5_000, 20_000, 100_000].map((n) => (
          <button key={n} onClick={() => setV(String(n))} className="flex-1 rounded-full border border-green-200 py-1.5 text-xs font-bold text-green-800 dark:border-night-400 dark:text-night-100">+{formatNairaAmount(n)}</button>
        ))}
      </div>
      <div className="mt-4"><BigButton loading={m.isPending} disabled={toKobo(v) <= 0} onClick={() => m.mutate(toKobo(v))}>Add contribution</BigButton></div>
    </Sheet>
  )
}

type WdPreview = { charge_kobo: number; you_receive_kobo: number; loses_dividend: boolean; mode: 'director_payout' | 'instant'; needs_bank: boolean
  account: { bank_name: string | null; account_number: string; account_name: string } | null }

export function WithdrawSheet({ open, onClose, member, rules }: { open: boolean; onClose: () => void; member: MemberSummary; rules: PublicRules }) {
  const nav = useNavigate()
  const [v, setV] = useState('')
  const [preview, setPreview] = useState<WdPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)
  const reset = () => { setPreview(null); setErr(''); setSent(false) }
  const check = async () => {
    setBusy(true); setErr('')
    try { setPreview((await api.post('/coop/withdrawals', { amount_kobo: toKobo(v) })).data) }
    catch (e: any) { setErr(friendlyError(e, 'Could not check that amount')) }
    finally { setBusy(false) }
  }
  const { data: st } = useCoopStatus()
  const stepUp = st?.rules?.step_up_required && st.rules.step_up_required !== 'off'
  const { ask, sheet } = useAuthPrompt()
  const request = preview?.mode === 'director_payout'
  const run = useCoopAction(async () => {
    const auth = await ask(!!stepUp)
    if (auth === null) throw new Error('Cancelled')
    return postIdem('/coop/withdrawals', { amount_kobo: toKobo(v), confirm: true, ...(auth ? { auth } : {}) }, newKey())
  }, {
    success: request ? undefined : (st?.test_mode === false ? 'Withdrawal recorded' : 'Withdrawal recorded (test money)'),
    onSuccess: () => { setV(''); if (request) setSent(true); else { reset(); onClose() } },
  })
  const close = () => { reset(); onClose() }
  return (
    <Sheet open={open} onClose={close} title={sent ? 'Request sent' : 'Withdraw contribution'}>
      {sheet}
      {sent ? (
        <div className="space-y-3 text-sm text-green-900 dark:text-night-100">
          <p className="rounded-xl bg-green-100 p-3 font-semibold dark:bg-night-600">Your request is with the directors. The money is set aside for you and will show as Pending until a director sends it to your bank account and marks it paid.</p>
          <p className="text-xs text-green-700 dark:text-night-200">You will get a notification when it is paid, or if it cannot be paid (then the money goes back to your contribution).</p>
          <BigButton onClick={() => { close(); nav('/coop/withdrawals') }}>See my requests</BigButton>
          <BigButton tone="ghost" onClick={close}>Done</BigButton>
        </div>
      ) : (<>
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
          {request && preview.account && (
            <div className="rounded-xl border border-green-200 p-3 text-sm text-green-900 dark:border-night-400 dark:text-night-100">
              <p className="text-xs font-bold uppercase text-green-600 dark:text-night-300">Sent to</p>
              <p className="font-bold">{preview.account.account_name}</p>
              <p className="text-xs">{preview.account.bank_name} · {preview.account.account_number}</p>
              <p className="mt-2 text-xs text-green-700 dark:text-night-200">A director sends this by bank transfer and marks it paid. Until then it shows as Pending.</p>
            </div>)}
          {preview.needs_bank ? (
            <div className="space-y-2"><p className="text-sm font-semibold text-red-600">Add your bank account first so we know where to send the money.</p>
              <BigButton onClick={() => { close(); nav('/coop/bank') }}>Add bank account</BigButton></div>
          ) : (
            <BigButton tone="red" loading={run.isPending} onClick={() => run.mutate(undefined as never)}>{request ? 'Send withdrawal request' : 'Confirm withdrawal'}</BigButton>)}
        </div>
      )}</>)}
    </Sheet>
  )
}

export function MemberRow({ to, name, sub, right, avatarUrl }: { to: string; name: string; sub: string; right?: React.ReactNode; avatarUrl?: string | null }) {
  const nav = useNavigate()
  return (
    <button onClick={() => nav(to)} className="flex w-full items-center gap-3 rounded-2xl border border-green-100 bg-white p-3 text-left shadow-card dark:border-night-500 dark:bg-night-700">
      <Avatar name={name} avatarUrl={avatarUrl} size={40} />
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
