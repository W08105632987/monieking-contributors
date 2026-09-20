import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Megaphone, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'

const ROLE_OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'customer', label: 'Customers only' },
  { value: 'officer', label: 'Officers only' },
  { value: 'director', label: 'Directors only' },
]

export default function BroadcastsPage() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [targetRoles, setTargetRoles] = useState('all')

  const sendMutation = useMutation({
    mutationFn: () => api.post('/notifications/broadcasts', { title, body, target_roles: targetRoles }),
    onSuccess: (res: any) => {
      toast.success(res.data?.message ?? 'Broadcast sent')
      setTitle(''); setBody('')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div className="max-w-xl">
      <h1 className="text-green-900 dark:text-white font-extrabold text-2xl mb-1">Broadcasts</h1>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">Send a notification to everyone, or a specific role, platform-wide</p>

      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Megaphone className="w-4 h-4 text-green-600 dark:text-night-200" />
          <p className="text-green-900 dark:text-white font-bold text-sm">Compose</p>
        </div>

        <form onSubmit={e => { e.preventDefault(); sendMutation.mutate() }} className="space-y-4">
          <div>
            <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Send to</label>
            <select value={targetRoles} onChange={e => setTargetRoles(e.target.value)}
              className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500">
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Title</label>
            <input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500" />
          </div>
          <div>
            <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Message</label>
            <textarea required rows={4} value={body} onChange={e => setBody(e.target.value)}
              className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500" />
          </div>
          <button type="submit" disabled={sendMutation.isPending || !title.trim() || !body.trim()}
            className="w-full flex items-center justify-center gap-2 bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-sm rounded-xl py-3 disabled:opacity-50">
            <Send className="w-4 h-4" /> {sendMutation.isPending ? 'Sending…' : 'Send broadcast'}
          </button>
        </form>
      </div>
    </div>
  )
}
