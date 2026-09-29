import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileClock } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/utils'

interface AuditLogEntry {
  id: string
  actor_id: string
  action: string
  entity_type: string
  entity_id: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export default function AuditLogPage() {
  const navigate = useNavigate()

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: async () => { const { data } = await api.get<AuditLogEntry[]>('/admin/audit-logs?page_size=100'); return data },
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Audit Log</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card text-center py-14 px-6">
            <FileClock className="w-10 h-10 text-green-200 dark:text-night-400 mx-auto mb-3" />
            <p className="text-green-700 dark:text-night-100 font-semibold text-sm">No activity yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-3.5">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-green-900 dark:text-white font-bold text-sm">{log.action.replace(/_/g, ' ')}</p>
                  <p className="text-green-400 dark:text-night-300 text-xs">{timeAgo(log.created_at)}</p>
                </div>
                <p className="text-green-500 dark:text-night-200 text-xs">{log.entity_type} · {log.entity_id.slice(0, 8)}…</p>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
