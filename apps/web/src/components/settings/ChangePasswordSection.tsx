import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'

/**
 * Lives inside the Security card now (see Profile pages), as a row
 * matching every other row there — not its own standalone card.
 * `isLast` drops the row's own bottom border when it's the final item
 * in whichever card it's placed in (same pattern as KycSection).
 */
export function ChangePasswordSection({ isLast = false }: { isLast?: boolean }) {
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
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center gap-3 py-3.5 active:bg-green-50/50 dark:active:bg-white/5 transition-all text-left ${isLast && !open ? '' : 'border-b border-green-50 dark:border-night-600'}`}
      >
        <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
          <KeyRound className="w-4 h-4 text-green-500 dark:text-night-200" />
        </div>
        <div className="flex-1">
          <p className="text-green-900 dark:text-white text-sm font-semibold">Change login password</p>
        </div>
        <span className="text-green-400 dark:text-night-300 text-xs font-semibold flex-shrink-0">{open ? 'Close' : 'Edit'}</span>
      </button>

      {open && (
        <div className={`pt-1 pb-4 space-y-3 ${isLast ? '' : 'border-b border-green-50 dark:border-night-600'}`}>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder="Current password"
              className="w-full border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 rounded-xl pl-4 pr-10 py-2.5 text-sm text-green-900 dark:text-white"
            />
            <button onClick={() => setShowCurrent(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="relative">
            <input
              type={showNext ? 'text' : 'password'}
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="New password (min 8 characters)"
              className="w-full border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 rounded-xl pl-4 pr-10 py-2.5 text-sm text-green-900 dark:text-white"
            />
            <button onClick={() => setShowNext(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
              {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={submit}
            disabled={loading || !current || !next}
            className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-sm rounded-full py-3 disabled:opacity-40"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </div>
      )}
    </div>
  )
}
