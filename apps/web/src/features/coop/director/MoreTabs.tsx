import { useState, type ReactNode } from 'react'
import { downloadFromApi } from '@/lib/download'
import { AlertTriangle, Check, CheckCircle2, Download, Landmark, Play, RefreshCw, ShieldCheck, X, XCircle } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api'
import toast from 'react-hot-toast'
import { post, postIdem, useCoopAction } from '../api'
import { newKey, useAuthPrompt } from '../auth'
import { Bar, BigButton, Card, Empty, Field, MoneyInput, Pill, SectionTitle, Sheet, Skel, Stat, dShort, inputCls, toKobo } from '../ui'
import { useAdmin } from './dapi'
import { WithdrawalsPanel } from './WithdrawalsPanel'
import { ChatThread } from '../chat'

const chip = (on: boolean) => `flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${on ? 'bg-green-700 text-white' : 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100'}`
const Chips = <T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) => (
  <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">{items.map(([k, l]) => <button key={k} onClick={() => onChange(k)} className={chip(value === k)}>{l}</button>)}</div>)
const Area = ({ value, onChange, rows = 3, ...r }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) => (
  <textarea className={inputCls} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} {...r} />)
const k = (v: string) => v.replace(/_/g, ' ')

/** Sends a director action; asks for the extra confirmation first when the rule is on. */
function useDirAct<V>(fn: (v: V, auth?: any) => Promise<any>, stepUp: boolean | ((v: V) => boolean), success: string, onSuccess?: (r: any) => void) {
  const { ask, sheet } = useAuthPrompt()
  const m = useCoopAction(async (v: V) => {
    const auth = await ask(typeof stepUp === 'function' ? stepUp(v) : stepUp)
    if (auth === null) throw new Error('Cancelled')
    return fn(v, auth)
  }, { success, onSuccess })
  return { m, sheet }
}

/* ═════════ Payouts (Treasurer queue) ═════════ */
export function PayoutsTab({ stepUp }: { stepUp: boolean }) {
  const [kind, setKind] = useState<'loans' | 'withdrawals'>('loans')
  const { data: wc } = useAdmin<any>('withdrawals-count', '/coop/admin/withdrawals', { status: 'pending', limit: 1 })
  const waiting = wc?.counts?.pending ?? 0
  return (
    <>
      <Chips value={kind} onChange={setKind} items={[['loans', 'Loan payouts'], ['withdrawals', waiting ? `Withdrawals (${waiting})` : 'Withdrawals']]} />
      {kind === 'loans' ? <LoanPayouts stepUp={stepUp} /> : <WithdrawalsPanel stepUp={stepUp} />}
    </>
  )
}

function LoanPayouts({ stepUp }: { stepUp: boolean }) {
  const { data } = useAdmin<any[]>('payouts', '/coop/admin/payouts')
  const [sel, setSel] = useState<any>(null)
  const [ref, setRef] = useState('')
  const [ev, setEv] = useState('')
  const [note, setNote] = useState('')
  const send = useDirAct((id: string, auth) => postIdem(`/coop/admin/loans/${id}/payout`, { reference: ref, evidence: ev, ...(auth ? { auth } : {}) }, newKey()), stepUp, 'Payout recorded. The repayment clock has started.', () => { setSel(null); setRef(''); setEv('') })
  const clear = useCoopAction((id: string) => post(`/coop/admin/loans/${id}/clear-hold`, { note }), { success: 'Hold cleared', onSuccess: () => { setSel(null); setNote('') } })
  return (
    <>
      {send.sheet}
      {!data ? <Skel h="h-40" /> : !data.length ? <Empty icon={<Landmark className="h-7 w-7" />} title="No payouts waiting" text="Approved loans appear here once the member accepts the offer." /> : (
        <div className="space-y-3">{data.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-green-500 dark:text-night-300">{p.loan_no} · {p.card_no}</p><p className="font-extrabold text-green-900 dark:text-white">{p.borrower}</p><p className="text-xs text-green-600 dark:text-night-300">{p.phone}</p></div>
              <Pill tone={p.status === 'awaiting_acceptance' ? 'blue' : p.payout_status === 'held' ? 'red' : 'amber'}>{p.status === 'awaiting_acceptance' ? 'Member has not accepted' : p.payout_status === 'held' ? 'On hold' : 'Ready to send'}</Pill></div>
            <div className="mt-3 rounded-xl bg-green-100/70 p-3 text-sm dark:bg-night-600">
              <p className="flex justify-between"><span>Loan</span><b>{formatNaira(p.principal_kobo)}</b></p>
              <p className="flex justify-between"><span>Transfer fee</span><b>− {formatNaira(p.fee_kobo ?? 0)}</b></p>
              <p className="flex justify-between border-t border-green-200 pt-1 dark:border-night-500"><span className="font-bold">Send</span><b>{formatNaira(p.net_payout_kobo ?? p.principal_kobo)}</b></p></div>
            {p.account ? <p className="mt-2 text-sm text-green-800 dark:text-night-100">{p.account.account_name} · {p.account.bank_name} · <b>{p.account.account_number}</b></p> : p.status === 'awaiting_payout' && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">No bank details yet.</p>}
            {p.hold_reason && <p className="mt-1 text-xs font-semibold text-red-600">{p.hold_reason}</p>}
            {p.status === 'awaiting_payout' && (p.can_send ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <BigButton onClick={() => setSel({ ...p, mode: 'send' })} disabled={p.payout_status === 'held'}>Record payout</BigButton>
                {p.payout_status === 'held' && <BigButton tone="ghost" onClick={() => setSel({ ...p, mode: 'clear' })}>Clear hold</BigButton>}
              </div>) : <p className="mt-3 text-xs text-green-600 dark:text-night-300">Only the Treasurer sends payouts.</p>)}
          </Card>))}</div>)}
      <Sheet open={!!sel && sel.mode === 'send'} onClose={() => setSel(null)} title={`Send ${sel ? formatNaira(sel.net_payout_kobo ?? sel.principal_kobo) : ''}`}>
        <p className="mb-3 text-sm text-green-700 dark:text-night-200">Send the money from the cooperative account to the bank account shown, then record it here. The repayment clock starts when you confirm.</p>
        <div className="space-y-3"><Field label="Bank transfer reference"><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <Field label={sel?.evidence_required ? 'Evidence (receipt link or reference)' : 'Evidence (optional)'}><input className={inputCls} value={ev} onChange={(e) => setEv(e.target.value)} /></Field>
          <BigButton loading={send.m.isPending} disabled={!ref.trim() || (sel?.evidence_required && !ev.trim())} onClick={() => send.m.mutate(sel.id)}>I have sent it</BigButton></div>
      </Sheet>
      <Sheet open={!!sel && sel.mode === 'clear'} onClose={() => setSel(null)} title="Clear the hold">
        <Field label="Why is it safe to send?"><Area value={note} onChange={setNote} /></Field>
        <div className="mt-3"><BigButton loading={clear.isPending} disabled={note.trim().length < 3} onClick={() => clear.mutate(sel.id)}>Clear hold</BigButton></div>
      </Sheet>
    </>
  )
}

/* ═════════ Requests (approvals engine) ═════════ */
const KINDS: [string, string][] = [['waiver', 'Waive an overdue charge'], ['restructure', 'Restructure a loan'], ['write_off', 'Write off a loan'], ['general_debit', 'Other debit'], ['reversal', 'Reverse an entry'], ['death_flag', "Record a member's death"], ['estate_payout', 'Pay balance to next of kin'], ['sweep', 'Confirm a sweep of funds']]
const STATUS_TONE: Record<string, any> = { pending: 'amber', approved: 'green', executed: 'green', rejected: 'red', cancelled: 'grey', failed: 'red' }

export function RequestsTab({ stepUp }: { stepUp: boolean }) {
  const [st, setSt] = useState('pending')
  const { data } = useAdmin<any[]>('requests', '/coop/admin/requests', { status: st || undefined })
  const [open, setOpen] = useState(false)
  const vote = useDirAct((v: { id: string; decision: string }, auth) => post(`/coop/admin/requests/${v.id}/vote`, { decision: v.decision, ...(auth ? { auth } : {}) }), (v) => v.decision === 'approve' || stepUp, 'Vote recorded')
  const cancel = useCoopAction((id: string) => post(`/coop/admin/requests/${id}/cancel`), { success: 'Request cancelled' })
  return (
    <>
      {vote.sheet}
      <BigButton onClick={() => setOpen(true)}>Open a request</BigButton>
      <div className="mt-3"><Chips value={st} onChange={setSt} items={[['pending', 'Waiting'], ['executed', 'Done'], ['rejected', 'Rejected'], ['', 'All']]} /></div>
      {!data ? <Skel h="h-40" /> : !data.length ? <Empty icon={<ShieldCheck className="h-7 w-7" />} title="Nothing here" text="No requests in this list." /> : (
        <div className="space-y-3">{data.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-2"><div><p className="font-extrabold text-green-900 dark:text-white">{r.label}</p><p className="text-xs text-green-600 dark:text-night-300">{r.loan_no ? `${r.loan_no} · ` : ''}{r.member ? `${r.member.name} · ` : ''}{dShort(r.created_at)}</p></div><Pill tone={STATUS_TONE[r.status] ?? 'grey'}>{k(r.status)}</Pill></div>
            {r.amount_kobo > 0 && <p className="mt-1 text-lg font-extrabold text-green-900 dark:text-white">{formatNaira(r.amount_kobo)}</p>}
            {r.reason && <p className="mt-1 text-sm text-green-800 dark:text-night-100">{r.reason}</p>}
            {r.payload?.new_term_months && <p className="text-sm text-green-800 dark:text-night-100">New term: {r.payload.new_term_months} months</p>}
            {r.evidence && <p className="text-xs text-green-600 dark:text-night-300">Evidence: {r.evidence}</p>}
            <div className="mt-2"><Bar value={r.approvals} max={r.needed} tone="amber" /><p className="mt-1 text-xs font-bold text-green-700 dark:text-night-200">{r.approvals} of {r.needed} approvals</p></div>
            {r.votes.map((v: any, i: number) => <p key={i} className="text-xs text-green-700 dark:text-night-200">{v.decision === 'approve' ? '✓' : '✗'} {v.director}{v.note ? `: ${v.note}` : ''}</p>)}
            {r.consents?.length > 0 && <div className="mt-2 rounded-xl bg-green-100/70 p-2 dark:bg-night-600">{r.consents.map((c: any) => <p key={c.member_id + c.role} className="text-xs text-green-800 dark:text-night-100">{c.name} ({c.role}): {c.status}</p>)}</div>}
            {r.result && <p className="mt-2 text-xs font-semibold text-green-700 dark:text-night-200">{typeof r.result === 'string' ? r.result : r.result.message ?? ''}</p>}
            {r.status === 'pending' && (
              <div className="mt-3 flex gap-2">
                {!r.you_voted && <><div className="flex-1"><BigButton loading={vote.m.isPending} onClick={() => vote.m.mutate({ id: r.id, decision: 'approve' })}><Check className="h-4 w-4" />Approve</BigButton></div><div className="flex-1"><BigButton tone="ghost" onClick={() => vote.m.mutate({ id: r.id, decision: 'reject' })}><X className="h-4 w-4" />Reject</BigButton></div></>}
                {r.mine && <div className="flex-1"><BigButton tone="ghost" onClick={() => cancel.mutate(r.id)}>Cancel</BigButton></div>}
              </div>)}
          </Card>))}</div>)}
      <OpenRequest open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function OpenRequest({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState('waiver')
  const [f, setF] = useState<any>({})
  const set = (x: string, v: any) => setF((o: any) => ({ ...o, [x]: v }))
  const needLoan = ['waiver', 'restructure', 'write_off'].includes(kind)
  const needMember = ['death_flag', 'estate_payout'].includes(kind)
  const { data: loans } = useAdmin<any[]>('loans-repaying', '/coop/admin/loans', { status: 'repaying' })
  const { data: members } = useAdmin<any[]>('members', '/coop/admin/members')
  const send = useCoopAction(() => {
    const payload: any = {}
    if (kind === 'restructure') payload.new_term_months = Number(f.term)
    if (kind === 'write_off') { payload.board_ref = f.board_ref ?? ''; payload.lawyer_report = f.lawyer ?? '' }
    if (kind === 'general_debit') payload.ledger = f.ledger ?? 'running_cost'
    if (kind === 'reversal') payload.journal_id = Number(f.journal_id)
    if (kind === 'sweep') payload.direction = f.direction ?? 'to_coop_account'
    return post('/coop/admin/requests', { kind, loan_id: needLoan ? f.loan_id : undefined, member_id: needMember ? f.member_id : undefined,
      amount_kobo: ['waiver', 'general_debit', 'sweep'].includes(kind) ? toKobo(f.amount ?? '') : 0, payload, reason: f.reason, evidence: f.evidence })
  }, { success: 'Request opened. Your approval is counted.', onSuccess: () => { setF({}); onClose() } })
  return (
    <Sheet open={open} onClose={onClose} title="Open a request">
      <div className="space-y-3">
        <Field label="What for"><select className={inputCls} value={kind} onChange={(e) => { setKind(e.target.value); setF({}) }}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        {needLoan && <Field label="Loan"><select className={inputCls} value={f.loan_id ?? ''} onChange={(e) => set('loan_id', e.target.value)}><option value="">Choose a loan</option>{(loans ?? []).map((l) => <option key={l.id} value={l.id}>{l.loan_no} · {l.borrower.name} · owes {formatNaira(l.total_due_kobo)}</option>)}</select></Field>}
        {needMember && <Field label="Member"><select className={inputCls} value={f.member_id ?? ''} onChange={(e) => set('member_id', e.target.value)}><option value="">Choose a member</option>{(members ?? []).map((m) => <option key={m.member_id} value={m.member_id}>{m.name} · {m.card_no}</option>)}</select></Field>}
        {['waiver', 'general_debit', 'sweep'].includes(kind) && <Field label="Amount"><MoneyInput value={f.amount ?? ''} onChange={(v) => set('amount', v)} /></Field>}
        {kind === 'restructure' && <Field label="New term (months)"><input className={inputCls} inputMode="numeric" value={f.term ?? ''} onChange={(e) => set('term', e.target.value.replace(/\D/g, ''))} /></Field>}
        {kind === 'write_off' && <><Field label="Board decision reference"><input className={inputCls} value={f.board_ref ?? ''} onChange={(e) => set('board_ref', e.target.value)} /></Field><Field label="Lawyer's report reference"><input className={inputCls} value={f.lawyer ?? ''} onChange={(e) => set('lawyer', e.target.value)} /></Field></>}
        {kind === 'general_debit' && <Field label="Take from"><select className={inputCls} value={f.ledger ?? 'running_cost'} onChange={(e) => set('ledger', e.target.value)}><option value="running_cost">Running-cost fund</option><option value="operating">Operating account</option></select></Field>}
        {kind === 'reversal' && <Field label="Journal entry number" hint="Find it in the Audit tab."><input className={inputCls} inputMode="numeric" value={f.journal_id ?? ''} onChange={(e) => set('journal_id', e.target.value.replace(/\D/g, ''))} /></Field>}
        {kind === 'sweep' && <Field label="Direction"><select className={inputCls} value={f.direction ?? 'to_coop_account'} onChange={(e) => set('direction', e.target.value)}><option value="to_coop_account">Settlement account → cooperative account</option><option value="from_coop_account">Cooperative account → settlement account</option></select></Field>}
        {['estate_payout', 'sweep'].includes(kind) && <Field label={kind === 'sweep' ? 'Bank transfer reference' : 'Evidence (death certificate, claimant ID reference)'}><input className={inputCls} value={f.evidence ?? ''} onChange={(e) => set('evidence', e.target.value)} /></Field>}
        <Field label="Reason"><Area value={f.reason ?? ''} onChange={(v) => set('reason', v)} /></Field>
        <BigButton loading={send.isPending} onClick={() => send.mutate(undefined)}>Open request</BigButton>
      </div>
    </Sheet>
  )
}

/* ═════════ Cases (recovery + complaints) ═════════ */
export function CasesTab() {
  const [kind, setKind] = useState('recovery')
  const [status, setStatus] = useState('open')
  const { data } = useAdmin<any[]>('cases', '/coop/admin/cases', { kind, status })
  const [sel, setSel] = useState<string | null>(null)
  const [openRec, setOpenRec] = useState(false)
  return (
    <>
      <div className="flex gap-2"><div className="flex-1"><Chips value={kind} onChange={setKind} items={[['recovery', 'Recovery'], ['complaint', 'Complaints']]} /></div>
        <Chips value={status} onChange={setStatus} items={[['open', 'Open'], ['all', 'All']]} /></div>
      {kind === 'recovery' && <div className="mb-3"><BigButton tone="ghost" onClick={() => setOpenRec(true)}>Open a recovery case</BigButton></div>}
      {!data ? <Skel h="h-40" /> : !data.length ? <Empty icon={<ShieldCheck className="h-7 w-7" />} title="No cases" text="Nothing in this list." /> : (
        <div className="space-y-2">{data.map((c) => (
          <Card key={c.id} onClick={() => setSel(c.id)}>
            <div className="flex items-start justify-between gap-2"><div><p className="font-bold text-green-900 dark:text-white">{c.subject}</p><p className="text-xs text-green-600 dark:text-night-300">{c.member?.name}{c.loan_no ? ` · ${c.loan_no}` : ''} · {dShort(c.created_at)}</p></div><Pill tone={c.status === 'closed' ? 'green' : c.due_at && new Date(c.due_at) < new Date() ? 'red' : 'amber'}>{c.status === 'closed' ? 'Closed' : c.status === 'answered' ? 'Replied' : 'Open'}</Pill></div>
            {c.due_at && c.status !== 'closed' && <p className="mt-1 text-xs text-green-700 dark:text-night-200">Answer due {dShort(c.due_at)}</p>}
          </Card>))}</div>)}
      {sel && <CaseSheet id={sel} onClose={() => setSel(null)} />}
      <RecoverySheet open={openRec} onClose={() => setOpenRec(false)} />
    </>
  )
}

function RecoverySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: loans } = useAdmin<any[]>('loans-repaying', '/coop/admin/loans', { status: 'repaying' })
  const [id, setId] = useState('')
  const run = useCoopAction(() => post('/coop/admin/cases/recovery', { loan_id: id }), { success: 'Recovery case opened', onSuccess: () => { setId(''); onClose() } })
  return (
    <Sheet open={open} onClose={onClose} title="Open a recovery case">
      <Field label="Loan"><select className={inputCls} value={id} onChange={(e) => setId(e.target.value)}><option value="">Choose a loan</option>{(loans ?? []).filter((l) => l.overdue_days > 0).map((l) => <option key={l.id} value={l.id}>{l.loan_no} · {l.borrower.name} · {l.overdue_days} days overdue</option>)}</select></Field>
      <p className="mt-2 text-xs text-green-600 dark:text-night-300">Only overdue loans are listed. Recovery cases also open by themselves after the number of days set in Rules.</p>
      <div className="mt-3"><BigButton loading={run.isPending} disabled={!id} onClick={() => run.mutate(undefined)}>Open case</BigButton></div>
    </Sheet>
  )
}

function CaseSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: c } = useAdmin<any>(`case-${id}`, `/coop/admin/cases/${id}`, undefined, 4000)
  const [body, setBody] = useState('')
  const [res, setRes] = useState('')
  const [closing, setClosing] = useState(false)
  const note = useCoopAction(() => post(`/coop/admin/cases/${id}/notes`, { kind: 'note', body, visible_to_member: false }), { success: 'Internal note added', onSuccess: () => setBody('') })
  const reply = useCoopAction((t: string) => post(`/coop/admin/cases/${id}/respond`, { resolution: t }))
  const close = useCoopAction(() => post(`/coop/admin/cases/${id}/close`, { resolution: res }), { success: c?.kind === 'complaint' ? 'Complaint resolved' : 'Case closed', onSuccess: onClose })
  const complaint = c?.kind === 'complaint'
  return (
    <Sheet open onClose={onClose} title={c?.subject ?? 'Case'}>
      {!c ? <Skel /> : complaint ? (
        <div className="space-y-3">
          <p className="text-xs text-green-600 dark:text-night-300">{c.member?.name} · {c.member?.card_no} · {c.member?.phone}{c.loan_no ? ` · ${c.loan_no}` : ''}</p>
          <div className="max-h-[48vh] overflow-y-auto pr-1">
            <ChatThread viewer="director" first={{ author: c.member?.name ?? 'Member', body: c.body, at: c.created_at }} notes={c.notes.filter((n: any) => n.visible_to_member)}
              onSend={(t) => reply.mutate(t)} sending={reply.isPending} locked={c.status === 'closed'} lockedText={`Resolved: ${c.resolution ?? ''}`} placeholder="Reply to the member" />
          </div>
          {c.notes.some((n: any) => !n.visible_to_member) && <div className="space-y-1">{c.notes.filter((n: any) => !n.visible_to_member).map((n: any) => <p key={n.id} className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><b>Internal ({n.author}):</b> {n.body}</p>)}</div>}
          {c.status !== 'closed' && (<>
            <details className="text-sm"><summary className="cursor-pointer font-bold text-green-700 dark:text-night-200">Add a private note (the member cannot see it)</summary>
              <div className="mt-2 space-y-2"><Area value={body} onChange={setBody} /><BigButton tone="ghost" loading={note.isPending} disabled={!body.trim()} onClick={() => note.mutate(undefined)}>Save private note</BigButton></div></details>
            {!closing ? <BigButton tone="ghost" onClick={() => setClosing(true)}>Mark as resolved</BigButton> : (
              <div className="space-y-2"><Field label="Final note to the member"><Area value={res} onChange={setRes} /></Field>
                <BigButton loading={close.isPending} disabled={!res.trim()} onClick={() => close.mutate(undefined)}>Resolve and close</BigButton></div>)}
          </>)}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100">{c.body}</p>
          {c.loan && <p className="text-xs text-green-700 dark:text-night-200">Owes {formatNaira(c.loan.total_due_kobo)} · {c.loan.overdue_days} days overdue</p>}
          {c.notes.map((n: any) => <div key={n.id} className="rounded-xl bg-green-100/70 p-2 text-sm dark:bg-night-600"><p className="text-xs text-green-600 dark:text-night-300">{n.author} · {dShort(n.at)}</p><p className="text-green-900 dark:text-white">{n.body}</p></div>)}
          {c.status !== 'closed' ? (
            <>
              <Field label="Add a note"><Area value={body} onChange={setBody} /></Field>
              <BigButton tone="ghost" loading={note.isPending} disabled={!body.trim()} onClick={() => note.mutate(undefined)}>Add note</BigButton>
              <Field label="How was it resolved?"><Area value={res} onChange={setRes} /></Field>
              <BigButton loading={close.isPending} disabled={!res.trim()} onClick={() => close.mutate(undefined)}>Close case</BigButton>
            </>) : <p className="text-sm font-bold text-green-700 dark:text-night-200">Closed: {c.resolution}</p>}
        </div>)}
    </Sheet>
  )
}

/* ═════════ Year end ═════════ */
export function YearEndTab({ stepUp }: { stepUp: boolean }) {
  const { data } = useAdmin<any>('runs', '/coop/admin/dividend-runs')
  const [sel, setSel] = useState<string | null>(null)
  const [sub, setSub] = useState('dividend')
  return (
    <>
      <Chips value={sub} onChange={setSub} items={[['dividend', 'Dividend'], ['disputes', 'Disputes'], ['expenses', 'Expenses'], ['report', 'Monthly report']]} />
      {sub === 'dividend' && <Dividend data={data} onOpen={setSel} />}
      {sub === 'disputes' && <Disputes data={data} />}
      {sub === 'expenses' && <Expenses stepUp={stepUp} />}
      {sub === 'report' && <Report />}
      {sel && <RunSheet id={sel} stepUp={stepUp} onClose={() => setSel(null)} />}
    </>
  )
}

function Dividend({ data, onOpen }: { data: any; onOpen: (id: string) => void }) {
  const fees = useCoopAction(() => post('/coop/admin/year-end/fees'), { success: 'Membership fees collected' })
  const prep = useCoopAction(() => post('/coop/admin/dividend-runs/prepare', {}), { success: 'Dividend prepared', onSuccess: (r) => onOpen(r.id) })
  if (!data) return <Skel h="h-40" />
  return (
    <>
      <Card>
        <p className="font-extrabold text-green-900 dark:text-white">Year end {data.year}</p>
        <p className="mt-1 text-sm text-green-700 dark:text-night-200">Steps: 1) collect any membership fees due, 2) prepare the dividend, 3) run the checks, 4) directors approve, 5) pay.</p>
        {!data.you_are_accountant && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Only the accountant prepares and checks the dividend.</p>}
        <div className="mt-3 grid grid-cols-2 gap-2"><BigButton tone="ghost" loading={fees.isPending} onClick={() => fees.mutate(undefined)}>Collect fees</BigButton><BigButton loading={prep.isPending} disabled={!data.you_are_accountant} onClick={() => prep.mutate(undefined)}>Prepare dividend</BigButton></div>
      </Card>
      <SectionTitle>Runs</SectionTitle>
      {!data.runs.length ? <p className="text-sm text-green-700 dark:text-night-200">No dividend has been prepared yet.</p> : <div className="space-y-2">{data.runs.map((r: any) => (
        <Card key={r.id} onClick={() => onOpen(r.id)}><div className="flex items-center justify-between"><div><p className="font-bold text-green-900 dark:text-white">{r.year}</p><p className="text-xs text-green-600 dark:text-night-300">Pool {formatNaira(r.pool_kobo)} · share-out {formatNaira(r.distributable_kobo)}</p></div><Pill tone={r.status === 'paid' ? 'green' : r.status === 'cancelled' ? 'grey' : 'amber'}>{k(r.status)}</Pill></div></Card>))}</div>}
    </>
  )
}

function RunSheet({ id, stepUp, onClose }: { id: string; stepUp: boolean; onClose: () => void }) {
  const { data: r } = useAdmin<any>(`run-${id}`, `/coop/admin/dividend-runs/${id}`)
  const [checks, setChecks] = useState<any[] | null>(null)
  const rec = useCoopAction(() => post(`/coop/admin/dividend-runs/${id}/reconcile`), { success: 'Checks run', onSuccess: (x) => setChecks(x.checks) })
  const vote = useDirAct((v: { decision: string }, auth) => post(`/coop/admin/requests/${r.request_id}/vote`, { decision: v.decision, ...(auth ? { auth } : {}) }), (v) => v.decision === 'approve' || stepUp, 'Vote recorded')
  const pay = useDirAct((_: void, auth) => postIdem(`/coop/admin/dividend-runs/${id}/pay`, auth ? { auth } : {}, newKey()), stepUp, 'Dividend paid')
  const req = r?.request
  return (
    <Sheet open onClose={onClose} title={r ? `Dividend ${r.year}` : 'Dividend'}>
      {vote.sheet}{pay.sheet}
      {!r ? <Skel h="h-40" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Stat label="Pool" value={formatNaira(r.pool_kobo)} /><Stat label="Share-out" value={formatNaira(r.distributable_kobo)} /><Stat label="Contributors' part" value={formatNaira(r.contribution_pool_kobo)} /><Stat label="Guarantors' part" value={formatNaira(r.guarantee_pool_kobo)} /></div>
          {r.carry_kobo > 0 && <p className="text-xs text-green-700 dark:text-night-200">{formatNaira(r.carry_kobo)} is carried to next year.</p>}
          {(checks ?? r.report?.checks)?.map((c: any) => <p key={c.name} className="flex gap-1.5 text-xs">{c.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" /> : <XCircle className="h-4 w-4 flex-shrink-0 text-red-500" />}<span className="text-green-800 dark:text-night-100"><b>{c.name}</b> {c.detail}</span></p>)}
          {r.status === 'prepared' && <BigButton loading={rec.isPending} onClick={() => rec.mutate(undefined)}><RefreshCw className="h-4 w-4" />Run checks and send for approval</BigButton>}
          {req && r.status !== 'paid' && (
            <Card><p className="text-sm font-bold text-green-900 dark:text-white">{req.approvals} of {req.needed} approvals</p>
              {req.votes.map((v: any, i: number) => <p key={i} className="text-xs text-green-700 dark:text-night-200">{v.decision === 'approve' ? '✓' : '✗'} {v.director}</p>)}
              {req.status === 'pending' && !req.you_voted && <div className="mt-2 grid grid-cols-2 gap-2"><BigButton loading={vote.m.isPending} onClick={() => vote.m.mutate({ decision: 'approve' })}>Approve</BigButton><BigButton tone="ghost" onClick={() => vote.m.mutate({ decision: 'reject' })}>Reject</BigButton></div>}</Card>)}
          {r.status === 'approved' && <BigButton tone="amber" loading={pay.m.isPending} onClick={() => pay.m.mutate(undefined as never)}>Pay the dividend</BigButton>}
          {r.lines && <><SectionTitle>Members ({r.lines.length})</SectionTitle><div className="space-y-1">{r.lines.map((l: any) => <p key={l.member_id} className="flex justify-between text-sm text-green-800 dark:text-night-100"><span>{l.name}{!l.qualified && <span className="ml-1 text-xs text-amber-700">({l.reason})</span>}</span><b>{formatNaira(l.total_kobo)}</b></p>)}</div></>}
        </div>)}
    </Sheet>
  )
}

function Disputes({ data }: { data: any }) {
  const [d, setD] = useState<any>(null)
  const [f, setF] = useState({ uphold: true, adjust: '', resolution: '', fund_from: 'pool' })
  const run = useCoopAction(() => post(`/coop/admin/disputes/${d.id}/resolve`, { uphold: f.uphold, adjust_kobo: f.uphold ? toKobo(f.adjust) : 0, resolution: f.resolution, fund_from: f.fund_from }), { success: 'Dispute resolved', onSuccess: () => setD(null) })
  if (!data) return <Skel />
  return (
    <>
      {!data.disputes.length ? <Empty icon={<ShieldCheck className="h-7 w-7" />} title="No disputes" text="Members can dispute an approved dividend within the window set in Rules." /> : <div className="space-y-2">{data.disputes.map((x: any) => (
        <Card key={x.id} onClick={x.status === 'open' ? () => setD(x) : undefined}><div className="flex items-start justify-between"><div><p className="font-bold text-green-900 dark:text-white">{x.member} · {x.year}</p><p className="text-sm text-green-800 dark:text-night-100">{x.body}</p></div><Pill tone={x.status === 'open' ? 'amber' : 'green'}>{x.status}</Pill></div>{x.resolution && <p className="mt-1 text-xs text-green-700 dark:text-night-200">{x.resolution}</p>}</Card>))}</div>}
      <Sheet open={!!d} onClose={() => setD(null)} title="Resolve the dispute">
        <div className="space-y-3"><p className="text-sm text-green-800 dark:text-night-100">{d?.body}</p>
          <div className="grid grid-cols-2 gap-2"><button onClick={() => setF({ ...f, uphold: true })} className={chip(f.uphold)}>Member is right</button><button onClick={() => setF({ ...f, uphold: false })} className={chip(!f.uphold)}>Reject</button></div>
          {f.uphold && <><Field label="Extra amount to pay the member"><MoneyInput value={f.adjust} onChange={(v) => setF({ ...f, adjust: v })} /></Field>
            <Field label="Pay it from"><select className={inputCls} value={f.fund_from} onChange={(e) => setF({ ...f, fund_from: e.target.value })}><option value="pool">Dividend pool</option><option value="running_cost">Running-cost fund</option></select></Field></>}
          <Field label="Decision and reason"><Area value={f.resolution} onChange={(v) => setF({ ...f, resolution: v })} /></Field>
          <BigButton loading={run.isPending} disabled={!f.resolution.trim()} onClick={() => run.mutate(undefined)}>Save decision</BigButton></div>
      </Sheet>
    </>
  )
}

function Expenses({ stepUp }: { stepUp: boolean }) {
  const { data } = useAdmin<any>('expenses', '/coop/admin/expenses')
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<any>({ category: 'other', spent_on: new Date().toISOString().slice(0, 10) })
  const add = useCoopAction(() => post('/coop/admin/expenses', { category: f.category, amount_kobo: toKobo(f.amount ?? ''), description: f.description, spent_on: f.spent_on, evidence: f.evidence }), { success: 'Expense request opened', onSuccess: () => { setOpen(false); setF({ category: 'other', spent_on: f.spent_on }) } })
  void stepUp
  if (!data) return <Skel />
  return (
    <>
      <Card><div className="grid grid-cols-3 gap-2"><Stat label="Fund" value={formatNaira(data.fund_balance_kobo)} /><Stat label="Received" value={formatNaira(data.received_kobo)} /><Stat label="Spent" value={formatNaira(data.spent_kobo)} /></div>
        <div className="mt-3"><BigButton onClick={() => setOpen(true)}>Record an expense</BigButton></div></Card>
      <SectionTitle>Register</SectionTitle>
      <div className="space-y-2">{data.items.map((e: any) => <Card key={e.id}><div className="flex items-start justify-between"><div><p className="font-bold capitalize text-green-900 dark:text-white">{k(e.category)}</p><p className="text-xs text-green-600 dark:text-night-300">{e.description} · {dShort(e.spent_on)}</p></div><div className="text-right"><b>{formatNaira(e.amount_kobo)}</b><br /><Pill tone={e.status === 'approved' ? 'green' : 'amber'}>{e.status}</Pill></div></div></Card>)}{!data.items.length && <p className="text-sm text-green-700 dark:text-night-200">No expenses recorded.</p>}</div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Record an expense">
        <div className="space-y-3"><Field label="Category"><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{data.categories.map((c: string) => <option key={c} value={c}>{k(c)}</option>)}</select></Field>
          <Field label="Amount"><MoneyInput value={f.amount ?? ''} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="What was it for"><input className={inputCls} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Date"><input type="date" className={inputCls} value={f.spent_on} onChange={(e) => setF({ ...f, spent_on: e.target.value })} /></Field>
          <Field label="Receipt link or reference"><input className={inputCls} value={f.evidence ?? ''} onChange={(e) => setF({ ...f, evidence: e.target.value })} /></Field>
          <p className="text-[11px] text-green-600 dark:text-night-300">The expense is paid from the running-cost fund after enough directors approve it in Requests.</p>
          <BigButton loading={add.isPending} disabled={toKobo(f.amount ?? '') <= 0 || !(f.description ?? '').trim()} onClick={() => add.mutate(undefined)}>Send for approval</BigButton></div>
      </Sheet>
    </>
  )
}

function Report() {
  const now = new Date()
  const [y, setY] = useState(now.getFullYear())
  const [m, setM] = useState(now.getMonth() + 1)
  const { data: r } = useAdmin<any>('report', '/coop/admin/reports/monthly', { year: y, month: m })
  const [busy, setBusy] = useState(false)
  const dl = async () => {
    setBusy(true)
    try { await downloadFromApi('/coop/admin/reports/monthly.pdf', `Cooperative Report ${y}-${String(m).padStart(2, '0')}.pdf`, { params: { year: y, month: m }, label: 'Preparing the report' }) }
    catch (e) { toast.error(getErrorMessage(e)) } finally { setBusy(false) }
  }
  const rows: [string, number][] = r ? [['Contributions in', r.contributions_in_kobo], ['Withdrawals', r.withdrawals_kobo], ['Closures paid', r.closures_kobo], ['Loans paid out', r.loans_paid_out_kobo], ['Transfer fees', r.transfer_fees_kobo], ['Principal repaid', r.principal_repaid_kobo], ['Interest received', r.interest_received_kobo], ['Overdue charges received', r.overdue_charges_received_kobo], ['Running cost received', r.running_cost_in_kobo], ['Expenses', r.expenses_kobo], ['Withdrawal charges', r.withdrawal_charges_kobo], ['Dividends paid', r.dividends_paid_kobo], ['Loans written off', r.loans_written_off_kobo]] : []
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2"><select className={inputCls} value={m} onChange={(e) => setM(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleString('en', { month: 'long' })}</option>)}</select>
        <select className={inputCls} value={y} onChange={(e) => setY(Number(e.target.value))}>{[now.getFullYear(), now.getFullYear() - 1].map((v) => <option key={v}>{v}</option>)}</select></div>
      {!r ? <Skel h="h-40" /> : (
        <>
          <Card className="space-y-1">{rows.map(([l, v]) => <p key={l} className="flex justify-between text-sm text-green-800 dark:text-night-100"><span>{l}</span><b>{formatNaira(Math.abs(v))}</b></p>)}<p className="flex justify-between text-sm text-green-800 dark:text-night-100"><span>New members</span><b>{r.new_members}</b></p></Card>
          <SectionTitle>End of month</SectionTitle>
          <Card className="space-y-1 text-sm text-green-800 dark:text-night-100"><p className="flex justify-between"><span>Members</span><b>{r.end_of_month.members}</b></p><p className="flex justify-between"><span>Contributions held</span><b>{formatNaira(r.end_of_month.contributions_kobo)}</b></p><p className="flex justify-between"><span>Dividend pool</span><b>{formatNaira(r.end_of_month.dividend_pool_kobo)}</b></p><p className="flex justify-between"><span>Loans outstanding</span><b>{formatNaira(r.end_of_month.loans_outstanding_kobo)}</b></p><p className="flex justify-between"><span>Loans active / overdue</span><b>{r.end_of_month.loans_active} / {r.end_of_month.loans_overdue}</b></p></Card>
          <div className="mt-3"><BigButton tone="ghost" loading={busy} onClick={dl}><Download className="h-4 w-4" />Download PDF</BigButton></div>
        </>)}
    </>
  )
}

/* ═════════ Money (position, reconciliation, jobs, pilot cap, go-live) ═════════ */
export function MoneyTab() {
  const { data } = useAdmin<any>('money', '/coop/admin/money')
  const { data: gl } = useAdmin<any>('golive', '/coop/admin/go-live')
  const rec = useCoopAction(() => post('/coop/admin/money/reconcile'), { success: 'Reconciliation finished' })
  const jobs = useCoopAction(() => post('/coop/admin/jobs/run'), { success: 'Jobs ran' })
  const ask = useCoopAction(() => post('/coop/admin/go-live/request'), { success: 'Go-live request opened' })
  if (!data) return <Skel h="h-40" />
  const p = data.position, f = p.funds, last = data.last_reconciliation
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between"><p className="font-extrabold text-green-900 dark:text-white">Where the money is</p><Pill tone={p.live ? 'green' : 'amber'}>{p.live ? 'Live' : 'Practice'}</Pill></div>
        <div className="mt-3 grid grid-cols-2 gap-3"><Stat label="Members' contributions" value={formatNaira(f.member_contributions_kobo)} sub={`${formatNaira(f.of_which_locked_kobo)} locked`} /><Stat label="Dividend pool" value={formatNaira(f.dividend_pool_kobo)} /><Stat label="Running-cost fund" value={formatNaira(f.running_cost_kobo)} /><Stat label="Operating (fees)" value={formatNaira(f.operating_kobo)} /><Stat label="Lent out" value={formatNaira(f.loans_outstanding_kobo)} /><Stat label="Cash it should hold" value={formatNaira(p.expected_cash_kobo)} /></div>
        {p.mode === 'sub_account' && <p className="mt-2 text-sm font-bold text-green-900 dark:text-white">To sweep to the cooperative account: {formatNaira(p.to_sweep_kobo)}</p>}
        <p className="mt-2 text-xs text-green-700 dark:text-night-200">{p.note}</p>
      </Card>
      {data.pilot?.enabled && <Card><p className="font-bold text-green-900 dark:text-white">Pilot cap</p><div className="mt-2"><Bar value={data.pilot.received_kobo} max={data.pilot.cap_kobo} tone="amber" /></div><p className="mt-1 text-xs text-green-700 dark:text-night-200">{formatNaira(data.pilot.received_kobo)} received of {formatNaira(data.pilot.cap_kobo)}</p></Card>}
      <Card>
        <div className="flex items-center justify-between"><p className="font-extrabold text-green-900 dark:text-white">Reconciliation</p>{last && <Pill tone={last.ok ? 'green' : 'red'}>{last.ok ? 'All clear' : 'Problem found'}</Pill>}</div>
        {last ? <><p className="text-xs text-green-600 dark:text-night-300">Last run {dShort(last.run_at)}</p><div className="mt-2 space-y-1">{last.checks.map((c: any) => <p key={c.name} className="flex gap-1.5 text-xs text-green-800 dark:text-night-100">{c.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" /> : <XCircle className="h-4 w-4 flex-shrink-0 text-red-500" />}<span><b>{c.name}</b> {c.detail}</span></p>)}</div></> : <p className="text-sm text-green-700 dark:text-night-200">Not run yet.</p>}
        <div className="mt-3"><BigButton tone="ghost" loading={rec.isPending} onClick={() => rec.mutate(undefined)}><RefreshCw className="h-4 w-4" />Run the check now</BigButton></div>
      </Card>
      <Card>
        <p className="font-extrabold text-green-900 dark:text-white">Daily jobs</p>
        <p className="text-xs text-green-600 dark:text-night-300">Reminders, automatic repayments, expiry and the nightly check. They also run by themselves when someone opens the app.</p>
        <div className="mt-2 space-y-1">{data.jobs.map((j: any) => <p key={j.name} className="flex justify-between text-xs text-green-800 dark:text-night-100"><span>{k(j.name)}</span><span>{j.last_run_at ? dShort(j.last_run_at) : 'never'}</span></p>)}</div>
        <div className="mt-3"><BigButton tone="ghost" loading={jobs.isPending} onClick={() => jobs.mutate(undefined)}><Play className="h-4 w-4" />Run all now</BigButton></div>
      </Card>
      {gl && (
        <Card className={gl.live ? 'border-green-300' : 'border-amber-300 bg-amber-50 dark:bg-amber-500/10'}>
          <p className="flex items-center gap-1.5 font-extrabold text-green-900 dark:text-white"><AlertTriangle className="h-5 w-5 text-amber-700" />{gl.live ? 'Live money is ON' : 'Going live'}</p>
          {!gl.live && <>
            <div className="mt-2 space-y-1">{gl.items.map((i: any) => <p key={i.key} className="flex gap-1.5 text-sm text-green-900 dark:text-night-100">{i.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" /> : <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />}<span>{i.label}{i.detail && <span className="block text-xs text-green-600 dark:text-night-300">{i.detail}</span>}</span></p>)}</div>
            {gl.request ? <p className="mt-3 text-sm font-bold text-green-900 dark:text-white">Go-live request: {gl.request.approvals} of {gl.request.needed} approvals. Vote in the Requests tab.</p> : <div className="mt-3"><BigButton tone="amber" disabled={!gl.ready} loading={ask.isPending} onClick={() => ask.mutate(undefined)}>Ask directors to switch on live money ({gl.needed_approvals} needed)</BigButton></div>}
          </>}
        </Card>)}
    </div>
  )
}

/* ═════════ Roles ═════════ */
export function RolesTab() {
  const { data } = useAdmin<any>('roles', '/coop/admin/roles')
  const [edit, setEdit] = useState<any>(null)
  const [pick, setPick] = useState<string[]>([])
  const [why, setWhy] = useState('')
  const propose = useCoopAction(() => post(`/coop/admin/settings/${edit.key}/propose`, { value: pick.join(','), reason: why }), { success: 'Proposed. Another director must approve.', onSuccess: () => setEdit(null) })
  const approve = useCoopAction((v: { id: string; decision: string }) => post(`/coop/admin/settings/changes/${v.id}/vote`, { decision: v.decision }), { success: 'Vote recorded' })
  if (!data) return <Skel h="h-40" />
  const name = (id: string) => data.names[id] ?? id.slice(0, 6)
  return (
    <>
      <div className="space-y-2">{data.roles.map((r: any) => (
        <Card key={r.key}>
          <div className="flex items-start justify-between gap-2"><div><p className="font-extrabold text-green-900 dark:text-white">{r.label}</p><p className="text-xs text-green-600 dark:text-night-300">{r.help}</p></div><button className="text-sm font-bold text-green-700 dark:text-green-300" onClick={() => { setEdit(r); setPick(r.current); setWhy('') }}>Change</button></div>
          <p className="mt-2 text-sm text-green-800 dark:text-night-100">{r.current.length ? r.current.map(name).join(', ') : r.key === 'final_release_directors' ? 'Any director' : 'Nobody yet'}</p>
          {r.pending && <div className="mt-2 rounded-xl bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Proposed: {r.pending.new_value ? r.pending.new_value.split(',').map(name).join(', ') : 'nobody'} · {r.pending.approvals} of {r.pending.needed} approvals
            {!r.pending.you_voted && <div className="mt-2 flex gap-2"><button className="font-bold underline" disabled={approve.isPending} onClick={() => approve.mutate({ id: r.pending.id, decision: 'approve' })}>Approve</button><button className="font-bold underline" disabled={approve.isPending} onClick={() => approve.mutate({ id: r.pending.id, decision: 'reject' })}>Reject</button></div>}</div>}
        </Card>))}</div>
      <SectionTitle>Who can do what</SectionTitle>
      <Card className="space-y-1.5">{data.permissions.map((p: any) => <p key={p.action} className="flex justify-between gap-3 text-sm text-green-800 dark:text-night-100"><span>{p.action}</span><b className="text-right">{p.who}</b></p>)}</Card>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.label ?? ''}>
        <div className="space-y-2">{data.directors.map((d: any) => { const on = pick.includes(d.id); return <button key={d.id} onClick={() => setPick(edit.multi ? (on ? pick.filter((x) => x !== d.id) : [...pick, d.id]) : on ? [] : [d.id])} className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm font-bold ${on ? 'border-green-600 bg-green-100 dark:bg-night-600 dark:text-white' : 'border-green-200 dark:border-night-400 dark:text-night-100'}`}>{d.name}{d.is_you ? ' (you)' : ''}{on && <Check className="h-4 w-4" />}</button> })}</div>
        <div className="mt-3"><Field label="Reason"><input className={inputCls} value={why} onChange={(e) => setWhy(e.target.value)} /></Field></div>
        <div className="mt-3"><BigButton loading={propose.isPending} onClick={() => propose.mutate(undefined)}>Propose this change</BigButton></div>
      </Sheet>
    </>
  )
}

/* ═════════ Audit ═════════ */
export function AuditTab() {
  const [q, setQ] = useState('')
  const [entity, setEntity] = useState('')
  const { data } = useAdmin<any[]>('audit', '/coop/admin/audit', { q: q || undefined, entity: entity || undefined, limit: 100 })
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2"><input className={inputCls} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={inputCls} value={entity} onChange={(e) => setEntity(e.target.value)}><option value="">Everything</option>{['loan', 'member', 'setting', 'request', 'case', 'dividend', 'journal'].map((x) => <option key={x}>{x}</option>)}</select></div>
      {!data ? <Skel h="h-40" /> : <div className="space-y-2">{data.map((e) => <Card key={e.id}><p className="text-sm font-bold text-green-900 dark:text-white">{k(e.action)}</p><p className="text-xs text-green-600 dark:text-night-300">{e.entity} {e.entity_id.slice(0, 8)} · {e.actor} · {new Date(e.at).toLocaleString('en-NG')}</p>{e.data && Object.keys(e.data).length > 0 && <p className="mt-1 break-words text-[11px] text-green-700 dark:text-night-200">{JSON.stringify(e.data)}</p>}</Card>)}{!data.length && <p className="text-sm text-green-700 dark:text-night-200">No entries.</p>}</div>}
    </>
  )
}
export type { ReactNode }
