import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Database, Zap, Send, MessageSquare, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

interface CheckResult {
  check_name: string
  status: 'healthy' | 'degraded' | 'down'
  message: string | null
  metrics: Record<string, any>
  checked_at: string
}
interface StatusResponse {
  checks: CheckResult[]
  overall_status: 'healthy' | 'degraded' | 'down'
  history: { check_name: string; status: string; checked_at: string; metrics: any }[]
}

const CHECK_ICON: Record<string, any> = {
  database: Database, redis: Zap, monnify: Send, termii: MessageSquare, transactions: Activity, traffic: Users,
}
const STATUS_TINT: Record<string, string> = {
  healthy: 'bg-green-100 text-green-700 border-green-200',
  degraded: 'bg-amber-50 text-amber-600 border-amber-200',
  down: 'bg-red-50 text-red-600 border-red-200',
}
const STATUS_ICON: Record<string, any> = { healthy: CheckCircle2, degraded: AlertTriangle, down: XCircle }

export default function SystemHealthPage() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['crm-system-health'],
    queryFn: async () => (await api.get<StatusResponse>('/system-health/status')).data,
    refetchInterval: 60_000,   // auto-refresh — this page is meant to be left open as a live status board
  })

  const runNowMutation = useMutation({
    mutationFn: () => api.post('/system-health/run-now'),
    onSuccess: () => {
      toast.success('Checks run — refreshing')
      qc.invalidateQueries({ queryKey: ['crm-system-health'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const overall = data?.overall_status ?? 'healthy'

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-green-900 dark:text-white font-extrabold text-2xl">System health</h1>
        <button
          onClick={() => runNowMutation.mutate()}
          disabled={runNowMutation.isPending}
          className="flex items-center gap-1.5 bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-xs rounded-xl px-4 py-2.5 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', runNowMutation.isPending && 'animate-spin')} /> Run checks now
        </button>
      </div>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">
        Auto-checked every 3 minutes. Alerts go to whoever's set in ALERT_EMAIL_TO / ALERT_PHONE_TO.
      </p>

      {!isLoading && data && (
        <div className={cn('rounded-2xl border p-5 mb-6 flex items-center gap-3', STATUS_TINT[overall])}>
          {(() => { const Icon = STATUS_ICON[overall]; return <Icon className="w-6 h-6" /> })()}
          <div>
            <p className="font-extrabold text-base capitalize">
              {overall === 'healthy' ? 'All systems healthy' : overall === 'degraded' ? 'Degraded — something needs attention' : 'Down — immediate attention needed'}
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">{[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-32 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}</div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {data?.checks.map(check => {
            const Icon = CHECK_ICON[check.check_name] ?? Activity
            const StatusIcon = STATUS_ICON[check.status]
            return (
              <div key={check.check_name} className={cn('bg-white dark:bg-night-700 rounded-2xl border shadow-card p-5', check.status !== 'healthy' && STATUS_TINT[check.status])}>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center">
                    <Icon className="w-4.5 h-4.5 text-green-700 dark:text-night-100" />
                  </div>
                  <StatusIcon className={cn('w-5 h-5', check.status === 'healthy' ? 'text-green-600' : check.status === 'degraded' ? 'text-amber-500' : 'text-red-500')} />
                </div>
                <p className="text-green-900 dark:text-white font-bold text-sm capitalize mb-1">{check.check_name}</p>
                {check.message && <p className="text-green-500 dark:text-night-300 text-xs mb-2">{check.message}</p>}
                {check.metrics?.latency_ms !== undefined && (
                  <p className="text-green-400 dark:text-night-400 text-[11px]">{check.metrics.latency_ms}ms latency</p>
                )}
                <p className="text-green-300 dark:text-night-500 text-[10px] mt-2">
                  Checked {new Date(check.checked_at).toLocaleTimeString()}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
