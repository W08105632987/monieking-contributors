import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Megaphone, AlertTriangle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'
import type { InstantMessage } from '@/types'

export default function InstantMessagePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [message, setMessage] = useState('')
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal')
  const [audience, setAudience] = useState<'all' | 'customer' | 'officer'>('all')

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['instant-messages'],
    queryFn: async () => { const { data } = await api.get<InstantMessage[]>('/instant-messages'); return data },
  })

  const activeMessage = messages.find(m => m.is_active)

  const createMutation = useMutation({
    mutationFn: () => api.post('/instant-messages', { message, priority, target_roles: audience }),
    onSuccess: () => {
      toast.success('Instant message is now live')
      qc.invalidateQueries({ queryKey: ['instant-messages'] })
      qc.invalidateQueries({ queryKey: ['instant-message-active'] })
      setMessage('')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/instant-messages/${id}/deactivate`),
    onSuccess: () => {
      toast.success('Message taken down')
      qc.invalidateQueries({ queryKey: ['instant-messages'] })
      qc.invalidateQueries({ queryKey: ['instant-message-active'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Instant Message</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <p className="text-green-500 dark:text-night-200 text-sm mb-4">
          A scrolling banner shown on every page, for things too urgent to wait for someone to open their notifications.
        </p>

        {activeMessage && (
          <div className={cn(
            'rounded-2xl p-4 mb-5 border-2',
            activeMessage.priority === 'urgent' ? 'bg-red-50 dark:bg-red-900 border-red-200 dark:border-red-900' : 'bg-green-900 dark:bg-night-100 border-green-800 dark:border-night-200',
          )}>
            <div className="flex items-center justify-between mb-2">
              <p className={cn('text-xs font-bold uppercase tracking-wide', activeMessage.priority === 'urgent' ? 'text-red-600 dark:text-red-300' : 'text-amber-400 dark:text-night-100')}>
                Currently live
              </p>
              <button
                onClick={() => deactivateMutation.mutate(activeMessage.id)}
                disabled={deactivateMutation.isPending}
                className={cn(
                  'text-xs font-bold px-3 py-1.5 rounded-full disabled:opacity-60',
                  activeMessage.priority === 'urgent' ? 'bg-white/60 dark:bg-night-700/60 text-red-600 dark:text-red-300' : 'bg-white/20 dark:bg-night-700/20 text-white',
                )}
              >
                {deactivateMutation.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
            <p className={cn('text-sm font-semibold', activeMessage.priority === 'urgent' ? 'text-red-800 dark:text-red-300' : 'text-white')}>
              {activeMessage.message}
            </p>
            <p className={cn('text-xs mt-1', activeMessage.priority === 'urgent' ? 'text-red-400 dark:text-red-300' : 'text-green-300 dark:text-night-300')}>
              Audience: {activeMessage.target_roles} · {timeAgo(activeMessage.created_at)}
            </p>
          </div>
        )}

        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-5">
          <p className="text-green-900 dark:text-white font-bold text-sm mb-3">
            {activeMessage ? 'Replace with a new message' : 'Post a new message'}
          </p>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="e.g. Food Card contributions close early today at 4pm"
            rows={3}
            maxLength={500}
            className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 resize-none mb-3"
          />

          <div className="flex gap-2 mb-3">
            {(['normal', 'urgent'] as const).map(p => (
              <button key={p} onClick={() => setPriority(p)}
                className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold',
                  priority === p
                    ? (p === 'urgent' ? 'bg-red-500 dark:bg-red-400 text-white' : 'bg-green-900 dark:bg-night-100 text-white')
                    : 'bg-green-50 dark:bg-night-600 text-green-600 dark:text-night-200')}
              >
                {p === 'urgent' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Megaphone className="w-3.5 h-3.5" />}
                {p === 'urgent' ? 'Urgent' : 'Normal'}
              </button>
            ))}
          </div>

          <select value={audience} onChange={e => setAudience(e.target.value as typeof audience)}
            className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-2.5 text-sm text-green-900 dark:text-white bg-white dark:bg-night-700 mb-4"
          >
            <option value="all">Everyone</option>
            <option value="customer">Customers only</option>
            <option value="officer">Officers only</option>
          </select>

          <button
            onClick={() => createMutation.mutate()}
            disabled={!message.trim() || createMutation.isPending}
            className="w-full bg-amber-400 dark:bg-night-100 text-green-900 dark:text-white font-bold text-sm rounded-full py-3.5 disabled:opacity-40"
          >
            {createMutation.isPending ? 'Posting…' : 'Post & go live'}
          </button>
        </div>

        <p className="text-green-900 dark:text-white font-bold text-sm mb-2">History</p>
        {isLoading ? (
          <div className="h-16 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />
        ) : (
          <div className="space-y-2">
            {messages.filter(m => !m.is_active).slice(0, 10).map(m => (
              <div key={m.id} className="bg-white dark:bg-night-700 rounded-xl border border-green-100 dark:border-night-500 p-3">
                <p className="text-green-700 dark:text-night-100 text-xs">{m.message}</p>
                <p className="text-green-400 dark:text-night-300 text-xs mt-1">{timeAgo(m.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
