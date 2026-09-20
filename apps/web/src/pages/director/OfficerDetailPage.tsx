import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Phone, Calendar, History, ChevronRight, X } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatDate, formatDateTime, cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { CustomerStatsPanel } from '@/components/dashboard/CustomerStatsPanel'
import { OfficerContributionCard } from '@/components/dashboard/OfficerContributionCard'
import type { User, Zone, ZoneAssignmentHistory } from '@/types'

export default function OfficerDetailPage() {
  const { officerId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showZonePicker, setShowZonePicker] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyStart, setHistoryStart] = useState('')
  const [historyEnd, setHistoryEnd] = useState('')

  const { data: officer, isLoading } = useQuery({
    queryKey: ['officer', officerId],
    queryFn: async () => { const { data } = await api.get<User>(`/users/${officerId}`); return data },
    enabled: !!officerId,
  })

  const { data: zones = [] } = useQuery({
    queryKey: ['zones'],
    queryFn: async () => { const { data } = await api.get<Zone[]>('/zones'); return data },
  })

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['officer-zone-history', officerId, historyStart, historyEnd],
    queryFn: async () => {
      const { data } = await api.get<ZoneAssignmentHistory[]>(`/users/${officerId}/zone-history`, {
        params: { start_date: historyStart || undefined, end_date: historyEnd || undefined },
      })
      return data
    },
    enabled: !!officerId && showHistory,
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

      <div className="flex-1 overflow-y-auto px-4 pb-8">
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
                onClick={() => { if (window.confirm(`Remove ${officer.full_name} from ${currentZone.name}? It will become uncovered.`)) unassignMutation.mutate() }}
                disabled={unassignMutation.isPending}
                className="flex-1 border-2 border-red-200 dark:border-red-900 text-red-500 dark:text-red-300 font-bold text-xs rounded-xl py-2.5 disabled:opacity-40"
              >
                {unassignMutation.isPending ? 'Removing…' : 'Remove from zone'}
              </button>
            )}
          </div>
        </div>

        {/* Per-officer contribution gathered, day/week/custom */}
        {currentZone && <OfficerContributionCard officerId={officer.id} />}

        {/* Customer statistics, scoped to this officer's zone */}
        {currentZone && (
          <CustomerStatsPanel
            scope={{ kind: 'officer_zone', officerId: officer.id }}
            title={`Customer statistics — ${currentZone.name}`}
          />
        )}

        {/* Coverage history */}
        <button
          onClick={() => setShowHistory(v => !v)}
          className="w-full bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 flex items-center justify-between mb-4"
        >
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-green-600 dark:text-night-200" />
            <p className="text-green-900 dark:text-white font-bold text-sm">Coverage history</p>
          </div>
          <ChevronRight className={cn('w-4 h-4 text-green-300 dark:text-night-300 transition-transform', showHistory && 'rotate-90')} />
        </button>

        {showHistory && (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
            <div className="flex gap-2 mb-3">
              <input
                type="date"
                value={historyStart}
                onChange={e => setHistoryStart(e.target.value)}
                className="flex-1 border border-green-200 dark:border-night-500 rounded-lg px-2 py-1.5 text-xs text-green-900 dark:text-white bg-white dark:bg-night-700"
              />
              <input
                type="date"
                value={historyEnd}
                onChange={e => setHistoryEnd(e.target.value)}
                className="flex-1 border border-green-200 dark:border-night-500 rounded-lg px-2 py-1.5 text-xs text-green-900 dark:text-white bg-white dark:bg-night-700"
              />
              {(historyStart || historyEnd) && (
                <button onClick={() => { setHistoryStart(''); setHistoryEnd('') }} className="text-green-400 dark:text-night-300 text-xs px-2">Clear</button>
              )}
            </div>

            {historyLoading ? (
              <div className="h-16 bg-green-50 dark:bg-night-600 rounded-xl animate-pulse" />
            ) : history.length === 0 ? (
              <p className="text-green-400 dark:text-night-300 text-xs text-center py-3">No coverage history in this range.</p>
            ) : (
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h.id} className="bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-green-900 dark:text-white text-sm font-semibold">{h.zone_name}</p>
                      {!h.ended_at && (
                        <span className="text-[10px] font-bold text-green-700 dark:text-night-100 bg-green-100 dark:bg-night-600 px-2 py-0.5 rounded-full">Current</span>
                      )}
                    </div>
                    <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
                      {formatDateTime(h.started_at)} → {h.ended_at ? formatDateTime(h.ended_at) : 'now'}
                    </p>
                    {h.assigned_by_director_name && (
                      <p className="text-green-300 dark:text-night-300 text-[11px] mt-0.5">Assigned by {h.assigned_by_director_name}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showZonePicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowZonePicker(false)}>
          <div className="absolute inset-0 bg-green-950/60 dark:bg-night-900/60 backdrop-blur-sm" />
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
