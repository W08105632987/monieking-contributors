import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeDollarSign, Banknote, Search, UserMinus, UserPlus } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { formatDate, formatNaira } from '@/lib/utils'
import type { User } from '@/types'
import { Notice, PinField } from './DirectorModal'
import { OfficerTypeModal } from './OfficerTypeModal'

interface Earnings {
  id: string; officer_type: 'salary' | 'affiliated' | null
  earned_kobo?: number; paid_out_kobo?: number; pending_payout_kobo?: number; available_kobo?: number
  percent?: number; own_percent?: number | null; customers?: number; has_bank_details?: boolean
  commissions?: { id: string; customer_name: string; company_charge_kobo: number; percent: number; amount_kobo: number; created_at: string }[]
  payouts?: { id: string; amount_kobo: number; status: string; requested_at: string }[]
}

/** Director's view of how an officer is paid: type, rate, earnings, and which customers earn them commission. */
export function OfficerCommissionPanel({ officer }: { officer: User }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [typeOpen, setTypeOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [term, setTerm] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const { data: e } = useQuery({ queryKey: ['officer-earnings', officer.id], queryFn: async () => (await api.get<Earnings>(`/officer-earnings/officers/${officer.id}`)).data })
  const affiliated = e?.officer_type === 'affiliated'
  const { data: customers = [] } = useQuery({
    queryKey: ['officer-commission-customers', officer.id], enabled: affiliated,
    queryFn: async () => (await api.get<{ id: string; full_name: string; phone_number: string }[]>(`/officer-earnings/officers/${officer.id}/customers`)).data,
  })
  const { data: found = [] } = useQuery({
    queryKey: ['commission-customer-search', term], enabled: affiliated && term.trim().length >= 2,
    queryFn: async () => (await api.get<User[]>(`/users?role=customer&page_size=8&search=${encodeURIComponent(term.trim())}`)).data,
  })

  const assign = async (customerId: string, to: string | null) => {
    setMsg(null)
    try {
      await api.put(`/officer-earnings/customers/${customerId}/commission-officer`, { officer_id: to, pin })
      setPin(''); qc.invalidateQueries({ queryKey: ['officer-commission-customers', officer.id] }); qc.invalidateQueries({ queryKey: ['officer-earnings', officer.id] })
      setMsg({ kind: 'ok', text: to ? 'Customer assigned.' : 'Customer removed.' })
    } catch (err) { setMsg({ kind: 'error', text: getErrorMessage(err) }) }
  }
  const mine = new Set(customers.map((c) => c.id))
  const stat = (label: string, value: string) => (
    <div className="rounded-xl bg-green-50 dark:bg-night-600 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">{label}</p><p className="text-base font-extrabold text-green-950 dark:text-white">{value}</p></div>
  )

  return (
    <div className="mb-4 rounded-2xl border border-green-100 bg-white p-4 shadow-card dark:border-night-500 dark:bg-night-700">
      <div className="mb-3 flex items-center gap-2">
        {affiliated ? <BadgeDollarSign className="h-4 w-4 text-green-600 dark:text-night-200" /> : <Banknote className="h-4 w-4 text-green-600 dark:text-night-200" />}
        <p className="flex-1 text-sm font-bold text-green-900 dark:text-white">How they are paid</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${e?.officer_type ? 'bg-green-100 text-green-800 dark:bg-night-600 dark:text-night-100' : 'bg-amber-100 text-amber-800'}`}>
          {!e ? '…' : e.officer_type === 'affiliated' ? 'Affiliated' : e.officer_type === 'salary' ? 'Salary' : 'Not chosen yet'}
        </span>
      </div>
      <button onClick={() => setTypeOpen(true)} className="mb-3 w-full rounded-xl bg-green-900 py-2.5 text-xs font-bold text-white dark:bg-night-100 dark:text-night-900">
        {e?.officer_type ? 'Change type or rate' : 'Choose salary or affiliated'}
      </button>

      {affiliated && e && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {stat('Available to pay', formatNaira(e.available_kobo ?? 0))}
            {stat('Payout requested', formatNaira(e.pending_payout_kobo ?? 0))}
            {stat('Paid out so far', formatNaira(e.paid_out_kobo ?? 0))}
            {stat('Earned in total', formatNaira(e.earned_kobo ?? 0))}
          </div>
          <p className="mt-3 text-xs text-green-700 dark:text-night-200">
            Rate: <b>{e.percent}%</b> {e.own_percent != null ? '(their own rate)' : '(the company rate from Business Settings)'} · {e.customers ?? 0} customer{e.customers === 1 ? '' : 's'} earn them commission
            {!e.has_bank_details && ' · no bank details set yet'}
          </p>
          {(e.pending_payout_kobo ?? 0) > 0 && <button onClick={() => nav('/director/officer-payouts')} className="mt-2 text-xs font-bold text-green-800 underline underline-offset-2 dark:text-night-100">Open payout requests</button>}

          <p className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-green-600 dark:text-night-300">Customers who earn them commission</p>
          <PinField value={pin} onChange={setPin} label="Your PIN (needed to add or remove customers)" />
          {msg && <div className="mt-2"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
          <div className="mt-2 divide-y divide-green-50 dark:divide-night-600">
            {customers.length === 0 && <p className="py-2 text-xs text-green-500 dark:text-night-300">No customers yet. Search below to add some.</p>}
            {customers.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-2">
                <span className="flex-1 min-w-0"><span className="block truncate text-sm font-semibold text-green-950 dark:text-white">{c.full_name}</span><span className="block text-[11px] text-green-500 dark:text-night-300">{c.phone_number}</span></span>
                <button disabled={pin.length < 4} onClick={() => assign(c.id, null)} className="flex items-center gap-1 rounded-full border border-red-200 px-3 py-1.5 text-[11px] font-bold text-red-600 disabled:opacity-40 dark:border-red-900 dark:text-red-300"><UserMinus className="h-3.5 w-3.5" />Remove</button>
              </div>
            ))}
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-green-400" />
            <input value={term} onChange={(ev) => setTerm(ev.target.value)} placeholder="Search a customer to add" className="w-full rounded-xl border border-green-200 bg-white py-2.5 pl-9 pr-3 text-sm text-green-950 dark:border-night-500 dark:bg-night-800 dark:text-white" />
          </div>
          {found.filter((u) => !mine.has(u.id)).map((u) => (
            <div key={u.id} className="flex items-center gap-2 border-b border-green-50 py-2 last:border-0 dark:border-night-600">
              <span className="flex-1 min-w-0"><span className="block truncate text-sm font-semibold text-green-950 dark:text-white">{u.full_name}</span><span className="block text-[11px] text-green-500 dark:text-night-300">{u.phone_number}{u.commission_officer_id ? ' · earns for another officer now' : ''}</span></span>
              <button disabled={pin.length < 4} onClick={() => assign(u.id, officer.id)} className="flex items-center gap-1 rounded-full bg-green-700 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"><UserPlus className="h-3.5 w-3.5" />Assign</button>
            </div>
          ))}

          {(e.commissions?.length ?? 0) > 0 && (
            <>
              <p className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-green-600 dark:text-night-300">Recent commission</p>
              {e.commissions!.slice(0, 8).map((c) => (
                <div key={c.id} className="flex justify-between gap-2 py-1.5 text-xs"><span className="min-w-0 truncate text-green-800 dark:text-night-100">{c.customer_name} · {formatDate(c.created_at)}</span><b className="shrink-0 text-green-700 dark:text-green-300">+{formatNaira(c.amount_kobo)}</b></div>
              ))}
            </>
          )}
        </>
      )}
      <OfficerTypeModal open={typeOpen} officer={{ id: officer.id, full_name: officer.full_name, officer_type: e?.officer_type ?? null }} onClose={() => setTypeOpen(false)} />
    </div>
  )
}
