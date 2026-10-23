import { useState } from 'react'
import { KeyRound, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { PinSheet } from './SecuritySheets'

/** Profile row: set or change the payment PIN. Same look as the other profile menu rows. */
export function PaymentPinRow() {
  const has = !!useAuthStore((s) => s.user?.has_payment_pin)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 border-b border-green-50 py-3.5 text-left transition-all last:border-0 active:bg-green-50/50 dark:border-night-600 dark:active:bg-white/5">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 dark:bg-night-600"><KeyRound className="h-4 w-4 text-green-700 dark:text-night-100" /></div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-green-900 dark:text-white">{has ? 'Change payment PIN' : 'Set up payment pin'}</p>
          <p className="text-xs text-green-500 dark:text-night-300">The 4 digits that approve airtime, bills and services</p>
        </div>
        <ChevronRight className="h-4 w-4 text-green-300 dark:text-night-400" />
      </button>
      {open && <PinSheet onClose={() => setOpen(false)} />}
    </>
  )
}
