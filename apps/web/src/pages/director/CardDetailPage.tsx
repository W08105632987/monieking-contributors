import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Banknote, Receipt, Scale } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, formatDateTime, cn } from '@/lib/utils'

interface Detail {
  card: { id: string; card_number: number; card_type: string; rate_kobo: number; status: string; completion_status: string | null
          total_days_contributed: number; total_contributed_kobo: number; created_at: string; completed_at: string | null; food_collected_at: string | null }
  payments: { reference: string; days: number; amount_kobo: number; method: string; contributed_by_name: string | null; created_at: string; withdrawn_days: number }[]
  withdrawals: { id: string; status: string; requested_amount_kobo: number; charge_kobo: number; sms_charge_kobo: number; net_payable_kobo: number
                 bank_name: string; account_number: string; account_name: string; requested_at: string; claimed_at: string | null
                 processed_at: string | null; rejection_reason: string | null; handled_by: string | null }[]
  disputes: { id: string; status: string; reason: string; created_at: string }[]
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700', claimed: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-600',
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-green-500 dark:text-night-200">{k}</span>
      <span className="text-green-900 dark:text-white font-semibold text-right break-words min-w-0">{v || '—'}</span>
    </div>
  )
}

export default function DirectorCardDetailPage() {
  const { customerId, cardId } = useParams()
  const nav = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['director-card-detail', customerId, cardId],
    queryFn: async () => (await api.get<Detail>(`/director-customers/${customerId}/cards/${cardId}`)).data,
    enabled: !!customerId && !!cardId,
  })

  return (
    <div className="flex min-h-dvh flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => nav(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center"><ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" /></button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Card details</h1>
      </header>
      {isLoading || !data ? (
        <div className="px-4 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}</div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-safe-nav space-y-4">
          <section className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <p className="text-green-900 dark:text-white font-extrabold">{data.card.card_type === 'food' ? 'Food card' : 'Regular card'} #{data.card.card_number}</p>
            <Line k="Status" v={data.card.food_collected_at ? 'Collected' : `${data.card.status}${data.card.completion_status ? ` · ${data.card.completion_status.replace('_', ' ')}` : ''}`} />
            <Line k="Rate" v={`${formatNaira(data.card.rate_kobo)} / day`} />
            <Line k="Days filled" v={`${data.card.total_days_contributed} / 372 (${372 - data.card.total_days_contributed} left)`} />
            <Line k="On the card now" v={formatNaira(data.card.total_contributed_kobo)} />
            <Line k="Opened" v={formatDateTime(data.card.created_at)} />
            {data.card.completed_at && <Line k="Completed" v={formatDateTime(data.card.completed_at)} />}
            {data.card.food_collected_at && <Line k="Package collected" v={formatDateTime(data.card.food_collected_at)} />}
          </section>

          <section>
            <h2 className="text-green-900 dark:text-white font-bold text-base mb-2 flex items-center gap-2"><Banknote className="w-4 h-4" /> Withdrawals ({data.withdrawals.length})</h2>
            {data.withdrawals.length === 0 ? <p className="text-sm text-green-400 dark:text-night-300">No withdrawals on this card.</p> : (
              <div className="space-y-3">
                {data.withdrawals.map(w => (
                  <div key={w.id} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-green-900 dark:text-white font-extrabold">{formatNaira(w.requested_amount_kobo)}</p>
                      <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', STATUS_COLOR[w.status] ?? 'bg-gray-100 text-gray-600')}>{w.status === 'claimed' ? 'processing' : w.status}</span>
                    </div>
                    <Line k="Charge" v={formatNaira(w.charge_kobo - (w.sms_charge_kobo || 0))} />
                    {w.sms_charge_kobo > 0 && <Line k="SMS charges" v={formatNaira(w.sms_charge_kobo)} />}
                    <Line k="Paid out" v={formatNaira(w.net_payable_kobo)} />
                    <Line k="To" v={`${w.bank_name} · ${w.account_number}`} />
                    <Line k="Account name" v={w.account_name} />
                    <Line k="Requested" v={formatDateTime(w.requested_at)} />
                    {w.claimed_at && <Line k="Picked up" v={`${formatDateTime(w.claimed_at)}${w.handled_by ? ` by ${w.handled_by}` : ''}`} />}
                    {w.processed_at && <Line k={w.status === 'rejected' ? 'Rejected' : 'Paid'} v={formatDateTime(w.processed_at)} />}
                    {w.rejection_reason && <Line k="Reason" v={w.rejection_reason} />}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-green-900 dark:text-white font-bold text-base mb-2 flex items-center gap-2"><Receipt className="w-4 h-4" /> Payments ({data.payments.length})</h2>
            {data.payments.length === 0 ? <p className="text-sm text-green-400 dark:text-night-300">Nothing paid in yet.</p> : (
              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card divide-y divide-green-50 dark:divide-night-600">
                {data.payments.map(p => (
                  <div key={p.reference} className="px-4 py-3">
                    <div className="flex justify-between"><p className="text-sm font-bold text-green-900 dark:text-white">{formatNaira(p.amount_kobo)} · {p.days} day{p.days === 1 ? '' : 's'}</p><p className="text-xs text-green-400 dark:text-night-300">{formatDateTime(p.created_at)}</p></div>
                    <p className="text-xs text-green-500 dark:text-night-200 mt-0.5">{p.method.replace(/_/g, ' ')}{p.contributed_by_name ? ` · by ${p.contributed_by_name}` : ''}{p.withdrawn_days ? ` · ${p.withdrawn_days} withdrawn` : ''}</p>
                    <p className="text-[10px] font-mono text-green-300 dark:text-night-400 break-all mt-0.5">{p.reference}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {data.disputes.length > 0 && (
            <section>
              <h2 className="text-green-900 dark:text-white font-bold text-base mb-2 flex items-center gap-2"><Scale className="w-4 h-4" /> Disputes</h2>
              <div className="space-y-2">
                {data.disputes.map(d => (
                  <button key={d.id} onClick={() => nav(`/disputes/${d.id}`)} className="w-full flex items-center justify-between bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 px-4 py-3 text-left">
                    <span className="text-sm font-semibold text-green-900 dark:text-white">{d.reason.replace(/_/g, ' ')}</span>
                    <span className="flex items-center gap-1 text-xs font-bold text-green-700 dark:text-night-100">{d.status.replace(/_/g, ' ')} <ChevronRight className="w-3.5 h-3.5" /></span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
