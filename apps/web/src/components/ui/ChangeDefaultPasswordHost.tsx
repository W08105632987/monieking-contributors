import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'

/** The OLD default (phone number followed by MK). No longer given to anyone, but still refused as a new password. */
export const defaultPasswordFor = (phone: string) => `${phone.replace(/\D/g, '')}MK`

/**
 * Mounted once in main.tsx. Shown straight after login while the account still uses a password MonieKing set for
 * it (a director reset, or the customer was registered by an officer/director). "Later" hides it for this visit only,
 * so it comes back at the next login until a new password is saved.
 */
export function ChangeDefaultPasswordHost() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const must = !!user?.must_change_password
  // a different person signing in on the same screen starts fresh
  useEffect(() => { if (!must) { setNext(''); setAgain(''); setError(null) } }, [must])
  if (!user || !must || dismissedFor === user.id) return null

  const tooShort = next.length > 0 && next.length < 8
  const mismatch = again.length > 0 && again !== next
  const isDefault = next === defaultPasswordFor(user.phone_number)
  const can = next.length >= 8 && again === next && !isDefault && !busy

  const save = async () => {
    if (!can) return
    setBusy(true); setError(null)
    try {
      await api.post('/auth/set-new-password', { new_password: next })
      toast.success('Password changed. Use it next time you log in.')
      setUser({ ...user, must_change_password: false })
      setNext(''); setAgain('')
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-xl border border-green-200 bg-white py-2.5 pl-4 pr-10 text-sm text-green-900 dark:border-night-500 dark:bg-night-800 dark:text-white'
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[10002] flex items-center justify-center px-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-green-950/70 backdrop-blur-sm" />
        <motion.div role="alertdialog" aria-modal="true" aria-labelledby="chg-pw-title"
          className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-night-800"
          initial={{ scale: 0.9, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 320 }}>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-900/30">
            <KeyRound className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 id="chg-pw-title" className="text-center text-lg font-extrabold text-green-950 dark:text-white">Choose your own password</h2>
          <p className="mt-2 text-center text-sm leading-relaxed text-green-700 dark:text-night-200">
            You signed in with a password MonieKing gave you. Please change it now so only you know it. We will ask again every time you log in until you do.
          </p>
          <div className="mt-4 space-y-3">
            <div className="relative">
              <input type={show ? 'text' : 'password'} value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8 characters)" autoComplete="new-password" className={input} />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <input type={show ? 'text' : 'password'} value={again} onChange={(e) => setAgain(e.target.value)} placeholder="Type it again" autoComplete="new-password" className={input} />
            {tooShort && <p className="text-xs font-semibold text-red-600">At least 8 characters.</p>}
            {isDefault && <p className="text-xs font-semibold text-red-600">Choose something different from the one you were given.</p>}
            {mismatch && <p className="text-xs font-semibold text-red-600">The two passwords do not match.</p>}
            {error && <p role="alert" className="text-xs font-semibold text-red-600">{error}</p>}
          </div>
          <button onClick={save} disabled={!can} className="mt-4 w-full rounded-2xl bg-green-900 py-3 text-sm font-bold text-white transition active:scale-95 disabled:opacity-40 dark:bg-copper-400 dark:text-green-950">
            {busy ? 'Saving…' : 'Change password'}
          </button>
          <button onClick={() => setDismissedFor(user.id)} disabled={busy} className="mt-2 w-full rounded-2xl py-2.5 text-sm font-semibold text-green-700 dark:text-night-200">Remind me next time</button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
