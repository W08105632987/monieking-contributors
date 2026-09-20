import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, cn } from '@/lib/utils'

interface AuditLogEntry {
  id: string
  actor_id: string
  action: string
  entity_type: string
  entity_id: string
  old_value: Record<string, any> | null
  new_value: Record<string, any> | null
  ip_address: string | null
  created_at: string
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['crm-audit-logs', page, action, entityType],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), page_size: '50' })
      if (action) params.set('action', action)
      if (entityType) params.set('entity_type', entityType)
      return (await api.get<AuditLogEntry[]>(`/admin/audit-logs?${params}`)).data
    },
  })

  return (
    <div>
      <h1 className="text-green-900 dark:text-white font-extrabold text-2xl mb-1">Audit log</h1>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">Every recorded action across the platform, newest first</p>

      <div className="flex items-center gap-3 mb-5">
        <input
          value={action}
          onChange={e => { setAction(e.target.value); setPage(1) }}
          placeholder="Filter by action (e.g. officer.created)"
          className="bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-xs text-green-900 dark:text-white w-64"
        />
        <input
          value={entityType}
          onChange={e => { setEntityType(e.target.value); setPage(1) }}
          placeholder="Filter by entity type (e.g. user)"
          className="bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-xs text-green-900 dark:text-white w-64"
        />
      </div>

      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card overflow-hidden">
        {isLoading && <div className="p-6"><div className="h-4 bg-green-50 dark:bg-night-600 rounded animate-pulse" /></div>}
        {!isLoading && data?.length === 0 && (
          <div className="p-8 text-center text-green-400 dark:text-night-300 text-sm flex items-center justify-center gap-2">
            <History className="w-4 h-4" /> No matching entries.
          </div>
        )}
        <div className="divide-y divide-green-50 dark:divide-night-600">
          {data?.map(log => (
            <div key={log.id}>
              <button
                onClick={() => setExpandedId(id => id === log.id ? null : log.id)}
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-green-50/60 dark:hover:bg-night-600/60 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {expandedId === log.id ? <ChevronDown className="w-3.5 h-3.5 text-green-300 dark:text-night-400 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-green-300 dark:text-night-400 flex-shrink-0" />}
                  <span className="text-green-900 dark:text-white font-semibold text-sm truncate">{log.action}</span>
                  <span className="text-green-400 dark:text-night-300 text-xs flex-shrink-0">{log.entity_type} · {log.entity_id.slice(0, 8)}</span>
                </div>
                <span className="text-green-400 dark:text-night-300 text-xs flex-shrink-0">{formatDateTime(log.created_at)}</span>
              </button>
              {expandedId === log.id && (
                <div className="px-5 pb-4 pl-12 space-y-2">
                  <p className="text-green-500 dark:text-night-200 text-xs">Actor: <span className="font-mono">{log.actor_id}</span></p>
                  {log.ip_address && <p className="text-green-500 dark:text-night-200 text-xs">IP: {log.ip_address}</p>}
                  {log.old_value && (
                    <div>
                      <p className="text-green-400 dark:text-night-300 text-[11px] uppercase font-semibold mb-1">Before</p>
                      <pre className="bg-green-50 dark:bg-night-600 rounded-lg p-2 text-[11px] text-green-700 dark:text-night-100 overflow-x-auto">{JSON.stringify(log.old_value, null, 2)}</pre>
                    </div>
                  )}
                  {log.new_value && (
                    <div>
                      <p className="text-green-400 dark:text-night-300 text-[11px] uppercase font-semibold mb-1">After</p>
                      <pre className="bg-green-50 dark:bg-night-600 rounded-lg p-2 text-[11px] text-green-700 dark:text-night-100 overflow-x-auto">{JSON.stringify(log.new_value, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className={cn('text-green-600 dark:text-night-200 text-xs font-semibold', page <= 1 && 'opacity-30')}>← Prev</button>
        <p className="text-green-400 dark:text-night-300 text-xs">Page {page}</p>
        <button onClick={() => setPage(p => p + 1)} disabled={(data?.length ?? 0) < 50}
          className={cn('text-green-600 dark:text-night-200 text-xs font-semibold', (data?.length ?? 0) < 50 && 'opacity-30')}>Next →</button>
      </div>
    </div>
  )
}
