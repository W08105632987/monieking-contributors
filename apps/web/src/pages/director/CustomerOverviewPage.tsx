import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, Wallet, TrendingUp, TrendingDown, Coins, MoreVertical, Phone, MessageSquare, ChevronRight, Scale, UserRound } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatDate, cn } from '@/lib/utils'
import { CustomerAdminPanel } from '@/components/director/CustomerAdminPanel'
import { Avatar } from '@/components/ui/Avatar'
import { ManageMemberSheet } from '@/components/settings/ManageMemberSheet'
import type { CustomerOverview } from '@/types'

interface CustomerExtra {
  zone_name: string | null
  officer: { id: string; full_name: string; phone_number: string } | null
  is_manual_customer: boolean
  bank: { bank_name: string | null; account_number: string | null; account_name: string | null }
  next_of_kin: { name: string | null; phone: string | null }
  sms_alerts_enabled: boolean
  sms_accrued_kobo: number
  disputes: { id: string; status: string; reason: string; entity_type: string; created_at: string }[]
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide shrink-0">{k}</span>
      <span className="text-green-900 dark:text-white text-sm font-semibold text-right break-words min-w-0">{v || '—'}</span>
    </div>
  )
}

function NinReveal({ customerId, linked }: { customerId: string; linked: boolean }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ nin: string | null; last4: string | null; message: string | null } | null>(null)
  if (!linked) return <span>No NIN</span>
  if (res) return <span className="font-mono tracking-wider">{res.nin ?? (res.last4 ? `•••••••${res.last4}` : '—')}{!res.nin && res.message ? <span className="block text-[11px] font-normal text-amber-600 tracking-normal">{res.message}</span> : null}</span>
  return (
    <button disabled={busy} onClick={async () => {
      setBusy(true)
      try { setRes((await api.get(`/director-customers/${customerId}/nin`)).data) } catch (e) { toast.error(getErrorMessage(e)) } finally { setBusy(false) }
    }} className="rounded-full bg-green-900 px-3 py-1 text-xs font-bold text-white disabled:opacity-50 dark:bg-night-100 dark:text-night-900">
      {busy ? 'Opening…' : 'Reveal NIN'}
    </button>
  )
}

export default function CustomerOverviewPage() {
  const { customerId } = useParams()
  const navigate = useNavigate()
  const [managing, setManaging] = useState(false)
  const [composing, setComposing] = useState<null | 'customer' | 'kin'>(null)
  const [msg, setMsg] = useState('')
  const [alsoSms, setAlsoSms] = useState(false)

  const { data: extra } = useQuery({
    queryKey: ['customer-extra', customerId],
    queryFn: async () => (await api.get<CustomerExtra>(`/director-customers/${customerId}/extra`)).data,
    enabled: !!customerId,
  })
  const sendMsg = useMutation({
    mutationFn: () => composing === 'kin'
      ? api.post(`/director-customers/${customerId}/message-kin`, { body: msg })
      : api.post(`/director-customers/${customerId}/message`, { body: msg, also_sms: alsoSms }),
    onSuccess: () => { toast.success(composing === 'kin' ? 'SMS sent to next of kin' : 'Message sent to their notifications'); setComposing(null); setMsg(''); setAlsoSms(false) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const { data: overview, isLoading } = useQuery({
    queryKey: ['customer-overview', customerId],
    queryFn: async () => {
      const { data } = await api.get<CustomerOverview>(`/users/${customerId}/overview`)
      return data
    },
    enabled: !!customerId,
  })

  if (isLoading || !overview) {
    return (
      <div className="min-h-dvh bg-green-50 dark:bg-night-800 p-4">
        <div className="h-10 bg-green-100 dark:bg-night-600 rounded-xl animate-pulse mb-4 w-24" />
        <div className="h-24 bg-white dark:bg-night-700 rounded-2xl animate-pulse mb-4" />
        <div className="h-40 bg-white dark:bg-night-700 rounded-2xl animate-pulse mb-4" />
        <div className="h-32 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
      </div>
    )
  }

  const { profile, wallet_balance_kobo, cards } = overview
  const totalContributed = cards.reduce((s, c) => s + c.total_contributed_kobo, 0)
  const totalWithdrawn   = cards.reduce((s, c) => s + c.total_withdrawn_kobo, 0)

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Customer detail</h1>
        <button
          onClick={() => setManaging(true)}
          className="ml-auto w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center"
          aria-label="Manage customer"
        >
          <MoreVertical className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {/* Profile card */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5 mb-4 flex items-center gap-4">
          <Avatar name={profile.full_name} avatarUrl={profile.avatar_url} size={56} className="text-lg" />
          <div className="min-w-0">
            <p className="text-green-900 dark:text-white font-extrabold text-base truncate">{profile.full_name}</p>
            <p className="text-green-500 dark:text-night-200 text-sm">{profile.phone_number} · Customer #{profile.customer_number}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">Joined {formatDate(profile.created_at)}</p>
          </div>
          <span className={cn(
            'ml-auto text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0',
            profile.status === 'active' ? 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' : 'bg-red-50 dark:bg-red-900 text-red-500 dark:text-red-300',
          )}>
            {profile.status}
          </span>
        </div>

        {/* Contact actions */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <a href={`tel:${profile.phone_number}`} className="flex items-center justify-center gap-2 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm py-3 rounded-xl active:scale-95 transition-all">
            <Phone className="w-4 h-4" /> Call
          </a>
          <button onClick={() => setComposing('customer')} className="flex items-center justify-center gap-2 bg-white dark:bg-night-700 border-2 border-green-200 dark:border-night-500 text-green-800 dark:text-night-100 font-bold text-sm py-3 rounded-xl active:scale-95 transition-all">
            <MessageSquare className="w-4 h-4" /> Message
          </button>
        </div>

        <CustomerAdminPanel customerId={customerId!} name={profile.full_name} />

        {/* Everything about them */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4 divide-y divide-green-50 dark:divide-night-600">
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

        {/* Next of kin */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
          <p className="flex items-center gap-2 text-green-900 dark:text-white font-bold text-sm mb-2"><UserRound className="w-4 h-4" /> Next of kin</p>
          {extra?.next_of_kin.name || extra?.next_of_kin.phone ? (
            <>
              <Row k="Name" v={extra?.next_of_kin.name} />
              <Row k="Phone" v={extra?.next_of_kin.phone} />
              {extra?.next_of_kin.phone && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <a href={`tel:${extra.next_of_kin.phone}`} className="flex items-center justify-center gap-1.5 bg-green-100 dark:bg-night-600 text-green-800 dark:text-night-100 font-bold text-xs py-2.5 rounded-xl"><Phone className="w-3.5 h-3.5" /> Call</a>
                  <button onClick={() => setComposing('kin')} className="flex items-center justify-center gap-1.5 bg-green-100 dark:bg-night-600 text-green-800 dark:text-night-100 font-bold text-xs py-2.5 rounded-xl"><MessageSquare className="w-3.5 h-3.5" /> SMS</button>
                </div>
              )}
            </>
          ) : <p className="text-green-400 dark:text-night-300 text-sm">No next of kin on file.</p>}
        </div>

        {/* Financial summary */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-green-600 dark:text-night-200" />
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Wallet</p>
            </div>
            <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(wallet_balance_kobo)}</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-4 h-4 text-amber-500 dark:text-amber-300" />
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Cards</p>
            </div>
            <p className="text-green-900 dark:text-white text-xl font-extrabold">{cards.length}</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-600 dark:text-night-200" />
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Contributed</p>
            </div>
            <p className="text-green-900 dark:text-white text-lg font-extrabold">{formatNaira(totalContributed)}</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-red-400 dark:text-red-300" />
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Withdrawn</p>
            </div>
            <p className="text-green-900 dark:text-white text-lg font-extrabold">{formatNaira(totalWithdrawn)}</p>
          </div>
        </div>

        {/* Cards */}
        <h2 className="text-green-900 dark:text-white font-bold text-base mb-3">Contribution cards</h2>
        {cards.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card text-center py-10 px-6">
            <p className="text-green-500 dark:text-night-200 text-sm">No cards opened yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map(card => (
              <button key={card.id} onClick={() => navigate(`/director/customers/${customerId}/cards/${card.id}`)} className="block w-full text-left bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 active:scale-[0.99] transition-all">
                <div className="flex items-center justify-between mb-3">
                  <span className={cn(
                    'text-xs font-bold px-2.5 py-1 rounded-full',
                    card.card_type === 'food' ? 'bg-amber-100 dark:bg-amber-500 text-amber-700 dark:text-amber-300' : 'bg-blue-100 text-blue-700',
                  )}>
                    {card.card_type === 'food' ? 'Food Card' : 'Regular Card'}
                  </span>
                  <span className="text-green-500 dark:text-night-200 text-xs flex items-center gap-1">{card.status} <ChevronRight className="w-3.5 h-3.5" /></span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <div>
                    <p className="text-green-400 dark:text-night-300 text-xs">Contributed</p>
                    <p className="text-green-900 dark:text-white font-bold text-sm">{formatNaira(card.total_contributed_kobo)}</p>
                  </div>
                  <div>
                    <p className="text-green-400 dark:text-night-300 text-xs">Withdrawn</p>
                    <p className="text-green-900 dark:text-white font-bold text-sm">{formatNaira(card.total_withdrawn_kobo)}</p>
                  </div>
                  <div>
                    <p className="text-green-400 dark:text-night-300 text-xs">Available</p>
                    <p className="text-green-900 dark:text-white font-bold text-sm">{formatNaira(card.available_balance_kobo)}</p>
                  </div>
                </div>
                <div className="h-1.5 bg-green-50 dark:bg-night-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-600 dark:bg-night-400 rounded-full"
                    style={{ width: `${Math.min(100, (card.total_days_contributed / 372) * 100)}%` }}
                  />
                </div>
                <p className="text-green-400 dark:text-night-300 text-xs mt-1.5">
                  {card.total_days_contributed}/372 days · rate {formatNaira(card.rate_kobo)}/day
                </p>

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
        )}

        {/* Disputes */}
        <h2 className="text-green-900 dark:text-white font-bold text-base mt-6 mb-3 flex items-center gap-2"><Scale className="w-4 h-4" /> Disputes &amp; complaints</h2>
        {!extra || extra.disputes.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 text-center py-6 text-green-500 dark:text-night-200 text-sm">No disputes</div>
        ) : (
          <div className="space-y-2">
            {extra.disputes.map(d => (
              <button key={d.id} onClick={() => navigate(`/disputes/${d.id}`)} className="w-full flex items-center justify-between bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 px-4 py-3 text-left">
                <div>
                  <p className="text-green-900 dark:text-white text-sm font-semibold">{d.reason.replace(/_/g, ' ')}</p>
                  <p className="text-green-400 dark:text-night-300 text-xs">{formatDate(d.created_at)} · {d.entity_type.replace(/_/g, ' ')}</p>
                </div>
                <span className="flex items-center gap-1 text-xs font-bold text-green-700 dark:text-night-100">{d.status.replace(/_/g, ' ')} <ChevronRight className="w-3.5 h-3.5" /></span>
              </button>
            ))}
          </div>
        )}
      </div>

      {composing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setComposing(null)}>
          <div className="absolute inset-0 bg-green-950/60" />
          <div className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-5 pb-8" onClick={e => e.stopPropagation()}>
            <p className="text-green-900 dark:text-white font-extrabold text-base mb-1">{composing === 'kin' ? `SMS to ${extra?.next_of_kin.name ?? 'next of kin'}` : `Message ${profile.full_name}`}</p>
            <p className="text-green-500 dark:text-night-200 text-xs mb-3">{composing === 'kin' ? 'Sent as an SMS to their next of kin.' : 'Appears in their notifications.'}</p>
            <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4} maxLength={composing === 'kin' ? 300 : 1000} className="w-full rounded-xl border-2 border-green-100 dark:border-night-500 bg-transparent px-3 py-2 text-sm text-green-900 dark:text-white" placeholder="Type your message…" />
            {composing === 'customer' && (
              <label className="flex items-center gap-2 mt-2 text-xs font-semibold text-green-700 dark:text-night-100">
                <input type="checkbox" checked={alsoSms} onChange={e => setAlsoSms(e.target.checked)} /> Also send as SMS (free to the customer)
              </label>
            )}
            <button disabled={!msg.trim() || sendMsg.isPending} onClick={() => sendMsg.mutate()} className="w-full mt-3 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm py-3 rounded-xl disabled:opacity-50">
              {sendMsg.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {managing && (
          <ManageMemberSheet
            member={profile}
            onClose={() => setManaging(false)}
            invalidateKeys={[['customer-overview', customerId ?? ''], ['all-customers']]}
            onDeleted={() => navigate('/director/customers', { replace: true })}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
