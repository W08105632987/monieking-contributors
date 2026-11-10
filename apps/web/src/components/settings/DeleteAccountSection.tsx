import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Trash2 } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { sheetMotion, overlayMotion } from '@/lib/motion'
import toast from '@/lib/notify'

/** "Delete my account": required by Google Play. The server refuses while money or a payment is still in flight. */
export function DeleteAccountSection({ variant = 'card' }: { variant?: 'card' | 'header' } = {}) {
  const navigate = useNavigate()
  const { logout } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => { if (!busy) { setOpen(false); setTyped(''); setError(null) } }

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      await api.delete('/users/me/account', { data: { confirm: 'DELETE' } })
      toast.success('Your account has been deleted.')
      logout()
      navigate('/auth/login', { replace: true })
    } catch (e) {
      setError(getErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <>
      {variant === 'header' ? (
        <button
          onClick={() => setOpen(true)}
          aria-label="Delete my account"
          className="flex items-center gap-1.5 rounded-full border border-red-200 dark:border-red-900 px-3 h-9 text-xs font-bold text-red-600 dark:text-red-300 active:scale-95 transition-transform"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete account
        </button>
      ) : (
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-red-100 shadow-card px-4 mb-6">
          <button onClick={() => setOpen(true)} className="w-full flex items-center gap-3 py-4 text-left">
            <span className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center"><Trash2 className="w-4 h-4 text-red-400 dark:text-red-300" /></span>
            <span className="flex-1">
              <span className="block text-red-600 dark:text-red-300 text-sm font-bold">Delete my account</span>
              <span className="block text-green-500 dark:text-night-300 text-xs">Permanently erase your account and personal data</span>
            </span>
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={close}>
          <motion.div {...overlayMotion} className="absolute inset-0 bg-green-950/60" />
          <motion.div {...sheetMotion} onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md rounded-t-3xl bg-white dark:bg-night-700 p-6 pb-8">
            <h2 className="text-green-900 dark:text-white font-extrabold text-xl text-center mb-2">Delete your account?</h2>
            <p className="text-green-700 dark:text-night-200 text-sm text-center mb-3">
              This cannot be undone. Your name, phone number, bank and identity details are erased and you will be signed out.
              Payment records the law requires us to keep are kept without your personal details.
            </p>
            <p className="text-green-500 dark:text-night-300 text-xs text-center mb-4">
              Your wallet must be empty and nothing may be pending. Withdraw your money first.
            </p>
            <label className="block text-xs font-bold text-green-700 dark:text-night-100 mb-1">Type DELETE to confirm</label>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off"
              className="w-full rounded-lg border-2 border-green-100 dark:border-night-500 bg-transparent px-3 py-2 text-sm text-green-900 dark:text-white" />
            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300" role="alert">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={close} disabled={busy} className="flex-1 py-3 rounded-xl border-2 border-green-100 dark:border-night-500 text-green-700 dark:text-night-100 text-sm font-bold">Keep my account</button>
              <button onClick={submit} disabled={busy || typed.trim().toUpperCase() !== 'DELETE'} className="flex-1 py-3 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-50">{busy ? 'Deleting…' : 'Delete forever'}</button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
