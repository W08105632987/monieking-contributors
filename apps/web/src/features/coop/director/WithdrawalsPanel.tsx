import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Search, SlidersHorizontal, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatNaira } from '@/lib/utils'
import { post, postIdem, useCoopAction } from '../api'
import { newKey, useAuthPrompt } from '../auth'
import { BigButton, Card, Empty, Field, Pill, Sheet, Skel, dShort, inputCls, toKobo } from '../ui'
import { WD_TONE } from '../pages/WithdrawalsPage'
import { useAdmin } from './dapi'

const PAGE = 10
const STATUSES: [string, string][] = [['pending', 'To pay'], ['paid', 'Paid'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['all', 'All']]
const chip = (on: boolean) => `flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${on ? 'bg-green-700 text-white' : 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100'}`

/** Member withdrawal requests: the director sends the money by bank transfer, then records it here (or rejects it). */
export function WithdrawalsPanel({ stepUp }: { stepUp: boolean }) {
  const [status, setStatus] = useState('pending')
  const [qIn, setQIn] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  useEffect(() => { const t = setTimeout(() => { setQ(qIn); setPage(0) }, 350); return () => clearTimeout(t) }, [qIn])
  const params = { status, q: q || undefined, limit: PAGE, offset: page * PAGE, date_from: from || undefined, date_to: to || undefined,
    min_kobo: min ? toKobo(min) : undefined, max_kobo: max ? toKobo(max) : undefined }
  const { data, error, refetch } = useAdmin<any>('withdrawals', '/coop/admin/withdrawals', params)
  const [sel, setSel] = useState<any>(null)
  const [ref, setRef] = useState('')
  const [ev, setEv] = useState('')
  const [note, setNote] = useState('')
  const done = () => { setSel(null); setRef(''); setEv(''); setNote('') }
  const { ask, sheet } = useAuthPrompt()
  const pay = useCoopAction(async (id: string) => {
    const auth = await ask(stepUp)
    if (auth === null) throw new Error('Cancelled')
    return postIdem(`/coop/admin/withdrawals/${id}/pay`, { reference: ref, evidence: ev, ...(auth ? { auth } : {}) }, newKey())
  }, { success: 'Marked as paid. The member has been told.', onSuccess: done })
  const reject = useCoopAction((id: string) => post(`/coop/admin/withdrawals/${id}/reject`, { note }), { success: 'Rejected. The money went back to the member.', onSuccess: done })
  const clear = useCoopAction((id: string) => post(`/coop/admin/withdrawals/${id}/clear-hold`, { note }), { success: 'Hold cleared', onSuccess: done })
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const activeFilters = [from, to, min, max].filter(Boolean).length
  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast.success('Copied') }
  return (
    <div>
      {sheet}
      <div className="mb-2 flex gap-2">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-green-500" />
          <input value={qIn} onChange={(e) => setQIn(e.target.value)} placeholder="Search name, phone or card" aria-label="Search withdrawals" className={`${inputCls} pl-9`} /></div>
        <button onClick={() => setFilters(true)} aria-label="Filters" className="relative flex h-[46px] w-[46px] items-center justify-center rounded-xl border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100"><SlidersHorizontal className="h-5 w-5" />
          {activeFilters > 0 && <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-700 text-[10px] font-bold text-white">{activeFilters}</span>}</button>
      </div>
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">{STATUSES.map(([k, l]) => (
        <button key={k} onClick={() => { setStatus(k); setPage(0) }} className={chip(status === k)}>{l}{data?.counts && k !== 'all' && data.counts[k] ? ` (${data.counts[k]})` : ''}</button>))}</div>
      {error && !data ? <p className="text-sm text-red-600">Could not load. <button className="underline" onClick={() => refetch()}>Try again</button></p> : !data ? <Skel h="h-40" /> : !data.items.length ? (
        <Empty icon={<Wallet className="h-7 w-7" />} title="Nothing here" text={q || activeFilters ? 'No withdrawal matches your search or filters.' : 'Withdrawal requests from members appear here.'} />
      ) : (
        <div className="space-y-3">{data.items.map((w: any) => { const t = WD_TONE[w.status]; return (
          <Card key={w.id}>
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-semibold text-green-500 dark:text-night-300">{w.card_no} · {dShort(w.created_at)}</p><p className="truncate font-extrabold text-green-900 dark:text-white">{w.member}</p><p className="text-xs text-green-600 dark:text-night-300">{w.phone}</p></div>
              <Pill tone={t.tone}>{t.label}</Pill></div>
            <div className="mt-3 rounded-xl bg-green-100/70 p-3 text-sm dark:bg-night-600">
              <p className="flex justify-between"><span>Member asked for</span><b>{formatNaira(w.amount_kobo)}</b></p>
              <p className="flex justify-between"><span>Early withdrawal charge</span><b>− {formatNaira(w.charge_kobo)}</b></p>
              <p className="flex justify-between border-t border-green-200 pt-1 dark:border-night-500"><span className="font-bold">{w.status === 'paid' ? 'Sent' : 'Send'}</span><b>{formatNaira(w.net_kobo)}</b></p></div>
            {w.account && <div className="mt-2 flex items-start justify-between gap-2 text-sm text-green-800 dark:text-night-100"><p>{w.account.account_name} · {w.account.bank_name} · <b>{w.account.account_number}</b></p>
              <button onClick={() => copy(w.account.account_number)} aria-label="Copy account number" className="flex-shrink-0 rounded-full border border-green-200 p-1.5 dark:border-night-400"><Copy className="h-3.5 w-3.5" /></button></div>}
            {w.hold_reason && w.status === 'pending' && <p className="mt-1 text-xs font-semibold text-red-600">{w.hold_reason}</p>}
            {w.status === 'paid' && <p className="mt-2 text-xs font-semibold text-green-700 dark:text-green-300">Paid {w.decided_at ? dShort(w.decided_at) : ''}{w.reference ? ` · ref ${w.reference}` : ''}</p>}
            {w.status === 'rejected' && <p className="mt-2 text-xs text-red-700 dark:text-red-300">Rejected: {w.reason}</p>}
            {w.status === 'pending' && (data.can_send ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <BigButton onClick={() => setSel({ ...w, mode: 'pay' })} disabled={!!w.hold_reason}>Record paid</BigButton>
                <BigButton tone="ghost" onClick={() => setSel({ ...w, mode: 'reject' })}>Reject</BigButton>
                {w.hold_reason && <div className="col-span-2"><BigButton tone="ghost" onClick={() => setSel({ ...w, mode: 'clear' })}>Clear hold</BigButton></div>}
              </div>) : <p className="mt-3 text-xs text-green-600 dark:text-night-300">Only the Treasurer sends money. You can still reject.</p>)}
            {w.status === 'pending' && !data.can_send && <div className="mt-2"><BigButton tone="ghost" onClick={() => setSel({ ...w, mode: 'reject' })}>Reject</BigButton></div>}
          </Card>) })}
          <div className="flex items-center justify-between text-sm">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="flex h-9 items-center gap-1 rounded-full border border-green-200 px-3 font-bold text-green-800 disabled:opacity-40 dark:border-night-400 dark:text-night-100"><ChevronLeft className="h-4 w-4" />Previous</button>
            <span className="text-xs font-semibold text-green-700 dark:text-night-200">Page {page + 1} of {pages} · {total} in all</span>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="flex h-9 items-center gap-1 rounded-full border border-green-200 px-3 font-bold text-green-800 disabled:opacity-40 dark:border-night-400 dark:text-night-100">Next<ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>)}

      <Sheet open={filters} onClose={() => setFilters(false)} title="Filter withdrawals">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From date"><input type="date" className={inputCls} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} /></Field>
          <Field label="To date"><input type="date" className={inputCls} value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} /></Field>
          <Field label="At least (₦)"><input inputMode="numeric" className={inputCls} value={min} onChange={(e) => { setMin(e.target.value.replace(/\D/g, '')); setPage(0) }} /></Field>
          <Field label="At most (₦)"><input inputMode="numeric" className={inputCls} value={max} onChange={(e) => { setMax(e.target.value.replace(/\D/g, '')); setPage(0) }} /></Field>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2"><BigButton tone="ghost" onClick={() => { setFrom(''); setTo(''); setMin(''); setMax('') }}>Clear</BigButton><BigButton onClick={() => setFilters(false)}>Show results</BigButton></div>
      </Sheet>
      <Sheet open={sel?.mode === 'pay'} onClose={() => setSel(null)} title={`Send ${sel ? formatNaira(sel.net_kobo) : ''}`}>
        <p className="mb-3 text-sm text-green-700 dark:text-night-200">Send this to {sel?.account?.account_name} ({sel?.account?.bank_name} {sel?.account?.account_number}) from the cooperative account, then record the transfer here.</p>
        <div className="space-y-3"><Field label="Bank transfer reference"><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <Field label={data?.evidence_required ? 'Evidence (receipt link or note)' : 'Evidence (optional)'}><input className={inputCls} value={ev} onChange={(e) => setEv(e.target.value)} /></Field>
          <BigButton loading={pay.isPending} disabled={!ref.trim() || (data?.evidence_required && !ev.trim())} onClick={() => pay.mutate(sel.id)}>I have sent it</BigButton></div>
      </Sheet>
      <Sheet open={sel?.mode === 'reject'} onClose={() => setSel(null)} title="Reject this withdrawal">
        <p className="mb-3 text-sm text-green-700 dark:text-night-200">The money goes straight back to the member's contribution and they see your reason.</p>
        <Field label="Reason (the member will see this)"><textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="mt-3"><BigButton tone="red" loading={reject.isPending} disabled={note.trim().length < 3} onClick={() => reject.mutate(sel.id)}>Reject and return the money</BigButton></div>
      </Sheet>
      <Sheet open={sel?.mode === 'clear'} onClose={() => setSel(null)} title="Clear the hold">
        <Field label="Why is it safe to send?"><textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="mt-3"><BigButton loading={clear.isPending} disabled={note.trim().length < 3} onClick={() => clear.mutate(sel.id)}>Clear hold</BigButton></div>
      </Sheet>
    </div>
  )
}
