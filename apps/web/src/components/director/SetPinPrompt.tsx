import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'

/** First dashboard visit as a director with no PIN yet: a clear, one-tap prompt. */
export function SetPinPrompt() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  if (!user || (user.role !== 'director' && user.role !== 'admin') || user.has_payment_pin) return null
  return (
    <button onClick={() => nav('/director/set-pin')} className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left dark:border-amber-700 dark:bg-amber-950/30">
      <ShieldAlert className="h-6 w-6 shrink-0 text-amber-600" />
      <span className="flex-1">
        <span className="block text-sm font-bold text-amber-900 dark:text-amber-100">Set your PIN</span>
        <span className="block text-xs text-amber-800 dark:text-amber-200">You need it to approve requests and confirm sensitive actions.</span>
      </span>
      <span className="text-xs font-bold text-amber-900 dark:text-amber-100">Set now ›</span>
    </button>
  )
}
