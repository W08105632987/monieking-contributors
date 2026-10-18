import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Banknote, CheckCircle2, Circle, Clock, Landmark, Lock, MessageCircle, UserPlus } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { post, postIdem, useCoopAction, useCoopStatus, useLoan, usePool, type LoanDetail } from '../api'
import { newKey, useAuthPrompt } from '../auth'
import { Bar, BigButton, Card, CoopPage, Field, MoneyInput, Pill, SectionTitle, Sheet, Skel, dShort, loanTone, pctText, toKobo, useCountdown } from '../ui'
import { ReliabilityBadge, SafetyNote } from '../parts'

const STEP_LABEL: Record<string, string> = { requested: 'Requested', guaranteed: 'Guaranteed', approved: 'Approved', accepted: 'Accepted', paid_out: 'Paid out', repaid: 'Repaid' }
const G_TONE: Record<string, any> = { signed: 'green', invited: 'amber', viewed: 'blue', declined: 'red', expired: 'grey', cancelled: 'grey', released: 'grey' }
const G_LABEL: Record<string, string> = { signed: 'Signed', invited: 'Invited', viewed: 'Opened', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled', released: 'Released' }

export default function LoanDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data: l } = useLoan(id)
  const left = useCountdown(l?.expires_at)
  const [picker, setPicker] = useState(false)
  const [repay, setRepay] = useState(false)
  const cancel = useCoopAction(() => post(`/coop/loans/${id}/cancel`), { success: 'Request cancelled. Any locked guarantee money was released.' })
  if (!l) return <CoopPage title="Loan" back="/coop/loans"><Skel h="h-40" /></CoopPage>
  const t = loanTone(l.status)
  const seeking = l.status === 'seeking_guarantors'
  const open = ['seeking_guarantors', 'awaiting_approval'].includes(l.status)

  return (
    <CoopPage title={l.loan_no} subtitle={l.purpose ?? undefined} back="/coop/loans" right={<Pill tone={t.tone}>{t.label}</Pill>}>
      <div className="rounded-3xl bg-hero-gradient p-5 text-white dark:bg-night-gradient">
        <p className="text-xs font-semibold uppercase tracking-widest text-green-300">Loan amount</p>
        <p className="text-4xl font-extrabold">{formatNaira(l.principal_kobo)}</p>
        <p className="mt-1 text-sm text-green-200">{l.term_months} month{l.term_months > 1 ? 's' : ''} · interest {formatNaira(l.interest_kobo)} ({pctText(l.rate_bps)}) · total {formatNaira(l.total_kobo)}</p>
      </div>

      <Card className="mt-3"><div className="flex items-center">
        {l.steps.map((s, i) => (
          <div key={s.key} className="flex flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center"><div className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : s.done ? 'bg-green-500' : 'bg-green-100 dark:bg-night-500'}`} />
              {s.done ? <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-green-500" /> : <Circle className="h-6 w-6 flex-shrink-0 text-green-200 dark:text-night-400" />}
              <div className={`h-0.5 flex-1 ${i === l.steps.length - 1 ? 'opacity-0' : l.steps[i + 1]?.done ? 'bg-green-500' : 'bg-green-100 dark:bg-night-500'}`} /></div>
            <p className="mt-1 text-[10px] font-bold text-green-800 dark:text-night-100">{STEP_LABEL[s.key]}</p>
          </div>))}
      </div></Card>

      {l.decision_note && !open && <Card className="mt-3"><p className="text-sm text-green-800 dark:text-night-100">{l.decision_note}</p></Card>}

      {seeking && (
        <>
          <SectionTitle right={<span className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300"><Clock className="h-3.5 w-3.5" />{left}</span>}>Guarantors</SectionTitle>
          <Card>
            <div className="flex justify-between text-sm"><span className="font-bold text-green-900 dark:text-white">{formatNaira(l.guaranteed_kobo)} guaranteed</span><span className="text-green-700 dark:text-night-200">of {formatNaira(l.cover_needed_kobo)}</span></div>
            <div className="mt-2"><Bar value={l.guaranteed_kobo} max={l.cover_needed_kobo} tone="amber" /></div>
            {l.still_needed_kobo > 0 && <p className="mt-2 text-xs text-green-700 dark:text-night-200">{formatNaira(l.still_needed_kobo)} still needed. Your own contribution does not count.</p>}
          </Card>
        </>
      )}
      {!seeking && l.guarantors.length > 0 && <SectionTitle>Guarantors</SectionTitle>}
      <div className="mt-2 space-y-2">
        {l.guarantors.map((g) => (
          <Card key={g.guarantee_id} onClick={() => nav(`/coop/members/${g.member_id}`)}>
            <div className="flex items-center justify-between"><div><p className="font-bold text-green-900 dark:text-white">{g.name}</p><p className="text-sm text-green-700 dark:text-night-200">{formatNaira(g.amount_kobo)}</p></div>
              <Pill tone={G_TONE[g.status]}>{G_LABEL[g.status]}</Pill></div>
          </Card>))}
      </div>
      {seeking && <div className="mt-3"><BigButton tone="amber" onClick={() => setPicker(true)} disabled={l.still_needed_kobo - l.pending_kobo <= 0}><UserPlus className="h-4 w-4" />Invite a guarantor</BigButton>
        {l.still_needed_kobo - l.pending_kobo <= 0 && l.still_needed_kobo > 0 && <p className="mt-1 text-center text-xs text-green-700 dark:text-night-200">Waiting for the people you invited.</p>}</div>}
      {l.status === 'awaiting_approval' && <SafetyNote>Fully guaranteed. Two directors must now approve. The Board may still decline a fully guaranteed loan.</SafetyNote>}

      {l.status === 'awaiting_acceptance' && l.offer && <OfferCard l={l} />}
      {l.status === 'awaiting_payout' && <PayoutCard l={l} />}
      {l.status === 'awaiting_final_release' && <Card className="mt-3"><p className="font-extrabold text-green-900 dark:text-white">Final repayment is being confirmed</p><p className="mt-1 text-sm text-green-700 dark:text-night-200">You have paid everything. The directors are confirming it, and then your guarantors' money is released.</p></Card>}
      {l.status === 'written_off' && <Card className="mt-3 border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10"><p className="font-extrabold text-red-800 dark:text-red-200">Written off by the Board</p><p className="mt-1 text-sm text-red-800 dark:text-red-200">{formatNaira(l.written_off_kobo ?? 0)} was written off. A recovery process may continue. You cannot take a new loan until this is settled.</p></Card>}
      {l.status === 'repaying' && <Repaying l={l} onRepay={() => setRepay(true)} />}
      {l.status === 'repaid' && <Card className="mt-3 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-green-500" /><p className="mt-1 font-extrabold text-green-900 dark:text-white">Fully repaid</p><p className="text-sm text-green-700 dark:text-night-200">Your guarantors' money has been released. Well done.</p></Card>}

      {open && <div className="mt-6"><BigButton tone="ghost" loading={cancel.isPending} onClick={() => { if (window.confirm('Cancel this request? Any guarantee money already locked is released.')) cancel.mutate(undefined) }}>Cancel this request</BigButton></div>}

      <GuarantorPicker open={picker} onClose={() => setPicker(false)} loan={l} />
      <RepaySheet open={repay} onClose={() => setRepay(false)} loan={l} />
    </CoopPage>
  )
}

function Repaying({ l, onRepay }: { l: LoanDetail; onRepay: () => void }) {
  const paid = l.principal_paid_kobo + l.interest_paid_kobo
  return (
    <>
      {l.overdue_days > 0 && (
        <Card className="mt-3 border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10">
          <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
            <div className="text-sm text-red-800 dark:text-red-200"><p className="font-extrabold">Overdue by {l.overdue_days} day{l.overdue_days > 1 ? 's' : ''}</p>
              <p>An overdue charge of {pctText(l.overdue_daily_bps)} of the original interest is added each day. Charge so far: <b>{formatNaira(l.accrued_charge_kobo)}</b>.</p></div></div>
        </Card>)}
      <SectionTitle>Repayment</SectionTitle>
      <Card>
        <div className="flex items-end justify-between"><div><p className="text-xs font-semibold uppercase text-green-500 dark:text-night-300">Still to pay</p><p className="text-3xl font-extrabold text-green-900 dark:text-white">{formatNaira(l.total_due_kobo)}</p></div>
          {l.next_instalment && <p className="text-right text-xs text-green-700 dark:text-night-200">Next: {formatNaira(l.next_instalment.amount_kobo - l.next_instalment.paid_kobo)}<br />{dShort(l.next_instalment.due_date)}</p>}</div>
        <div className="mt-3"><Bar value={paid} max={l.principal_kobo + l.interest_kobo} /></div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div><p className="text-green-500">Principal left</p><b>{formatNaira(l.principal_due_kobo)}</b></div><div><p className="text-green-500">Interest left</p><b>{formatNaira(l.interest_due_kobo)}</b></div><div><p className="text-green-500">Charges due</p><b>{formatNaira(l.charges_due_kobo)}</b></div></div>
        {(l.due_now_kobo ?? 0) > 0 && <p className="mt-3 rounded-xl bg-amber-50 p-2 text-center text-xs font-bold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Due now: {formatNaira(l.due_now_kobo ?? 0)}</p>}
        {(l.waived_kobo ?? 0) > 0 && <p className="mt-2 text-center text-xs text-green-700 dark:text-night-200">The Board waived {formatNaira(l.waived_kobo ?? 0)} of overdue charges.</p>}
        {!!l.restructured && <p className="mt-2 text-center text-xs text-green-700 dark:text-night-200">This loan was restructured with your agreement.</p>}
        <div className="mt-4"><BigButton onClick={onRepay}>Make a repayment</BigButton></div>
        <p className="mt-2 text-center text-[11px] text-green-600 dark:text-night-300">Payments go to charges and interest first, then the loan. Part payments are fine. Guarantees stay locked until you finish.</p>
      </Card>
      {l.interest_breakdown && <Breakdown b={l.interest_breakdown} />}
      <SectionTitle>Schedule</SectionTitle>
      <div className="space-y-2">{l.schedule.map((r) => (
        <Card key={r.n}><div className="flex items-center justify-between"><div><p className="text-sm font-bold text-green-900 dark:text-white">Instalment {r.n}</p><p className="text-xs text-green-600 dark:text-night-300">Due {dShort(r.due_date)}</p></div>
          <div className="text-right"><p className="font-bold text-green-900 dark:text-white">{formatNaira(r.amount_kobo)}</p><Pill tone={r.state === 'paid' ? 'green' : r.state === 'late' ? 'red' : 'grey'}>{r.state === 'paid' ? 'Paid' : r.state === 'late' ? 'Late' : 'Upcoming'}</Pill></div></div></Card>))}</div>
      <p className="mt-2 flex gap-1.5 text-[11px] text-green-600 dark:text-night-300"><Lock className="h-3 w-3 flex-shrink-0" />The daily overdue charge starts only on the first day after the loan term ends, as agreed by the directors. A late instalment before that is shown as Late but is not charged.</p>
    </>
  )
}

function RepaySheet({ open, onClose, loan }: { open: boolean; onClose: () => void; loan: LoanDetail }) {
  const { data: st } = useCoopStatus()
  const [v, setV] = useState('')
  const sources = loan.allowed_sources?.length ? loan.allowed_sources : ['contribution']
  const [src, setSrc] = useState<string>(sources[0])
  const stepUp = !!st?.rules?.step_up_required && st.rules.step_up_required !== 'off'
  const { ask, sheet } = useAuthPrompt()
  const m = useCoopAction(async (k: number) => {
    const auth = await ask(stepUp)
    if (auth === null) throw new Error('Cancelled')
    return postIdem(`/coop/loans/${loan.id}/repay`, { amount_kobo: k, source: src, ...(auth ? { auth } : {}) }, newKey())
  }, {
    onSuccess: (r) => { setV(''); onClose(); if (r.repaid) window.setTimeout(() => window.alert('Loan fully repaid!'), 50) }, success: st?.test_mode === false ? 'Repayment recorded' : 'Repayment recorded (test money)',
  })
  const k = toKobo(v)
  const next = loan.next_instalment ? loan.next_instalment.amount_kobo - loan.next_instalment.paid_kobo : 0
  return (
    <Sheet open={open} onClose={onClose} title="Make a repayment">
      {sheet}
      {sources.length > 1 && (
        <div className="mb-3 grid grid-cols-2 gap-2">{sources.map((x) => <button key={x} onClick={() => setSrc(x)} className={`rounded-xl border px-3 py-2 text-sm font-bold ${src === x ? 'border-green-600 bg-green-100 text-green-900 dark:bg-night-600 dark:text-white' : 'border-green-200 text-green-800 dark:border-night-400 dark:text-night-100'}`}>{x === 'contribution' ? 'From my contribution' : 'From my wallet'}</button>)}</div>)}
      {sources.length === 1 && <p className="mb-3 text-xs text-green-700 dark:text-night-200">{sources[0] === 'contribution' ? 'This is paid from your contribution balance.' : 'This is paid from your MonieKing wallet.'}</p>}
      <Field label="Amount" hint={`You can pay any amount up to ${formatNaira(loan.total_due_kobo)}.`}><MoneyInput value={v} onChange={setV} autoFocus /></Field>
      <div className="mt-2 flex gap-2">
        {next > 0 && <button onClick={() => setV(String(Math.ceil(next / 100)))} className="flex-1 rounded-full border border-green-200 py-1.5 text-xs font-bold text-green-800 dark:border-night-400 dark:text-night-100">Next instalment</button>}
        <button onClick={() => setV(String(Math.ceil(loan.total_due_kobo / 100)))} className="flex-1 rounded-full border border-green-200 py-1.5 text-xs font-bold text-green-800 dark:border-night-400 dark:text-night-100">Pay everything</button></div>
      <div className="mt-4"><BigButton loading={m.isPending} disabled={k <= 0 || k > loan.total_due_kobo} onClick={() => m.mutate(k)}>Pay {k > 0 ? formatNaira(k) : ''}</BigButton></div>
    </Sheet>
  )
}

function OfferCard({ l }: { l: LoanDetail }) {
  const o = l.offer!
  const left = useCountdown(o.expires_at)
  const { data: st } = useCoopStatus()
  const accept = useCoopAction(() => postIdem(`/coop/loans/${l.id}/accept`, {}, newKey()), { success: 'Offer accepted' })
  const decline = useCoopAction(() => post(`/coop/loans/${l.id}/decline-offer`), { success: 'Offer declined. Your guarantors were released.' })
  const feePct = st?.rules?.transfer_fee_bps ? pctText(st.rules.transfer_fee_bps) : ''
  return (
    <Card className="mt-3 border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex items-center justify-between"><p className="flex items-center gap-1.5 font-extrabold text-green-900 dark:text-white"><Banknote className="h-5 w-5" />Your loan is approved</p>{o.expires_at && <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">{left}</span>}</div>
      <div className="mt-3 space-y-1 text-sm text-green-900 dark:text-night-100">
        <p className="flex justify-between"><span>Loan amount</span><b>{formatNaira(o.principal_kobo)}</b></p>
        <p className="flex justify-between"><span>Transfer fee {feePct && `(${feePct})`}</span><b>− {formatNaira(o.fee_kobo)}</b></p>
        <p className="flex justify-between border-t border-amber-200 pt-1 text-base"><span className="font-bold">You will receive</span><b>{formatNaira(o.net_payout_kobo)}</b></p>
        <p className="flex justify-between pt-1 text-xs text-green-700 dark:text-night-200"><span>You will repay</span><span>{formatNaira(o.total_repay_kobo)} over {o.term_months} month{o.term_months > 1 ? 's' : ''}</span></p>
      </div>
      <p className="mt-2 text-[11px] text-green-700 dark:text-night-200">The fee covers the cost of sending the money. You repay the full loan amount plus interest, not only what you receive.</p>
      <div className="mt-3 grid grid-cols-2 gap-2"><BigButton loading={accept.isPending} onClick={() => accept.mutate(undefined)}>Accept</BigButton>
        <BigButton tone="ghost" loading={decline.isPending} onClick={() => { if (window.confirm('Decline this loan? Your guarantors are released.')) decline.mutate(undefined) }}>Decline</BigButton></div>
    </Card>
  )
}

function PayoutCard({ l }: { l: LoanDetail }) {
  const nav = useNavigate()
  const p = l.payout
  const held = p?.status === 'held'
  return (
    <Card className="mt-3">
      <p className="flex items-center gap-1.5 font-extrabold text-green-900 dark:text-white"><Landmark className="h-5 w-5" />{held ? 'Payout on hold' : 'Waiting for your payout'}</p>
      {held ? <p className="mt-1 text-sm text-red-700 dark:text-red-300">{p?.hold_reason}</p> : <p className="mt-1 text-sm text-green-700 dark:text-night-200">You accepted. A director is sending the money to your bank account. Your repayment period starts when it is sent.</p>}
      {p?.account && <p className="mt-2 text-xs text-green-700 dark:text-night-200">To: {p.account.account_name} · {p.account.bank_name} · {p.account.account_number}</p>}
      {(!p?.bank_on_file || held) && <div className="mt-3"><BigButton tone="amber" onClick={() => nav('/coop/bank')}>{p?.bank_on_file ? 'Check my bank details' : 'Add my bank details'}</BigButton></div>}
    </Card>
  )
}

function Breakdown({ b }: { b: NonNullable<LoanDetail['interest_breakdown']> }) {
  return (
    <>
      <SectionTitle>Where your interest goes</SectionTitle>
      <Card className="space-y-1 text-sm text-green-800 dark:text-night-100">
        <p className="flex justify-between"><span>Interest on this loan</span><b>{formatNaira(b.interest_total_kobo)}</b></p>
        <p className="flex justify-between"><span>Paid so far</span><b>{formatNaira(b.interest_paid_kobo)}</b></p>
        <p className="flex justify-between text-xs"><span>Running costs ({b.running_cost_pct}%)</span><span>{formatNaira(b.running_cost_kobo)}</span></p>
        <p className="flex justify-between text-xs"><span>To the dividend pool</span><span>{formatNaira(b.to_dividend_pool_kobo)}</span></p>
        <p className="flex justify-between pl-3 text-xs"><span>contributors ({b.contribution_pct}%)</span><span>{formatNaira(b.contribution_share_kobo)}</span></p>
        <p className="flex justify-between pl-3 text-xs"><span>guarantors ({b.guarantee_pct}%)</span><span>{formatNaira(b.guarantee_share_kobo)}</span></p>
      </Card>
    </>
  )
}

function GuarantorPicker({ open, onClose, loan }: { open: boolean; onClose: () => void; loan: LoanDetail }) {
  const nav = useNavigate()
  const { data: s } = useCoopStatus()
  const { data: pool, isLoading } = usePool()
  const [sel, setSel] = useState<string | null>(null)
  const [amt, setAmt] = useState('')
  const invite = useCoopAction((v: { guarantor_member_id: string; amount_kobo: number }) => post(`/coop/loans/${loan.id}/invites`, v), {
    success: 'Invitation sent', onSuccess: () => { setSel(null); setAmt(''); onClose() },
  })
  const open_ = Math.max(loan.still_needed_kobo - loan.pending_kobo, 0)
  const live = new Set(loan.guarantors.filter((g) => ['invited', 'viewed', 'signed'].includes(g.status)).map((g) => g.member_id))
  const chosen = pool?.find((p) => p.member_id === sel)
  const minCommit = s?.rules ? Math.max(s.rules.guarantee_min_kobo, Math.ceil((loan.principal_kobo * s.rules.guarantee_min_commit_pct) / 100)) : 0
  const suggested = chosen ? Math.min(chosen.available_kobo, open_) : 0
  return (
    <Sheet open={open} onClose={() => { setSel(null); onClose() }} title={sel ? 'How much should they guarantee?' : 'Choose a guarantor'}>
      {!sel ? (
        isLoading ? <Skel /> : !pool?.length ? <p className="text-sm text-green-700 dark:text-night-200">Nobody is in the guarantors' pool yet.</p> : (
          <div className="space-y-2">{pool.filter((p) => !live.has(p.member_id)).map((p) => (
            <button key={p.member_id} onClick={() => { setSel(p.member_id); setAmt(String(Math.max(Math.min(p.available_kobo, open_), 0) / 100)) }}
              className="w-full rounded-2xl border border-green-100 p-3 text-left dark:border-night-500">
              <div className="flex items-center justify-between"><p className="font-bold text-green-900 dark:text-white">{p.name}</p><b className="text-green-700 dark:text-green-300">{formatNaira(p.available_kobo)}</b></div>
              <div className="mt-1 flex flex-wrap gap-1.5"><ReliabilityBadge pct={p.reliability_pct} has={p.has_history} /><Pill>{p.guarantees_total} guaranteed</Pill></div>
            </button>))}</div>)
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100">{chosen?.name} offers up to {formatNaira(chosen?.offer_kobo ?? 0)}. Needed: at least {formatNaira(Math.min(minCommit, open_))}, at most {formatNaira(open_)}.</p>
          <Field label="Amount"><MoneyInput value={amt} onChange={setAmt} autoFocus /></Field>
          <div className="flex gap-2">
            <button onClick={() => setAmt(String(suggested / 100))} className="flex-1 rounded-full border border-green-200 py-1.5 text-xs font-bold text-green-800 dark:border-night-400 dark:text-night-100">Most they can give</button>
            {chosen?.whatsapp_link && <a href={chosen.whatsapp_link} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1 rounded-full bg-green-600 py-1.5 text-xs font-bold text-white"><MessageCircle className="h-3.5 w-3.5" />Talk on WhatsApp</a>}</div>
          <p className="text-xs text-green-600 dark:text-night-300">Agree the amount with them first. They then have {s?.rules?.invite_expiry_hours} hours to read the agreement and sign.</p>
          <BigButton loading={invite.isPending} disabled={toKobo(amt) <= 0} onClick={() => invite.mutate({ guarantor_member_id: sel, amount_kobo: toKobo(amt) })}>Send invitation</BigButton>
          <BigButton tone="ghost" onClick={() => nav(`/coop/members/${sel}`)}>See their full profile</BigButton>
          <button onClick={() => setSel(null)} className="w-full text-center text-sm font-bold text-green-700 dark:text-night-200">Choose someone else</button>
        </div>)}
    </Sheet>
  )
}
