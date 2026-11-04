import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatNaira, formatDate, cn } from '@/lib/utils'
import { CustomerAdminPanel } from '@/components/director/CustomerAdminPanel'
import { WalletHistoryPanel } from '@/components/director/WalletHistoryPanel'
import type { CustomerOverview } from '@/types'
import { useGoBack } from '@/hooks/useGoBack'
import { Row, NinReveal, type CustomerExtra } from './CustomerOverviewPage'

const TITLES = {
  wallet: 'Wallet & funding history',
  cards: 'Contribution cards',
  details: 'Profile, bank & KYC',
  disputes: 'Disputes & complaints',
  admin: 'Admin tools',
} as const
type Section = keyof typeof TITLES

const box = 'bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card'

export default function CustomerSectionPage() {
  const { customerId, section } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack(`/director/customers/${customerId}`)
  const valid = !!section && section in TITLES
  const key = section as Section

  const { data: overview } = useQuery({
    queryKey: ['customer-overview', customerId],
    queryFn: async () => (await api.get<CustomerOverview>(`/users/${customerId}/overview`)).data,
    enabled: !!customerId && valid,
  })
  const { data: extra } = useQuery({
    queryKey: ['customer-extra', customerId],
    queryFn: async () => (await api.get<CustomerExtra>(`/director-customers/${customerId}/extra`)).data,
    enabled: !!customerId && valid && (key === 'details' || key === 'disputes'),
  })

  if (!valid) return <Navigate to={`/director/customers/${customerId}`} replace />
  const profile = overview?.profile
  const cards = overview?.cards ?? []

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={goBack} aria-label="Back" className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-green-900 dark:text-white font-extrabold text-lg leading-tight">{TITLES[key]}</h1>
          {profile && <p className="truncate text-xs text-green-500 dark:text-night-200">{profile.full_name}</p>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {key === 'wallet' && <WalletHistoryPanel customerId={customerId!} />}

        {key === 'admin' && (profile
          ? <CustomerAdminPanel customerId={customerId!} name={profile.full_name} />
          : <div className={cn(box, 'h-32 animate-pulse')} />)}

        {key === 'details' && profile && (
          <div className={cn(box, 'p-4 divide-y divide-green-50 dark:divide-night-600')}>
            <Row k="Phone" v={profile.phone_number} />
            <Row k="Email" v={profile.email} />
            <Row k="Zone" v={extra?.zone_name} />
            <Row k="Officer" v={extra?.officer ? (
              <span>{extra.officer.full_name} · <a className="underline" href={`tel:${extra.officer.phone_number}`}>{extra.officer.phone_number}</a></span>
            ) : null} />
            <Row k="Type" v={extra?.is_manual_customer ? 'Officer-managed (cash)' : 'Self-service (app)'} />
            <Row k="Bank" v={extra?.bank.bank_name ? `${extra.bank.bank_name} · ${extra.bank.account_number}` : null} />
            <Row k="Account name" v={extra?.bank.account_name} />
            <Row k="NIN" v={<NinReveal customerId={customerId!} linked={!!profile.nin_linked} />} />
            <Row k="SMS alerts" v={extra ? (extra.sms_alerts_enabled ? 'On' : 'Off') : null} />
            {extra && extra.sms_accrued_kobo > 0 && <Row k="SMS charges owed" v={formatNaira(extra.sms_accrued_kobo)} />}
          </div>
        )}

        {key === 'cards' && (cards.length === 0 ? (
          <div className={cn(box, 'text-center py-10 px-6 text-green-500 dark:text-night-200 text-sm')}>No cards opened yet</div>
        ) : (
          <div className="space-y-3">
            {cards.map(card => (
              <button key={card.id} onClick={() => navigate(`/director/customers/${customerId}/cards/${card.id}`)} className={cn(box, 'block w-full text-left p-4 active:scale-[0.99] transition-all')}>
                <div className="flex items-center justify-between mb-3">
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', card.card_type === 'food' ? 'bg-amber-100 dark:bg-amber-500 text-amber-700 dark:text-amber-300' : 'bg-blue-100 text-blue-700')}>
                    {card.card_type === 'food' ? 'Food Card' : 'Regular Card'}
                  </span>
                  <span className="text-green-500 dark:text-night-200 text-xs flex items-center gap-1">{card.status} <ChevronRight className="w-3.5 h-3.5" /></span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  {[['Contributed', card.total_contributed_kobo], ['Withdrawn', card.total_withdrawn_kobo], ['Available', card.available_balance_kobo]].map(([l, v]) => (
                    <div key={l as string} className="min-w-0">
                      <p className="text-green-400 dark:text-night-300 text-xs">{l}</p>
                      <p className="text-green-900 dark:text-white font-bold text-sm truncate">{formatNaira(v as number)}</p>
                    </div>
                  ))}
                </div>
                <div className="h-1.5 bg-green-50 dark:bg-night-600 rounded-full overflow-hidden">
                  <div className="h-full bg-green-600 dark:bg-night-400 rounded-full" style={{ width: `${Math.min(100, (card.total_days_contributed / 372) * 100)}%` }} />
                </div>
                <p className="text-green-400 dark:text-night-300 text-xs mt-1.5">{card.total_days_contributed}/372 days · rate {formatNaira(card.rate_kobo)}/day</p>
                {card.withdrawal_history.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-green-50 dark:border-night-600">
                    <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase mb-2">Withdrawal history</p>
                    {card.withdrawal_history.map(w => (
                      <div key={w.id} className="flex items-center justify-between text-xs py-1">
                        <span className="text-green-600 dark:text-night-200">{formatDate(w.requested_at)} · {w.status}</span>
                        <span className="text-green-900 dark:text-white font-semibold">{formatNaira(w.net_payable_kobo)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        ))}

        {key === 'disputes' && (!extra || extra.disputes.length === 0 ? (
          <div className={cn(box, 'text-center py-6 text-green-500 dark:text-night-200 text-sm')}>{extra ? 'No disputes' : 'Loading…'}</div>
        ) : (
          <div className="space-y-2">
            {extra.disputes.map(d => (
              <button key={d.id} onClick={() => navigate(`/disputes/${d.id}`)} className={cn(box, 'w-full flex items-center justify-between px-4 py-3 text-left')}>
                <div className="min-w-0">
                  <p className="text-green-900 dark:text-white text-sm font-semibold truncate">{d.reason.replace(/_/g, ' ')}</p>
                  <p className="text-green-400 dark:text-night-300 text-xs">{formatDate(d.created_at)} · {d.entity_type.replace(/_/g, ' ')}</p>
                </div>
                <span className="flex items-center gap-1 text-xs font-bold text-green-700 dark:text-night-100 flex-shrink-0">{d.status.replace(/_/g, ' ')} <ChevronRight className="w-3.5 h-3.5" /></span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
