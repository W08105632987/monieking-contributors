import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BadgeCheck, Check, ChevronRight, KeyRound, Lock, Rocket } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { cn } from '@/lib/utils'
import { PinSheet, WithdrawalPasswordSheet } from './SecuritySheets'

/** What a new customer or officer still has to do before the account is fully set up. Disappears when all done. */
export function SetupChecklist() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [sheet, setSheet] = useState<null | 'pin' | 'withdraw'>(null)
  if (!user || (user.role !== 'customer' && user.role !== 'officer')) return null

  const items = [
    { key: 'kyc', done: !!user.bvn_linked && !!user.nin_linked, icon: BadgeCheck, title: 'Verify your identity', hint: 'Add your NIN and BVN in your profile', go: () => nav(`/${user.role}/profile?kyc=1`) },
    { key: 'pin', done: !!user.has_payment_pin, icon: KeyRound, title: 'Set up your payment PIN', hint: '4 digits that approve airtime, bills and services', go: () => setSheet('pin') },
    { key: 'wd', done: !!user.has_withdrawal_password, icon: Lock, title: 'Set your withdrawal password', hint: 'Used only when you withdraw', go: () => setSheet('withdraw') },
  ]
  const doneCount = items.filter((i) => i.done).length
  const all = doneCount === items.length
  const nextIdx = items.findIndex((i) => !i.done)
  const pct = (doneCount / items.length) * 100
  const R = 22, C = 2 * Math.PI * R

  return (
    <>
      <AnimatePresence>
        {!all && (
          <motion.section key="setup" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginBottom: 0, scale: 0.96 }}
            transition={{ duration: 0.4 }} aria-label="Account setup checklist"
            className="mb-4 overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-card dark:border-amber-700/50 dark:from-night-700 dark:to-night-800">
            <div className="mb-3 flex items-center gap-3">
              <div className="relative h-14 w-14 shrink-0">
                <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
                  <circle cx="28" cy="28" r={R} fill="none" strokeWidth="5" className="stroke-amber-100 dark:stroke-night-500" />
                  <motion.circle cx="28" cy="28" r={R} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-green-600"
                    strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C - (C * pct) / 100 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-xs font-extrabold text-green-900 dark:text-white">{doneCount}/{items.length}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-extrabold text-green-950 dark:text-white"><Rocket className="h-4 w-4 text-amber-500" />Get your account running</p>
                <p className="text-xs text-green-700 dark:text-night-200">Finish these steps to unlock everything.</p>
              </div>
            </div>
            <ul className="space-y-2">
              {items.map((it, i) => (
                <motion.li key={it.key} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 * i }}>
                  <button type="button" disabled={it.done} onClick={it.go}
                    className={cn('flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.99]',
                      it.done ? 'border-green-200 bg-green-50 dark:border-green-800/40 dark:bg-green-900/20' : i === nextIdx ? 'border-amber-300 bg-white shadow-sm dark:border-amber-600/50 dark:bg-night-700' : 'border-green-100 bg-white/70 dark:border-night-500 dark:bg-night-700/70')}>
                    <motion.span layout className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', it.done ? 'bg-green-600 text-white' : 'bg-amber-100 text-amber-700 dark:bg-night-600 dark:text-amber-300')}
                      animate={it.done ? { scale: [1, 1.25, 1] } : i === nextIdx ? { scale: [1, 1.08, 1] } : {}} transition={it.done ? { duration: 0.5 } : { duration: 1.6, repeat: Infinity }}>
                      {it.done ? <Check className="h-4 w-4" strokeWidth={3} /> : <it.icon className="h-4 w-4" />}
                    </motion.span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm font-bold', it.done ? 'text-green-700 line-through decoration-green-400 dark:text-green-300' : 'text-green-950 dark:text-white')}>{it.title}</span>
                      {!it.done && <span className="block truncate text-[11px] text-green-600 dark:text-night-300">{it.hint}</span>}
                    </span>
                    {!it.done && <ChevronRight className="h-4 w-4 text-amber-500" />}
                  </button>
                </motion.li>
              ))}
            </ul>
          </motion.section>
        )}
      </AnimatePresence>
      {sheet === 'pin' && <PinSheet onClose={() => setSheet(null)} />}
      {sheet === 'withdraw' && <WithdrawalPasswordSheet onClose={() => setSheet(null)} />}
    </>
  )
}
