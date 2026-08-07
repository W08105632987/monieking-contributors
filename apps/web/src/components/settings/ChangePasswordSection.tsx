import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'

export function ChangePasswordSection() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (next.length < 8) return toast.error('New password must be at least 8 characters')
    setLoading(true)
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next })
      toast.success('Password updated')
      setCurrent(''); setNext(''); setOpen(false)
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-green-100 shadow-card p-4">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-green-600" />
          <p className="text-green-900 font-bold text-sm">Change login password</p>
        </div>
        <span className="text-green-400 text-xs">{open ? 'Close' : 'Edit'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder="Current password"
              className="w-full border border-green-200 rounded-xl pl-4 pr-10 py-2.5 text-sm text-green-900"
            />
            <button onClick={() => setShowCurrent(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400">
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="relative">
            <input
              type={showNext ? 'text' : 'password'}
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="New password (min 8 characters)"
              className="w-full border border-green-200 rounded-xl pl-4 pr-10 py-2.5 text-sm text-green-900"
            />
            <button onClick={() => setShowNext(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400">
              {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={submit}
            disabled={loading || !current || !next}
            className="w-full bg-green-900 text-white font-bold text-sm rounded-full py-3 disabled:opacity-40"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </div>
      )}
    </div>
  )
}
