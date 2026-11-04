import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, Wallet, TrendingUp, TrendingDown, Coins, MoreVertical, MapPin, Phone, MessageSquare, ChevronRight, Scale, UserRound, Settings2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatDate } from '@/lib/utils'
import { MoveSheet } from '@/components/director/ZoneCustomersOverview'
import { StatusTag } from '@/components/ui/StatusTag'
import { Avatar } from '@/components/ui/Avatar'
import { ManageMemberSheet } from '@/components/settings/ManageMemberSheet'
import type { CustomerOverview } from '@/types'
import { FitAmount } from '@/components/ui/FitAmount'

export interface CustomerExtra {
  zone_name: string | null
  officer: { id: string; full_name: string; phone_number: string } | null
  is_manual_customer: boolean
  bank: { bank_name: string | null; account_number: string | null; account_name: string | null }
  next_of_kin: { name: string | null; phone: string | null }
  sms_alerts_enabled: boolean
  sms_accrued_kobo: number
  disputes: { id: string; status: string; reason: string; entity_type: string; created_at: string }[]
}

export function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide shrink-0">{k}</span>
      <span className="text-green-900 dark:text-white text-sm font-semibold text-right break-words min-w-0">{v || '—'}</span>
    </div>
  )
}

export function NinReveal({ customerId, linked }: { customerId: string; linked: boolean }) {
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
  const qc = useQueryClient()
  const [managing, setManaging] = useState(false)
  const [movingZone, setMovingZone] = useState(false)
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

  const moveZone = useMutation({
    mutationFn: ({ id, ...b }: { id: string; zone_id: string; clear_commission: boolean }) => api.post('/director-zones/customers/move', { customer_ids: [id], ...b }),
    onSuccess: (r: any) => {
      toast.success(`Moved to ${r.data.zone_name}`)
      setMovingZone(false)
      qc.invalidateQueries({ queryKey: ['customer-overview', customerId] })
      qc.invalidateQueries({ queryKey: ['customer-extra', customerId] })
      qc.invalidateQueries({ queryKey: ['all-customers'] })
    },
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
          <StatusTag status={profile.status} className="ml-auto" />
        </div>

        {/* Zone: any customer, including one who registered alone, can be placed under a zone */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4 flex items-center gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-night-600 dark:text-night-100"><MapPin className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Zone</p>
            <p className="truncate text-sm font-bold text-green-900 dark:text-white">{profile.zone_name ?? (extra?.zone_name ?? 'Not in any zone')}</p>
          </div>
          <button onClick={() => setMovingZone(true)} className="flex-shrink-0 rounded-full bg-green-900 px-4 py-2 text-xs font-bold text-white dark:bg-night-100 dark:text-night-900">
            {profile.zone_id ? 'Change zone' : 'Move to a zone'}
          </button>
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
            <FitAmount className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(wallet_balance_kobo)}</FitAmount>
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

        {/* Sections: each opens its own page so this one stays light */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card divide-y divide-green-50 dark:divide-night-600 mb-4">
          {([
            { key: 'wallet', label: 'Wallet & funding history', hint: 'How the wallet was funded and every transaction', Icon: Wallet },
            { key: 'cards', label: 'Contribution cards', hint: `${cards.length} card${cards.length === 1 ? '' : 's'} and withdrawal history`, Icon: Coins },
            { key: 'details', label: 'Profile, bank & KYC', hint: 'Contact, officer, bank account, NIN, SMS alerts', Icon: UserRound },
            { key: 'disputes', label: 'Disputes & complaints', hint: extra ? `${extra.disputes.length} on record` : 'Open to view', Icon: Scale },
            { key: 'admin', label: 'Admin tools', hint: 'Phone change, name correction, deletion', Icon: Settings2 },
          ] as const).map(({ key, label, hint, Icon }) => (
            <button key={key} onClick={() => navigate(`/director/customers/${customerId}/${key}`)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-green-50/50 dark:active:bg-night-600/50">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-night-600 dark:text-night-100"><Icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-green-900 dark:text-white">{label}</span>
                <span className="block truncate text-xs text-green-500 dark:text-night-200">{hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-green-300 dark:text-night-300" />
            </button>
          ))}
        </div>
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
        {movingZone && (
          <MoveSheet count={1} currentZoneId={profile.zone_id} affiliated={!!profile.commission_officer_id} busy={moveZone.isPending}
            onClose={() => setMovingZone(false)} onMove={(zone_id, clear_commission) => moveZone.mutate({ id: profile.id, zone_id, clear_commission })} />
        )}
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
