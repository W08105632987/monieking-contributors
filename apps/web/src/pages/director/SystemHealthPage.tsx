import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Database, Zap, Send, MessageSquare, Users } from 'lucide-react'
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
interface StatusResponse { checks: CheckResult[]; overall_status: 'healthy' | 'degraded' | 'down' }

const CHECK_ICON: Record<string, any> = {
  database: Database, redis: Zap, monnify: Send, termii: MessageSquare, transactions: Activity, traffic: Users,
}
const STATUS_TINT: Record<string, string> = {
  healthy: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
  degraded: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  down: 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border-red-200 dark:border-red-800',
}
const STATUS_ICON: Record<string, any> = { healthy: CheckCircle2, degraded: AlertTriangle, down: XCircle }

export default function DirectorSystemHealthPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['director-system-health'],
    queryFn: async () => (await api.get<StatusResponse>('/system-health/status')).data,
    refetchInterval: 60_000,
  })

  const runNowMutation = useMutation({
    mutationFn: () => api.post('/system-health/run-now'),
    onSuccess: () => { toast.success('Checks run'); qc.invalidateQueries({ queryKey: ['director-system-health'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const overall = data?.overall_status ?? 'healthy'

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-600 flex items-center justify-center text-green-700 dark:text-night-100 shadow-xs">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg flex-1">System health</h1>
        <button onClick={() => runNowMutation.mutate()} disabled={runNowMutation.isPending} className="w-9 h-9 rounded-full bg-green-900 dark:bg-night-600 flex items-center justify-center">
          <RefreshCw className={cn('w-4 h-4 text-white', runNowMutation.isPending && 'animate-spin')} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {!isLoading && data && (
          <div className={cn('rounded-2xl border p-4 mb-4 flex items-center gap-3', STATUS_TINT[overall])}>
            {(() => { const Icon = STATUS_ICON[overall]; return <Icon className="w-5 h-5" /> })()}
            <p className="font-extrabold text-sm capitalize">
              {overall === 'healthy' ? 'All systems healthy' : overall === 'degraded' ? 'Degraded — needs attention' : 'Down — urgent'}
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 animate-pulse" />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {data?.checks.map(check => {
              const Icon = CHECK_ICON[check.check_name] ?? Activity
              const StatusIcon = STATUS_ICON[check.status]
              return (
                <div key={check.check_name} className={cn('bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4', check.status !== 'healthy' && STATUS_TINT[check.status])}>
                  <div className="flex items-center justify-between mb-2">
                    <Icon className="w-4 h-4 text-green-700 dark:text-night-100" />
                    <StatusIcon className={cn('w-4 h-4', check.status === 'healthy' ? 'text-green-600 dark:text-green-400' : check.status === 'degraded' ? 'text-amber-500 dark:text-amber-400' : 'text-red-500 dark:text-red-400')} />
                  </div>
                  <p className="text-green-900 dark:text-white font-bold text-xs capitalize mb-1">{check.check_name}</p>
                  {check.message && <p className="text-green-500 dark:text-night-300 text-[10px]">{check.message}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
