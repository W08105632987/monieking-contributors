import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Send } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

export default function BroadcastPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'all' | 'customer' | 'officer'>('all')

  const sendMutation = useMutation({
    mutationFn: () => api.post('/notifications/broadcasts', { title, body, target_roles: audience }),
    onSuccess: () => {
      toast.success('Broadcast sent')
      setTitle(''); setBody('')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white border border-green-100 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700" />
        </button>
        <h1 className="text-green-900 font-extrabold text-lg">Broadcast</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <p className="text-green-500 text-sm mb-4">
          Sends a notification straight to each recipient's inbox — for things that don't need the urgency of the Instant Message ticker.
        </p>

        <div className="bg-white rounded-2xl border border-green-100 shadow-card p-4">
          <div className="mb-3">
            <label className="text-green-700 text-xs font-bold uppercase tracking-wide block mb-1.5">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. New Food Card rate for next year"
              className="w-full border border-green-200 rounded-xl px-4 py-3 text-sm text-green-900 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div className="mb-4">
            <label className="text-green-700 text-xs font-bold uppercase tracking-wide block mb-1.5">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
              className="w-full border border-green-200 rounded-xl px-4 py-3 text-sm text-green-900 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
          </div>

          <div className="flex gap-2 mb-4">
            {(['all', 'customer', 'officer'] as const).map(a => (
              <button key={a} onClick={() => setAudience(a)}
                className={cn('flex-1 py-2 rounded-xl text-xs font-bold',
                  audience === a ? 'bg-green-900 text-white' : 'bg-green-50 text-green-600')}
              >
                {a === 'all' ? 'Everyone' : a === 'customer' ? 'Customers' : 'Officers'}
              </button>
            ))}
          </div>

          <button
            onClick={() => sendMutation.mutate()}
            disabled={!title.trim() || !body.trim() || sendMutation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-amber-400 text-green-900 font-bold text-sm rounded-full py-3.5 disabled:opacity-40"
          >
            <Send className="w-4 h-4" /> {sendMutation.isPending ? 'Sending…' : 'Send broadcast'}
          </button>
        </div>
      </div>

    </div>
  )
}
