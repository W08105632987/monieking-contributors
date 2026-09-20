import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Pencil, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'

interface SystemConfigItem {
  key: string
  value: string
  description: string | null
  updated_at: string
}

interface PendingRateChange {
  id: string
  setting_key: string
  current_value_kobo: number
  new_value_kobo: number
  effective_date: string
  status: string
  created_at: string
}

export default function BusinessSettingsPage() {
  const qc = useQueryClient()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const { data: settings, isLoading } = useQuery({
    queryKey: ['crm-settings'],
    queryFn: async () => (await api.get<SystemConfigItem[]>('/settings')).data,
  })

  const { data: rateChanges } = useQuery({
    queryKey: ['crm-rate-changes'],
    queryFn: async () => (await api.get<PendingRateChange[]>('/settings/rate-changes')).data,
  })

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.patch(`/settings/${key}`, { value }),
    onSuccess: () => {
      toast.success('Setting updated')
      qc.invalidateQueries({ queryKey: ['crm-settings'] })
      setEditingKey(null)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div className="max-w-3xl">
      <h1 className="text-green-900 dark:text-white font-extrabold text-2xl mb-1">Business settings</h1>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">
        Rates, fees, and thresholds. Some keys can't be changed immediately — they're locked in for the current year and go through the deferred rate-change flow instead (view-only here).
      </p>

      <div className="flex items-center gap-2 mb-3">
        <Settings className="w-4 h-4 text-green-600 dark:text-night-200" />
        <p className="text-green-900 dark:text-white font-bold text-sm">Configuration</p>
      </div>

      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card overflow-hidden mb-8">
        {isLoading && <div className="p-6"><div className="h-4 bg-green-50 dark:bg-night-600 rounded animate-pulse" /></div>}
        <div className="divide-y divide-green-50 dark:divide-night-600">
          {settings?.map(s => (
            <div key={s.key} className="px-5 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-green-900 dark:text-white font-semibold text-sm font-mono">{s.key}</p>
                {s.description && <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{s.description}</p>}
                <p className="text-green-300 dark:text-night-400 text-[11px] mt-1">Updated {formatDate(s.updated_at)}</p>
              </div>
              {editingKey === s.key ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    autoFocus
                    className="w-32 border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-lg px-2 py-1.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500"
                  />
                  <button
                    onClick={() => updateMutation.mutate({ key: s.key, value: editValue })}
                    disabled={updateMutation.isPending}
                    className="text-green-700 dark:text-copper-400 text-xs font-bold"
                  >
                    Save
                  </button>
                  <button onClick={() => setEditingKey(null)} className="text-green-400 dark:text-night-300 text-xs">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingKey(s.key); setEditValue(s.value) }}
                  className="flex items-center gap-1.5 flex-shrink-0 bg-green-50 dark:bg-night-600 rounded-lg px-3 py-1.5 text-green-900 dark:text-white text-sm font-mono font-semibold"
                >
                  {s.value} <Pencil className="w-3 h-3 text-green-400 dark:text-night-300" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-green-600 dark:text-night-200" />
        <p className="text-green-900 dark:text-white font-bold text-sm">Pending deferred rate changes</p>
      </div>
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card overflow-hidden">
        {rateChanges?.length === 0 && (
          <p className="px-5 py-6 text-center text-green-400 dark:text-night-300 text-sm">No pending rate changes.</p>
        )}
        <div className="divide-y divide-green-50 dark:divide-night-600">
          {rateChanges?.map(rc => (
            <div key={rc.id} className="px-5 py-3 flex items-center justify-between text-sm">
              <div>
                <p className="text-green-900 dark:text-white font-semibold font-mono">{rc.setting_key}</p>
                <p className="text-green-400 dark:text-night-300 text-xs">
                  {(rc.current_value_kobo / 100).toLocaleString()} → {(rc.new_value_kobo / 100).toLocaleString()}, effective {formatDate(rc.effective_date)}
                </p>
              </div>
              <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full capitalize',
                rc.status === 'pending' ? 'bg-amber-50 text-amber-600' : 'bg-green-100 text-green-700')}>
                {rc.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
