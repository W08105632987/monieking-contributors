import { useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { useGoBack } from '@/hooks/useGoBack'
import { CustomerStatsPanel } from '@/components/dashboard/CustomerStatsPanel'
import { OfficerContributionCard } from '@/components/dashboard/OfficerContributionCard'
import { CustomerAdminPanel } from '@/components/director/CustomerAdminPanel'
import { OfficerCommissionPanel } from '@/components/director/OfficerCommissionPanel'
import { ZoneCustomersOverview } from '@/components/director/ZoneCustomersOverview'
import type { User, Zone, ZoneAssignmentHistory } from '@/types'

const TITLES = {
  customers: 'Zone customers',
  pay: 'Pay & commission',
  contributions: 'Contributions gathered',
  stats: 'Customer statistics',
  history: 'Coverage history',
  admin: 'Admin tools',
} as const
type Section = keyof typeof TITLES

const box = 'bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4'

function CoverageHistory({ officerId }: { officerId: string }) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['officer-zone-history', officerId, start, end],
    queryFn: async () => (await api.get<ZoneAssignmentHistory[]>(`/users/${officerId}/zone-history`, {
      params: { start_date: start || undefined, end_date: end || undefined },
    })).data,
  })
  const input = 'flex-1 border border-green-200 dark:border-night-500 rounded-lg px-2 py-1.5 text-xs text-green-900 dark:text-white bg-white dark:bg-night-700'
  return (
    <div className={box}>
      <div className="flex gap-2 mb-3">
        <input type="date" value={start} onChange={e => setStart(e.target.value)} className={input} />
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} className={input} />
        {(start || end) && <button onClick={() => { setStart(''); setEnd('') }} className="text-green-400 dark:text-night-300 text-xs px-2">Clear</button>}
      </div>
      {isLoading ? <div className="h-16 bg-green-50 dark:bg-night-600 rounded-xl animate-pulse" />
        : history.length === 0 ? <p className="text-green-400 dark:text-night-300 text-xs text-center py-3">No coverage history in this range.</p>
        : (
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-green-900 dark:text-white text-sm font-semibold truncate">{h.zone_name}</p>
                  {!h.ended_at && <span className="text-[10px] font-bold text-green-700 dark:text-night-100 bg-green-100 dark:bg-night-500 px-2 py-0.5 rounded-full">Current</span>}
                </div>
                <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{formatDateTime(h.started_at)} → {h.ended_at ? formatDateTime(h.ended_at) : 'now'}</p>
                {h.assigned_by_director_name && <p className="text-green-300 dark:text-night-300 text-[11px] mt-0.5">Assigned by {h.assigned_by_director_name}</p>}
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

export default function OfficerSectionPage() {
  const { officerId, section } = useParams()
  const goBack = useGoBack(`/director/officers/${officerId}`)
  const valid = !!section && section in TITLES
  const key = section as Section

  const { data: officer } = useQuery({
    queryKey: ['officer', officerId],
    queryFn: async () => (await api.get<User>(`/users/${officerId}`)).data,
    enabled: !!officerId && valid,
  })
  const { data: zones = [] } = useQuery({
    queryKey: ['zones'],
    queryFn: async () => (await api.get<Zone[]>('/zones')).data,
    enabled: valid && (key === 'contributions' || key === 'stats'),
  })

  if (!valid) return <Navigate to={`/director/officers/${officerId}`} replace />
  const zone = zones.find(z => z.id === officer?.zone_id)
  const noZone = <p className="text-amber-600 dark:text-amber-300 text-xs bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2.5">This officer has no zone right now, so there is nothing to show here.</p>

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={goBack} aria-label="Back" className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-green-900 dark:text-white font-extrabold text-lg leading-tight">{TITLES[key]}</h1>
          {officer && <p className="truncate text-xs text-green-500 dark:text-night-200">{officer.full_name}</p>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {!officer ? <div className="h-32 rounded-2xl bg-white dark:bg-night-700 animate-pulse" /> : (
          <>
            {key === 'customers' && <ZoneCustomersOverview officerId={officer.id} affiliated={officer.officer_type === 'affiliated'} />}
            {key === 'pay' && <OfficerCommissionPanel officer={officer} />}
            {key === 'contributions' && (officer.zone_id ? <OfficerContributionCard officerId={officer.id} /> : noZone)}
            {key === 'stats' && (officer.zone_id
              ? <CustomerStatsPanel scope={{ kind: 'officer_zone', officerId: officer.id }} title={`Customer statistics${zone ? ` — ${zone.name}` : ''}`} />
              : noZone)}
            {key === 'history' && <CoverageHistory officerId={officer.id} />}
            {key === 'admin' && <CustomerAdminPanel customerId={officer.id} name={officer.full_name} kind="officer" />}
          </>
        )}
      </div>
    </div>
  )
}
