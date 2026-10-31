import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, BadgeDollarSign, Clock, CheckCircle2, XCircle, Info } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { withPin } from '@/lib/pin'
import { formatDate, formatNaira, cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'

interface Earnings {
  earned_kobo: number; paid_out_kobo: number; pending_payout_kobo: number; available_kobo: number
  percent: number; customers: number; has_bank_details: boolean
  commissions: { id: string; customer_name: string; company_charge_kobo: number; percent: number; amount_kobo: number; created_at: string }[]
  payouts: { id: string; amount_kobo: number; status: 'pending' | 'paid' | 'rejected'; rejection_reason: string | null; requested_at: string; bank_name: string; account_number: string }[]
}

export default function OfficerEarningsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [amount, setAmount] = useState('')
  const [asking, setAsking] = useState(false)
  const [sending, setSending] = useState(false)

  const { data, isLoading, error } = useQuery({ queryKey: ['officer-earnings-me'], queryFn: async () => (await api.get<Earnings>('/officer-earnings/me')).data })

  const requestPayout = async () => {
    if (!data) return
    setSending(true)
    try {
      await withPin((pin) => api.post('/officer-earnings/me/payout', { amount_naira: amount ? Number(amount) : null, pin }),
        { title: 'Request payout', message: `Enter your PIN to request ${amount ? `₦${Number(amount).toLocaleString()}` : formatNaira(data.available_kobo)}.`, skipKyc: true })
      toast.success('Payout requested. You will be notified when it is sent.')
      setAsking(false); setAmount('')
      qc.invalidateQueries({ queryKey: ['officer-earnings-me'] })
    } catch (e) {
      const text = getErrorMessage(e)
      toast.error(text)
      if (/bank details/i.test(text)) navigate('/officer/profile')   // fails exactly like a withdrawal with no bank details: go and set them
    } finally { setSending(false) }
  }

  const stat = (label: string, kobo: number) => (
    <div className="rounded-2xl bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 p-3.5 shadow-card">
      <p className="text-[10px] font-bold uppercase tracking-wide text-green-500 dark:text-night-300">{label}</p>
      <p className="mt-0.5 text-base font-extrabold text-green-950 dark:text-white">{formatNaira(kobo)}</p>
    </div>
  )

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center"><ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" /></button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">My earnings</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {error && <p className="py-10 text-center text-sm text-red-500">{getErrorMessage(error)}</p>}
        {isLoading && <div className="h-40 animate-pulse rounded-3xl bg-white dark:bg-night-700" />}
        {data && (
          <>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-green-900 dark:bg-night-600 p-5 text-white shadow-card">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-amber-300"><BadgeDollarSign className="h-4 w-4" />Available to withdraw</p>
              <p className="mt-1 text-4xl font-extrabold">{formatNaira(data.available_kobo)}</p>
              <p className="mt-1 text-xs text-green-200">You earn {data.percent}% of the company's profit on your customers' withdrawals · {data.customers} customer{data.customers === 1 ? '' : 's'}</p>
              {!asking ? (
                <button disabled={data.available_kobo <= 0} onClick={() => setAsking(true)} className="mt-4 w-full rounded-full bg-amber-400 py-3 text-sm font-bold text-green-950 disabled:opacity-40">Request payout</button>
              ) : (
                <div className="mt-4 space-y-2">
                  <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder={`Amount in ₦ (empty = all ${formatNaira(data.available_kobo)})`}
                    className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm text-white placeholder:text-green-200 focus:outline-none focus:ring-2 focus:ring-amber-300" />
                  <div className="flex gap-2">
                    <button onClick={() => setAsking(false)} className="flex-1 rounded-full border border-white/30 py-3 text-sm font-bold">Cancel</button>
                    <button disabled={sending} onClick={requestPayout} className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-bold text-green-950 disabled:opacity-50">{sending ? 'Sending…' : 'Continue'}</button>
                  </div>
                  {!data.has_bank_details && <p className="text-xs text-amber-200">You have not set your bank details yet. Set them in your profile first, or this request will fail.</p>}
                </div>
              )}
            </motion.div>

            <div className="mt-3 grid grid-cols-3 gap-2">{stat('Earned', data.earned_kobo)}{stat('Requested', data.pending_payout_kobo)}{stat('Paid out', data.paid_out_kobo)}</div>

            <div className="mt-4 flex gap-2 rounded-2xl border border-green-100 bg-white p-3.5 text-xs text-green-800 dark:border-night-500 dark:bg-night-700 dark:text-night-100">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              <p className="leading-relaxed">Every time a withdrawal of one of your customers is paid out, the company's profit on it is shared with you. Example: a customer withdraws one full month on a ₦1,000 card, so the company collects ₦1,000. At {data.percent}% you earn {formatNaira(1000_00 * data.percent / 100)}. The more customers you have, the more you earn.</p>
            </div>

            <h2 className="mb-2 mt-5 text-sm font-extrabold text-green-900 dark:text-white">Commission history</h2>
            {data.commissions.length === 0 && <p className="rounded-2xl bg-white p-4 text-center text-xs text-green-500 dark:bg-night-700 dark:text-night-300">Nothing yet. Your commission appears here when one of your customers' withdrawals is paid.</p>}
            {data.commissions.map((c) => (
              <div key={c.id} className="mb-2 flex items-center gap-3 rounded-2xl border border-green-100 bg-white p-3.5 dark:border-night-500 dark:bg-night-700">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-green-950 dark:text-white">{c.customer_name}</p><p className="text-[11px] text-green-500 dark:text-night-300">{formatDate(c.created_at)} · {c.percent}% of {formatNaira(c.company_charge_kobo)}</p></div>
                <p className="text-sm font-extrabold text-green-700 dark:text-green-300">+{formatNaira(c.amount_kobo)}</p>
              </div>
            ))}

            {data.payouts.length > 0 && <h2 className="mb-2 mt-5 text-sm font-extrabold text-green-900 dark:text-white">Payouts</h2>}
            {data.payouts.map((p) => (
              <div key={p.id} className="mb-2 rounded-2xl border border-green-100 bg-white p-3.5 dark:border-night-500 dark:bg-night-700">
                <div className="flex items-center gap-3">
                  {p.status === 'paid' ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : p.status === 'rejected' ? <XCircle className="h-5 w-5 text-red-500" /> : <Clock className="h-5 w-5 text-amber-500" />}
                  <div className="min-w-0 flex-1"><p className="text-sm font-bold text-green-950 dark:text-white">{formatNaira(p.amount_kobo)}</p><p className="text-[11px] text-green-500 dark:text-night-300">{formatDate(p.requested_at)} · {p.bank_name} {p.account_number}</p></div>
                  <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold capitalize', p.status === 'paid' ? 'bg-green-100 text-green-800' : p.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-100 text-amber-800')}>{p.status === 'pending' ? 'Waiting' : p.status}</span>
                </div>
                {p.status === 'rejected' && p.rejection_reason && <p className="mt-2 text-xs text-red-600 dark:text-red-300">Reason: {p.rejection_reason}</p>}
              </div>
            ))}
            {user && <p className="pb-4 pt-2 text-center text-[11px] text-green-400 dark:text-night-400">Payouts go to the account in your profile ({user.account_number ? `${user.bank_name} ${user.account_number}` : 'not set'}).</p>}
          </>
        )}
      </div>
    </div>
  )
}
