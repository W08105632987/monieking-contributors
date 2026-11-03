import { useState } from 'react'
import { ask } from '@/lib/dialog'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Phone, Calendar, History, ChevronRight, X, Users, Banknote, TrendingUp, BarChart3, Settings2, Wallet } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatDate, formatNaira } from '@/lib/utils'
import { FitAmount } from '@/components/ui/FitAmount'
import { Avatar } from '@/components/ui/Avatar'
import type { User, Zone } from '@/types'

export default function OfficerDetailPage() {
  const { officerId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showZonePicker, setShowZonePicker] = useState(false)
  const { data: officer, isLoading } = useQuery({
    queryKey: ['officer', officerId],
    queryFn: async () => { const { data } = await api.get<User>(`/users/${officerId}`); return data },
    enabled: !!officerId,
  })

  const { data: zones = [] } = useQuery({
    queryKey: ['zones'],
    queryFn: async () => { const { data } = await api.get<Zone[]>('/zones'); return data },
  })

  const { data: walletInfo } = useQuery({
    queryKey: ['officer-wallet-summary', officerId],
    queryFn: async () => (await api.get<{ wallet_balance_kobo: number; is_frozen: boolean; commission_balance_kobo: number }>(`/users/${officerId}/wallet-summary`)).data,
    enabled: !!officerId,
  })

  const currentZone = zones.find(z => z.id === officer?.zone_id)

  const assignMutation = useMutation({
    mutationFn: (zoneId: string) => api.post(`/zones/${zoneId}/assign`, { officer_id: officer!.id }),
    onSuccess: (res: any) => {
      toast.success(res.data?.message ?? 'Zone updated')
      qc.invalidateQueries({ queryKey: ['officer', officerId] })
      qc.invalidateQueries({ queryKey: ['zones'] })
      qc.invalidateQueries({ queryKey: ['officer-zone-history', officerId] })
      setShowZonePicker(false)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const unassignMutation = useMutation({
    mutationFn: () => api.post(`/users/${officer!.id}/unassign-zone`),
    onSuccess: (res: any) => {
      toast.success(res.data?.message ?? 'Removed from zone')
      qc.invalidateQueries({ queryKey: ['officer', officerId] })
      qc.invalidateQueries({ queryKey: ['zones'] })
      qc.invalidateQueries({ queryKey: ['officer-zone-history', officerId] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  if (isLoading || !officer) {
    return (
      <div className="min-h-dvh bg-green-50 dark:bg-night-800 p-4">
        <div className="h-10 bg-green-100 dark:bg-night-600 rounded-xl animate-pulse mb-4 w-24" />
        <div className="h-24 bg-white dark:bg-night-700 rounded-2xl animate-pulse mb-4" />
        <div className="h-32 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Officer</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {/* Profile card */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4 flex items-center gap-3">
          <Avatar name={officer.full_name} avatarUrl={officer.avatar_url} size={56} />
          <div className="min-w-0">
            <p className="text-green-900 dark:text-white font-extrabold text-base truncate">{officer.full_name}</p>
            <p className="text-green-500 dark:text-night-200 text-sm flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {officer.phone_number}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Joined {formatDate(officer.created_at)} · Officer #{officer.customer_number}
            </p>
          </div>
        </div>

        {/* Wallet */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase mb-2 flex items-center gap-1.5"><Wallet className="w-4 h-4" /> Wallet balance</p>
            {walletInfo ? <FitAmount className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(walletInfo.wallet_balance_kobo)}</FitAmount> : <div className="h-7 w-24 rounded bg-green-100 dark:bg-night-600 animate-pulse" />}
            {walletInfo?.is_frozen && <p className="mt-1 text-[11px] font-bold text-red-500">Frozen</p>}
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase mb-2 flex items-center gap-1.5"><Banknote className="w-4 h-4" /> Commission</p>
            {walletInfo ? <FitAmount className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(walletInfo.commission_balance_kobo)}</FitAmount> : <div className="h-7 w-24 rounded bg-green-100 dark:bg-night-600 animate-pulse" />}
          </div>
        </div>

        {/* Current zone */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-4 h-4 text-green-600 dark:text-night-200" />
            <p className="text-green-900 dark:text-white font-bold text-sm">Current zone</p>
          </div>
          {currentZone ? (
            <div className="flex items-center justify-between bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2.5 mb-3">
              <div>
                <p className="text-green-900 dark:text-white text-sm font-semibold">{currentZone.name}</p>
                <p className="text-green-400 dark:text-night-300 text-xs">Customers here follow whoever covers this zone</p>
              </div>
            </div>
          ) : (
            <p className="text-amber-600 dark:text-amber-300 text-xs bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2.5 mb-3">
              Not currently assigned to any zone — can't manage any customers until assigned.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setShowZonePicker(true)}
              className="flex-1 bg-green-900 dark:bg-night-100 text-white font-bold text-xs rounded-xl py-2.5"
            >
              {currentZone ? 'Reassign zone' : 'Assign a zone'}
            </button>
            {currentZone && (
              <button
                onClick={async () => { if (await ask(`${currentZone.name} will become uncovered.`, { title: `Remove ${officer.full_name}?`, tone: 'danger', confirmLabel: 'Remove' })) unassignMutation.mutate() }}
                disabled={unassignMutation.isPending}
                className="flex-1 border-2 border-red-200 dark:border-red-900 text-red-500 dark:text-red-300 font-bold text-xs rounded-xl py-2.5 disabled:opacity-40"
              >
                {unassignMutation.isPending ? 'Removing…' : 'Remove from zone'}
              </button>
            )}
          </div>
        </div>

        {/* Each section opens on its own page so this one stays light */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card divide-y divide-green-50 dark:divide-night-600 mb-4">
          {([
            { key: 'customers', label: 'Zone customers', hint: 'Everyone in their zone, analytics and moves', Icon: Users },
            { key: 'pay', label: 'Pay & commission', hint: officer.officer_type === 'affiliated' ? 'Affiliated, earns commission' : officer.officer_type === 'salary' ? 'Salary' : 'Not chosen yet', Icon: Banknote },
            { key: 'contributions', label: 'Contributions gathered', hint: 'Day, week or custom range', Icon: TrendingUp },
            { key: 'stats', label: 'Customer statistics', hint: 'Scoped to their zone', Icon: BarChart3 },
            { key: 'history', label: 'Coverage history', hint: 'Zones they have covered over time', Icon: History },
            { key: 'admin', label: 'Admin tools', hint: 'Reset password, PIN, withdrawal password', Icon: Settings2 },
          ] as const).map(({ key, label, hint, Icon }) => (
            <button key={key} onClick={() => navigate(`/director/officers/${officerId}/${key}`)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-green-50/50 dark:active:bg-night-600/50">
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

      {showZonePicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowZonePicker(false)}>
          <div className="absolute inset-0 bg-green-950/60 dark:bg-night-900/60" />
          <div className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-5 pb-8 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-green-900 dark:text-white font-extrabold text-base">Choose a zone</p>
              <button onClick={() => setShowZonePicker(false)}><X className="w-5 h-5 text-green-400 dark:text-night-300" /></button>
            </div>
            {zones.length === 0 ? (
              <p className="text-green-400 dark:text-night-300 text-sm text-center py-4">No zones yet — create one from Business Settings.</p>
            ) : (
              <div className="space-y-2">
                {zones.map(z => {
                  const isTaken = z.officer_count > 0 && z.id !== officer.zone_id
                  return (
                    <button
                      key={z.id}
                      onClick={() => assignMutation.mutate(z.id)}
                      disabled={assignMutation.isPending || z.id === officer.zone_id}
                      className="w-full flex items-center justify-between bg-green-50 dark:bg-night-600 rounded-xl px-3 py-3 text-left disabled:opacity-50"
                    >
                      <div>
                        <p className="text-green-900 dark:text-white text-sm font-semibold">{z.name}</p>
                        {isTaken && <p className="text-amber-600 dark:text-amber-300 text-xs">Currently covered — assigning here will unassign them</p>}
                        {z.id === officer.zone_id && <p className="text-green-400 dark:text-night-300 text-xs">Already assigned here</p>}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
