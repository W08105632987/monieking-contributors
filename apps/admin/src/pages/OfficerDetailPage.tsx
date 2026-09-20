import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, MapPin, Coins, ClipboardList, History, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatDate, initials, cn } from '@/lib/utils'
import type { StaffListItem, OfficerContributionStats, ZoneHistoryEntry } from '@/types'

function todayIso() { return new Date().toISOString().slice(0, 10) }

export default function OfficerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const today = todayIso()

  const { data: officer, isLoading } = useQuery({
    queryKey: ['crm-officer', id],
    queryFn: async () => (await api.get<StaffListItem>(`/users/${id}`)).data,
    enabled: !!id,
  })

  const { data: contribution } = useQuery({
    queryKey: ['crm-officer-contribution', id, today],
    queryFn: async () => (await api.get<OfficerContributionStats>(
      `/customer-stats/officer-contribution?officer_id=${id}&start_date=${today}&end_date=${today}`
    )).data,
    enabled: !!id,
  })

  const { data: history } = useQuery({
    queryKey: ['crm-officer-history', id],
    queryFn: async () => (await api.get<ZoneHistoryEntry[]>(`/users/${id}/zone-history`)).data,
    enabled: !!id,
  })

  const unassignMutation = useMutation({
    mutationFn: () => api.post(`/users/${id}/unassign-zone`),
    onSuccess: () => {
      toast.success('Officer removed from zone')
      qc.invalidateQueries({ queryKey: ['crm-officer', id] })
      qc.invalidateQueries({ queryKey: ['crm-officer-history', id] })
      qc.invalidateQueries({ queryKey: ['crm-zones'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
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

  if (isLoading || !officer) {
    return <div className="max-w-3xl h-64 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />
  }

  return (
    <div className="max-w-3xl">
      <button onClick={() => navigate('/officers')} className="flex items-center gap-1.5 text-green-600 dark:text-night-200 text-sm font-semibold mb-5">
        <ArrowLeft className="w-4 h-4" /> Back to officers
      </button>

      <div className="flex justify-end mb-3">
        <button
          onClick={() => {
            if (confirm(`Reset ${officer.full_name}'s password? A temporary password will be SMS'd to ${officer.phone_number}.`)) {
              forceResetMutation.mutate()
            }
          }}
          disabled={forceResetMutation.isPending}
          className="flex items-center gap-1.5 bg-red-50 text-red-600 font-bold text-xs rounded-xl px-3.5 py-2 disabled:opacity-50"
        >
          <KeyRound className="w-3.5 h-3.5" /> {forceResetMutation.isPending ? 'Resetting…' : 'Force password reset'}
        </button>
      </div>

      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-6 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-copper-400 flex items-center justify-center text-green-950 font-extrabold text-lg flex-shrink-0">
            {initials(officer.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-green-900 dark:text-white font-extrabold text-xl">{officer.full_name}</h1>
            <p className="text-green-500 dark:text-night-200 text-sm mt-0.5">{officer.phone_number}</p>
            <div className="flex items-center gap-3 mt-3">
              <span className="flex items-center gap-1 text-xs text-green-500 dark:text-night-200">
                <MapPin className="w-3.5 h-3.5" /> {officer.zone_name ?? 'No zone assigned'}
              </span>
              {officer.zone_id && (
                <button
                  onClick={() => unassignMutation.mutate()}
                  disabled={unassignMutation.isPending}
                  className="text-red-500 text-xs font-semibold"
                >
                  Remove from zone
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-6 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Coins className="w-4 h-4 text-green-600 dark:text-night-200" />
          <p className="text-green-900 dark:text-white font-bold text-sm">Contribution gathered today</p>
        </div>
        {contribution ? (
          <div className="flex items-end justify-between">
            <p className="text-green-900 dark:text-white text-2xl font-extrabold">{formatNaira(contribution.amount_gathered_kobo)}</p>
            <div className="flex items-center gap-1.5 text-green-500 dark:text-night-200 text-xs font-semibold">
              <ClipboardList className="w-3.5 h-3.5" /> {contribution.contribution_count} contribution{contribution.contribution_count === 1 ? '' : 's'}
            </div>
          </div>
        ) : <div className="h-8 bg-green-50 dark:bg-night-600 rounded animate-pulse" />}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-green-600 dark:text-night-200" />
          <p className="text-green-900 dark:text-white font-bold text-sm">Zone coverage history</p>
        </div>
        {!history && <div className="h-20 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />}
        {history?.length === 0 && <p className="text-green-400 dark:text-night-300 text-xs">No zone history yet.</p>}
        <div className="space-y-2">
          {history?.map(h => (
            <div key={h.id} className="bg-white dark:bg-night-700 rounded-xl border border-green-100 dark:border-night-500 px-4 py-3 flex items-center justify-between text-sm">
              <div>
                <p className="text-green-900 dark:text-white font-semibold">{h.zone_name ?? 'Unknown zone'}</p>
                <p className="text-green-400 dark:text-night-300 text-xs">
                  {formatDate(h.started_at)} — {h.ended_at ? formatDate(h.ended_at) : 'Present'}
                  {h.assigned_by_director_name && ` · assigned by ${h.assigned_by_director_name}`}
                </p>
              </div>
              <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', h.ended_at ? 'bg-green-50 text-green-500' : 'bg-green-100 text-green-700')}>
                {h.ended_at ? 'Past' : 'Current'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
