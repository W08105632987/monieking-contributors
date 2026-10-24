import { useState } from 'react'
import { Mail, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { EmailSheet } from './SecuritySheets'

/** Profile row: add, verify or change the optional email. Same look as the other profile menu rows. */
export function EmailRow() {
  const user = useAuthStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const verified = !!user?.email_verified && !!user?.email
  const waiting = !verified && !!user?.pending_email
  const title = verified ? 'Email' : waiting ? 'Confirm your email' : 'Add your email'
  const sub = verified ? `${user!.email} · verified` : waiting ? `Enter the code we sent to ${user!.pending_email}` : 'Optional — lets you reset your password by email'
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 border-b border-green-50 py-3.5 text-left transition-all last:border-0 active:bg-green-50/50 dark:border-night-600 dark:active:bg-white/5">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 dark:bg-night-600"><Mail className="h-4 w-4 text-green-700 dark:text-night-100" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-green-900 dark:text-white">{title}</p>
          <p className="truncate text-xs text-green-500 dark:text-night-300">{sub}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-green-300 dark:text-night-400" />
      </button>
      {open && <EmailSheet onClose={() => setOpen(false)} />}
    </>
  )
}
