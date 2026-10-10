import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Circle, Clock, Lock, MessageCircle, UserPlus } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { post, useCoopAction, useCoopStatus, useLoan, usePool, type LoanDetail } from '../api'
import { Bar, BigButton, Card, CoopPage, Field, MoneyInput, Pill, SectionTitle, Sheet, Skel, dShort, loanTone, pctText, toKobo, useCountdown } from '../ui'
import { ReliabilityBadge, SafetyNote } from '../parts'

const STEP_LABEL: Record<string, string> = { requested: 'Requested', guaranteed: 'Guaranteed', approved: 'Approved', repaid: 'Repaid' }
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
            <p className="mt-1 text-[11px] font-bold text-green-800 dark:text-night-100">{STEP_LABEL[s.key]}</p>
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
        <div className="mt-4"><BigButton onClick={onRepay}>Make a repayment</BigButton></div>
        <p className="mt-2 text-center text-[11px] text-green-600 dark:text-night-300">Payments go to charges and interest first, then the loan. Part payments are fine. Guarantees stay locked until you finish.</p>
      </Card>
      <SectionTitle>Schedule</SectionTitle>
      <div className="space-y-2">{l.schedule.map((r) => (
        <Card key={r.n}><div className="flex items-center justify-between"><div><p className="text-sm font-bold text-green-900 dark:text-white">Instalment {r.n}</p><p className="text-xs text-green-600 dark:text-night-300">Due {dShort(r.due_date)}</p></div>
          <div className="text-right"><p className="font-bold text-green-900 dark:text-white">{formatNaira(r.amount_kobo)}</p><Pill tone={r.state === 'paid' ? 'green' : r.state === 'late' ? 'red' : 'grey'}>{r.state === 'paid' ? 'Paid' : r.state === 'late' ? 'Late' : 'Upcoming'}</Pill></div></div></Card>))}</div>
      <p className="mt-2 flex gap-1.5 text-[11px] text-green-600 dark:text-night-300"><Lock className="h-3 w-3 flex-shrink-0" />The daily overdue charge starts only on the first day after the loan term ends, as agreed by the directors. A late instalment before that is shown as Late but is not charged.</p>
    </>
  )
}

function RepaySheet({ open, onClose, loan }: { open: boolean; onClose: () => void; loan: LoanDetail }) {
  const [v, setV] = useState('')
  const m = useCoopAction((k: number) => post(`/coop/loans/${loan.id}/repay`, { amount_kobo: k }), {
    onSuccess: (r) => { setV(''); onClose(); if (r.repaid) window.setTimeout(() => window.alert('Loan fully repaid!'), 50) }, success: 'Repayment recorded (test money)',
  })
  const k = toKobo(v)
  const next = loan.next_instalment ? loan.next_instalment.amount_kobo - loan.next_instalment.paid_kobo : 0
  return (
    <Sheet open={open} onClose={onClose} title="Make a repayment">
      <Field label="Amount" hint={`You can pay any amount up to ${formatNaira(loan.total_due_kobo)}.`}><MoneyInput value={v} onChange={setV} autoFocus /></Field>
      <div className="mt-2 flex gap-2">
        {next > 0 && <button onClick={() => setV(String(Math.ceil(next / 100)))} className="flex-1 rounded-full border border-green-200 py-1.5 text-xs font-bold text-green-800 dark:border-night-400 dark:text-night-100">Next instalment</button>}
        <button onClick={() => setV(String(Math.ceil(loan.total_due_kobo / 100)))} className="flex-1 rounded-full border border-green-200 py-1.5 text-xs font-bold text-green-800 dark:border-night-400 dark:text-night-100">Pay everything</button></div>
      <div className="mt-4"><BigButton loading={m.isPending} disabled={k <= 0 || k > loan.total_due_kobo} onClick={() => m.mutate(k)}>Pay {k > 0 ? formatNaira(k) : ''}</BigButton></div>
    </Sheet>
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
