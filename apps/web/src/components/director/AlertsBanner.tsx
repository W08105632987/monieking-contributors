import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BellRing, ShieldAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Summary { active: number; critical: number; alerting_ready: boolean; alerting_problems: string[] }

/** On the director dashboard: how many system alerts are open, and a loud warning if the alert system itself cannot reach anyone. */
export function AlertsBanner() {
  const nav = useNavigate()
  const { data } = useQuery({
    queryKey: ['system-alerts-summary'], refetchInterval: 60_000, retry: 0,
    queryFn: async () => (await api.get<Summary>('/system-alerts/summary')).data,
  })
  if (!data || (data.active === 0 && data.alerting_ready)) return null
  const critical = data.critical > 0 || !data.alerting_ready
  return (
    <button onClick={() => nav('/director/alerts')} className={cn('mb-4 flex w-full items-start gap-3 rounded-2xl border p-4 text-left',
      critical ? 'border-red-300 bg-red-50 dark:border-red-500/50 dark:bg-red-500/10' : 'border-amber-300 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10')}>
      {critical ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /> : <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
      <div className="min-w-0">
        {data.active > 0 && <p className={cn('text-sm font-extrabold', critical ? 'text-red-800 dark:text-red-200' : 'text-amber-900 dark:text-amber-200')}>
          {data.active} open system alert{data.active === 1 ? '' : 's'}{data.critical ? ` · ${data.critical} critical` : ''}
        </p>}
        {!data.alerting_ready && <p className="text-xs font-semibold text-red-700 dark:text-red-300">Alert emails cannot be delivered right now: {data.alerting_problems[0]}</p>}
        <p className="mt-0.5 text-[11px] text-green-700 dark:text-night-200">Tap to review</p>
      </div>
    </button>
  )
}
