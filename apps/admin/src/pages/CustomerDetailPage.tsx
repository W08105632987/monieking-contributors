import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ArrowLeft, Wallet, CreditCard, AlertTriangle, MapPin, BadgeCheck, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatDate, formatDateTime, initials, cn } from '@/lib/utils'
import type { CustomerFullProfile } from '@/types'

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['crm-customer', id],
    queryFn: async () => (await api.get<CustomerFullProfile>(`/admin/crm/customers/${id}/full-profile`)).data,
    enabled: !!id,
  })

  const forceResetMutation = useMutation({
    mutationFn: () => api.post(`/admin/crm/users/${id}/force-password-reset`),
    onSuccess: (res: any) => {
      const msg = res.data?.message ?? 'Password reset'
      if (res.data?.temp_password) {
        toast.success(`${msg} Temp password: ${res.data.temp_password}`, { duration: 15000 })
      } else {
        toast.success(msg)
      }
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  if (isLoading) {
    return <div className="max-w-3xl h-64 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />
  }
  if (isError || !data) {
    return <p className="text-green-500 dark:text-night-200 text-sm">Customer not found.</p>
  }

  const { profile, wallet, cards, disputes } = data

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => navigate('/customers')} className="flex items-center gap-1.5 text-green-600 dark:text-night-200 text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> Back to customers
        </button>
        <button
          onClick={() => {
            if (confirm(`Reset ${profile.full_name}'s password? A temporary password will be SMS'd to ${profile.phone_number}.`)) {
              forceResetMutation.mutate()
            }
          }}
          disabled={forceResetMutation.isPending}
          className="flex items-center gap-1.5 bg-red-50 text-red-600 font-bold text-xs rounded-xl px-3.5 py-2 disabled:opacity-50"
        >
          <KeyRound className="w-3.5 h-3.5" /> {forceResetMutation.isPending ? 'Resetting…' : 'Force password reset'}
        </button>
      </div>

      {/* Header */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-6 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-copper-400 flex items-center justify-center text-green-950 font-extrabold text-lg flex-shrink-0">
            {initials(profile.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-green-900 dark:text-white font-extrabold text-xl">{profile.full_name}</h1>
              <span className={cn(
                'text-[11px] font-bold px-2 py-0.5 rounded-full',
                profile.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500',
              )}>
                {profile.status.replace('_', ' ')}
              </span>
            </div>
            <p className="text-green-500 dark:text-night-200 text-sm mt-0.5">#{profile.customer_number} · {profile.phone_number}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-green-500 dark:text-night-200">
              <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {profile.zone_name ?? 'No zone assigned'}</span>
              <span className="flex items-center gap-1">
                <BadgeCheck className="w-3.5 h-3.5" />
                {profile.bvn_linked || profile.nin_linked ? 'ID verified' : 'ID not verified'}
              </span>
              <span>Joined {formatDate(profile.created_at)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Wallet */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-6 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-4 h-4 text-green-600 dark:text-night-200" />
          <p className="text-green-900 dark:text-white font-bold text-sm">Wallet</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-green-900 dark:text-white text-2xl font-extrabold">{formatNaira(wallet.balance_kobo)}</p>
          {wallet.virtual_account_number && (
            <p className="text-green-500 dark:text-night-200 text-xs">{wallet.virtual_account_bank} · {wallet.virtual_account_number}</p>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4 text-green-600 dark:text-night-200" />
          <p className="text-green-900 dark:text-white font-bold text-sm">Cards ({cards.length})</p>
        </div>
        {cards.length === 0 && <p className="text-green-400 dark:text-night-300 text-xs">No cards yet.</p>}
        <div className="space-y-3">
          {cards.map(card => (
            <div key={card.id} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 capitalize">{card.card_type}</span>
                  <span className="text-green-400 dark:text-night-300 text-xs capitalize">{card.status.replace('_', ' ')}</span>
                </div>
                <p className="text-green-400 dark:text-night-300 text-xs">Opened {formatDate(card.created_at)}</p>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div>
                  <p className="text-green-400 dark:text-night-300 text-[11px] uppercase font-semibold">Contributed</p>
                  <p className="text-green-900 dark:text-white font-bold text-sm">{formatNaira(card.total_contributed_kobo)}</p>
                </div>
                <div>
                  <p className="text-green-400 dark:text-night-300 text-[11px] uppercase font-semibold">Withdrawn</p>
                  <p className="text-green-900 dark:text-white font-bold text-sm">{formatNaira(card.total_withdrawn_kobo)}</p>
                </div>
                <div>
                  <p className="text-green-400 dark:text-night-300 text-[11px] uppercase font-semibold">Available</p>
                  <p className="text-green-900 dark:text-white font-bold text-sm">{formatNaira(card.available_balance_kobo)}</p>
                </div>
              </div>
              {card.withdrawal_history.length > 0 && (
                <div className="border-t border-green-50 dark:border-night-600 pt-3">
                  <p className="text-green-400 dark:text-night-300 text-[11px] uppercase font-semibold mb-2">Withdrawal history</p>
                  <div className="space-y-1.5">
                    {card.withdrawal_history.map(w => (
                      <div key={w.id} className="flex items-center justify-between text-xs">
                        <span className="text-green-600 dark:text-night-200">{formatDateTime(w.requested_at)}</span>
                        <span className="text-green-900 dark:text-white font-semibold">{formatNaira(w.requested_amount_kobo)}</span>
                        <span className={cn(
                          'font-bold px-2 py-0.5 rounded-full text-[10px] capitalize',
                          w.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-600',
                        )}>{w.status.replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Disputes */}
      {disputes.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <p className="text-green-900 dark:text-white font-bold text-sm">Disputes ({disputes.length})</p>
          </div>
          <div className="space-y-2">
            {disputes.map(d => (
              <div key={d.id} className="bg-white dark:bg-night-700 rounded-xl border border-green-100 dark:border-night-500 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-green-900 dark:text-white text-sm font-semibold capitalize">{d.reason.replace(/_/g, ' ')}</p>
                  <p className="text-green-400 dark:text-night-300 text-xs">{d.entity_type} · {formatDate(d.created_at)}</p>
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 capitalize">{d.status.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
