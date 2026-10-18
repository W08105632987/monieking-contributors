import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Landmark, Mail, ShieldCheck } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { api, getErrorMessage } from '@/lib/api'
import toast from 'react-hot-toast'
import { BankPickerModal, type Bank } from '@/components/settings/BankPickerModal'
import { post, postIdem, put, useCoopAction, useCoopQ, useCoopStatus } from '../api'
import { newKey, useAuthPrompt } from '../auth'
import { BigButton, Card, CoopPage, Empty, Field, Pill, SectionTitle, Sheet, Skel, dShort, inputCls } from '../ui'

/* ───────── bank details ───────── */
export function BankPage() {
  const { data } = useCoopQ<{ bank: any; profile_bank: any }>('bank', '/coop/bank')
  const [pick, setPick] = useState(false)
  const [bank, setBank] = useState<Bank | null>(null)
  const [acct, setAcct] = useState('')
  const save = useCoopAction(() => put('/coop/bank', { bank_code: bank!.code, bank_name: bank!.name, account_number: acct }), { success: 'Bank details saved', onSuccess: () => { setBank(null); setAcct('') } })
  const fromProfile = useCoopAction(() => post('/coop/bank/from-profile'), { success: 'Bank details copied from your profile' })
  const b = data?.bank
  return (
    <CoopPage title="My bank details" subtitle="Where your loan is paid" back="/coop/me">
      {!data ? <Skel /> : (
        <>
          <Card>
            {b ? (
              <>
                <div className="flex items-start justify-between"><div><p className="font-extrabold text-green-900 dark:text-white">{b.account_name}</p><p className="text-sm text-green-700 dark:text-night-200">{b.bank_name} · {b.account_number}</p></div>
                  <Pill tone={b.name_match ? 'green' : 'amber'}>{b.name_match ? 'Name matches' : 'Name differs'}</Pill></div>
                {!b.name_match && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">{b.name_note || 'The account name does not match your name. A director may need to check it before sending a loan.'}</p>}
              </>
            ) : <Empty icon={<Landmark className="h-7 w-7" />} title="No bank account yet" text="Add the account where you want to receive a loan. It must be in your own name." />}
          </Card>
          {data.profile_bank && (!b || b.account_number !== data.profile_bank.account_number) && (
            <div className="mt-3"><BigButton tone="ghost" loading={fromProfile.isPending} onClick={() => fromProfile.mutate(undefined)}>Use the account on my profile ({data.profile_bank.bank_name} · {data.profile_bank.account_number})</BigButton></div>)}
          <SectionTitle>{b ? 'Change account' : 'Add an account'}</SectionTitle>
          <Card className="space-y-3">
            <Field label="Bank"><button onClick={() => setPick(true)} className={`${inputCls} text-left`}>{bank?.name ?? 'Choose your bank'}</button></Field>
            <Field label="Account number"><input inputMode="numeric" maxLength={10} value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ''))} className={inputCls} placeholder="10 digits" /></Field>
            <BigButton loading={save.isPending} disabled={!bank || acct.length !== 10} onClick={() => save.mutate(undefined)}>Save and verify</BigButton>
            <p className="text-[11px] text-green-600 dark:text-night-300">We check the account name with the bank. Loans are paid only to an account in your own name.</p>
          </Card>
        </>)}
      <BankPickerModal open={pick} onClose={() => setPick(false)} onSelect={(x) => { setBank(x); setPick(false) }} selectedCode={bank?.code} />
    </CoopPage>
  )
}

/* ───────── next of kin ───────── */
export function KinPage() {
  const { data } = useCoopQ<{ next_of_kin: any }>('kin', '/coop/next-of-kin')
  const [f, setF] = useState<any>(null)
  const cur = f ?? data?.next_of_kin ?? { name: '', relationship: '', phone: '', address: '' }
  const set = (k: string, v: string) => setF({ ...cur, [k]: v })
  const save = useCoopAction(() => put('/coop/next-of-kin', cur), { success: 'Next of kin saved', onSuccess: () => setF(null) })
  return (
    <CoopPage title="Next of kin" subtitle="Who the cooperative contacts if something happens to you" back="/coop/me">
      {!data ? <Skel /> : (
        <Card className="space-y-3">
          <Field label="Full name"><input className={inputCls} value={cur.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Relationship"><input className={inputCls} value={cur.relationship} onChange={(e) => set('relationship', e.target.value)} placeholder="e.g. Spouse, Sister" /></Field>
          <Field label="Phone number"><input className={inputCls} inputMode="tel" value={cur.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Address (optional)"><input className={inputCls} value={cur.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
          <BigButton loading={save.isPending} disabled={!cur.name || !cur.relationship || !cur.phone} onClick={() => save.mutate(undefined)}>Save</BigButton>
        </Card>)}
    </CoopPage>
  )
}

/* ───────── closing the membership ───────── */
export function ClosePage() {
  const nav = useNavigate()
  const { data } = useCoopQ<any>('close', '/coop/close')
  const { ask, sheet } = useAuthPrompt()
  const [sure, setSure] = useState(false)
  const run = useCoopAction(async () => {
    const auth = await ask(!!data?.step_up)
    if (auth === null) throw new Error('Cancelled')
    return postIdem('/coop/close', auth ? { auth } : {}, newKey())
  }, { success: 'Your membership is closed', onSuccess: () => nav('/coop') })
  return (
    <CoopPage title="Close my membership" back="/coop/me">
      {sheet}
      {!data ? <Skel /> : (
        <>
          <Card>
            <p className="flex justify-between text-sm"><span>Your contribution</span><b>{formatNaira(data.balance_kobo)}</b></p>
            <p className="mt-1 flex justify-between text-sm"><span>Closing charge ({+(data.charge_bps / 100).toFixed(2)}%)</span><b>− {formatNaira(data.charge_kobo)}</b></p>
            <p className="mt-1 flex justify-between border-t border-green-100 pt-1 text-base dark:border-night-500"><span className="font-bold">You receive</span><b>{formatNaira(data.you_receive_kobo)}</b></p>
            <p className="mt-2 text-xs text-green-700 dark:text-night-200">You will not share the dividend of the current year after closing.</p>
          </Card>
          {data.blockers?.length > 0 && <Card className="mt-3 border-amber-300 bg-amber-50 dark:bg-amber-500/10">{data.blockers.map((x: string) => <p key={x} className="text-sm text-amber-900 dark:text-amber-200">• {x}</p>)}</Card>}
          <div className="mt-4 space-y-2">
            <label className="flex gap-2 text-sm text-green-900 dark:text-white"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-1" />I understand this closes my membership and pays my contribution out.</label>
            <BigButton tone="red" disabled={!data.can_close || !sure} loading={run.isPending} onClick={() => run.mutate(undefined)}>Close my membership</BigButton>
          </div>
        </>)}
    </CoopPage>
  )
}

/* ───────── complaints ───────── */
const CATS: [string, string][] = [['loan', 'My loan'], ['contribution', 'A contribution'], ['withdrawal', 'A withdrawal'], ['dividend', 'Dividend'], ['guarantee', 'A guarantee'], ['payout', 'A loan payout'], ['other', 'Something else']]
export function ComplaintsPage() {
  const { data } = useCoopQ<any[]>('complaints', '/coop/complaints')
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ subject: '', body: '', category: 'other' })
  const send = useCoopAction(() => post('/coop/complaints', f), { success: 'Sent to the directors', onSuccess: () => { setOpen(false); setF({ subject: '', body: '', category: 'other' }) } })
  return (
    <CoopPage title="Complaints" subtitle="Tell the directors what went wrong" back="/coop/me">
      <BigButton onClick={() => setOpen(true)}><Mail className="h-4 w-4" />Write a complaint</BigButton>
      <SectionTitle>My complaints</SectionTitle>
      {!data ? <Skel /> : !data.length ? <p className="text-sm text-green-700 dark:text-night-200">You have not sent any complaint.</p> : (
        <div className="space-y-2">{data.map((c) => (
          <Card key={c.id}><div className="flex items-start justify-between gap-2"><div><p className="font-bold text-green-900 dark:text-white">{c.subject}</p><p className="text-xs text-green-600 dark:text-night-300">{dShort(c.created_at)}{c.due_at && c.status !== 'closed' ? ` · answer due ${dShort(c.due_at)}` : ''}</p></div><Pill tone={c.status === 'closed' ? 'green' : 'amber'}>{c.status === 'closed' ? 'Answered' : 'Open'}</Pill></div>
            <p className="mt-2 text-sm text-green-800 dark:text-night-100">{c.body}</p>
            {c.resolution && <p className="mt-2 rounded-xl bg-green-100 p-2 text-sm text-green-900 dark:bg-night-600 dark:text-white"><b>Answer:</b> {c.resolution}</p>}</Card>))}</div>)}
      <Sheet open={open} onClose={() => setOpen(false)} title="Write a complaint">
        <div className="space-y-3">
          <Field label="About"><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Title"><input className={inputCls} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} /></Field>
          <Field label="What happened"><textarea className={inputCls} rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={4000} /></Field>
          <BigButton loading={send.isPending} disabled={f.subject.length < 3 || f.body.length < 3} onClick={() => send.mutate(undefined)}>Send</BigButton>
        </div>
      </Sheet>
    </CoopPage>
  )
}

/* ───────── re-consent to a restructure ───────── */
export function ConsentsPage() {
  const { data } = useCoopQ<any[]>('consents', '/coop/consents')
  const answer = useCoopAction((v: { id: string; agree: boolean }) => post(`/coop/consents/${v.id}`, { agree: v.agree }), { success: 'Your answer was recorded' })
  return (
    <CoopPage title="Needs your answer" back="/coop">
      {!data ? <Skel /> : !data.length ? <Empty icon={<ShieldCheck className="h-7 w-7" />} title="Nothing waiting" text="No loan changes need your agreement." /> : (
        <div className="space-y-3">{data.map((c) => (
          <Card key={c.request_id}>
            <p className="font-extrabold text-green-900 dark:text-white">Change to loan {c.loan_no}</p>
            <p className="mt-1 text-sm text-green-800 dark:text-night-100">The directors want to change the repayment period from {c.old_term_months} to <b>{c.new_term_months} months</b>. {c.reason && <>Reason: {c.reason}.</>}</p>
            <p className="mt-1 text-xs text-green-700 dark:text-night-200">You are the {c.your_role === 'guarantor' ? 'guarantor' : 'borrower'}. The change happens only if everyone affected agrees.</p>
            <div className="mt-3 grid grid-cols-2 gap-2"><BigButton loading={answer.isPending} onClick={() => answer.mutate({ id: c.request_id, agree: true })}>I agree</BigButton><BigButton tone="ghost" onClick={() => answer.mutate({ id: c.request_id, agree: false })}>I do not agree</BigButton></div>
          </Card>))}</div>)}
    </CoopPage>
  )
}

/* ───────── my dividends and disputes ───────── */
export function MyDividendsPage() {
  const { data } = useCoopQ<any[]>('my-dividends', '/coop/dividends')
  const [d, setD] = useState<any>(null)
  const [body, setBody] = useState('')
  const dispute = useCoopAction(() => post(`/coop/dividends/${d.run_id}/dispute`, { body }), { success: 'Your dispute was sent', onSuccess: () => { setD(null); setBody('') } })
  return (
    <CoopPage title="My dividends" back="/coop/me">
      {!data ? <Skel /> : !data.length ? <Empty icon={<ShieldCheck className="h-7 w-7" />} title="No dividend paid yet" text="When the directors approve a year's dividend, your share appears here." /> : (
        <div className="space-y-3">{data.map((x) => (
          <Card key={x.run_id}>
            <div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-green-500 dark:text-night-300">{x.year}</p><p className="text-2xl font-extrabold text-green-900 dark:text-white">{formatNaira(x.total_kobo)}</p></div><Pill tone={x.paid_at ? 'green' : 'amber'}>{x.paid_at ? 'Paid' : 'Approved'}</Pill></div>
            {x.qualified ? <p className="mt-1 text-xs text-green-700 dark:text-night-200">Contribution share {formatNaira(x.contribution_kobo)} · guarantee share {formatNaira(x.guarantee_kobo)}</p> : <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Not qualified: {x.reason}</p>}
            {x.dispute ? <p className="mt-2 rounded-xl bg-green-100 p-2 text-sm dark:bg-night-600"><b>Your dispute ({x.dispute.status}):</b> {x.dispute.resolution ?? 'waiting for the directors'}</p>
              : x.can_dispute ? <div className="mt-3"><BigButton tone="ghost" onClick={() => setD(x)}>Something is wrong</BigButton><p className="mt-1 text-center text-[11px] text-green-600 dark:text-night-300">You can dispute until {x.dispute_deadline ? dShort(x.dispute_deadline) : 'the window closes'}.</p></div> : null}
          </Card>))}</div>)}
      <Sheet open={!!d} onClose={() => setD(null)} title="Dispute my dividend">
        <Field label="What do you think is wrong?"><textarea className={inputCls} rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} /></Field>
        <div className="mt-3"><BigButton loading={dispute.isPending} disabled={body.length < 3} onClick={() => dispute.mutate(undefined)}>Send to the directors</BigButton></div>
      </Sheet>
    </CoopPage>
  )
}

/* ───────── statement ───────── */
export function StatementPage() {
  const { data: s } = useCoopStatus()
  const thisYear = new Date(s?.now ?? Date.now()).getFullYear()
  const [year, setYear] = useState<number | null>(null)
  const y = year ?? thisYear
  const { data } = useCoopQ<any>('statement', '/coop/statement', { year: y })
  const [busy, setBusy] = useState(false)
  const download = async () => {
    setBusy(true)
    try {
      const r = await api.get('/coop/statement.pdf', { params: { year: y }, responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a'); a.href = url; a.download = `monieking-coop-statement-${y}.pdf`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { toast.error(getErrorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <CoopPage title="Statement" subtitle="Your cooperative account" back="/coop/me">
      <div className="mb-3 flex gap-2">{[thisYear, thisYear - 1].map((x) => <button key={x} onClick={() => setYear(x)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${y === x ? 'bg-green-700 text-white' : 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100'}`}>{x}</button>)}</div>
      {!data ? <Skel h="h-40" /> : (
        <>
          <Card><div className="flex justify-between text-sm"><span>Opening balance</span><b>{formatNaira(data.opening_kobo)}</b></div><div className="mt-1 flex justify-between text-sm"><span>Closing balance</span><b>{formatNaira(data.closing_kobo)}</b></div>
            <div className="mt-3"><BigButton tone="ghost" loading={busy} onClick={download}><Download className="h-4 w-4" />Download PDF</BigButton></div></Card>
          <SectionTitle>Entries</SectionTitle>
          {!data.entries.length ? <p className="text-sm text-green-700 dark:text-night-200">No entries in {y}.</p> : <div className="space-y-2">{data.entries.map((e: any, i: number) => (
            <Card key={i}><div className="flex items-center justify-between"><div><p className="text-sm font-bold capitalize text-green-900 dark:text-white">{e.type.replace(/_/g, ' ')}</p><p className="text-xs text-green-600 dark:text-night-300">{dShort(e.date)}</p></div>
              <div className="text-right"><p className={`font-extrabold ${e.delta_kobo < 0 ? 'text-red-600' : 'text-green-700 dark:text-green-300'}`}>{e.delta_kobo < 0 ? '−' : '+'}{formatNaira(Math.abs(e.delta_kobo))}</p><p className="text-[11px] text-green-600 dark:text-night-300">{formatNaira(e.balance_kobo)}</p></div></div></Card>))}</div>}
          {data.loans.length > 0 && <><SectionTitle>Loans</SectionTitle><div className="space-y-2">{data.loans.map((l: any) => <Card key={l.loan_no}><div className="flex justify-between text-sm"><b>{l.loan_no}</b><span className="capitalize">{l.status.replace(/_/g, ' ')}</span></div><p className="text-xs text-green-700 dark:text-night-200">{formatNaira(l.principal_kobo)} + {formatNaira(l.interest_kobo)} interest · paid {formatNaira(l.paid_kobo)}</p></Card>)}</div></>}
        </>)}
    </CoopPage>
  )
}
