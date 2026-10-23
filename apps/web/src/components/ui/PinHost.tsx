import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Lock, ShieldCheck } from 'lucide-react'
import { usePinStore } from '@/store/pin.store'
import { useAuthStore } from '@/store/auth.store'
import { api, getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Four boxes for four digits. One real input sits on top so phones show the number pad. */
export function PinBoxes({ value, onChange, onComplete, autoFocus = true, label = 'PIN', error }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean; label?: string; error?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 80) }, [autoFocus])
  return (
    <div className="relative mx-auto w-fit" onClick={() => ref.current?.focus()}>
      <div className="flex gap-3" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <motion.span key={i} animate={error ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }} transition={{ duration: 0.35 }}
            className={cn('flex h-14 w-12 items-center justify-center rounded-2xl border-2 text-2xl font-extrabold',
              error ? 'border-red-400' : value.length === i ? 'border-green-600' : 'border-green-200 dark:border-night-500',
              'bg-white dark:bg-night-700 text-green-950 dark:text-white')}>
            {value[i] ? '•' : ''}
          </motion.span>
        ))}
      </div>
      <input
        ref={ref} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={4} value={value} aria-label={label}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); onChange(v); if (v.length === 4) onComplete?.(v) }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  )
}

type Mode = 'enter' | 'setup' | 'reset'

/** Mounted once in main.tsx. Shows whatever requestPin() / withPin() asked for. */
export function PinHost() {
  const { current, close } = usePinStore()
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const hasPin = !!user?.has_payment_pin
  const [mode, setMode] = useState<Mode>('enter')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [loginPw, setLoginPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!current) return
    setMode(hasPin ? 'enter' : 'setup'); setPin(''); setAgain(''); setLoginPw(''); setErr(current.error ?? ''); setBusy(false)
  }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (v: string | null) => { const c = usePinStore.getState().current; close(); c?.resolve(v) }

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) finish(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (busy) return
    if (pin.length !== 4) return setErr('Your PIN is 4 digits.')
    if (pin !== again) return setErr('The two PINs do not match.')
    if (mode === 'reset' && !loginPw) return setErr('Enter your login password.')
    setBusy(true); setErr('')
    try {
      await api.post(mode === 'reset' ? '/auth/reset-pin' : '/auth/set-pin', mode === 'reset' ? { pin, login_password: loginPw } : { pin })
      if (user) setUser({ ...user, has_payment_pin: true })
      finish(pin)
    } catch (e) { setErr(getErrorMessage(e)) } finally { setBusy(false) }
  }

  const title = mode === 'setup' ? 'Set up payment pin' : mode === 'reset' ? 'Reset your PIN' : current?.title
  return (
    <AnimatePresence>
      {current && (
        <motion.div key={current.id} className="fixed inset-0 z-[10010] flex items-end justify-center sm:items-center sm:px-5"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-green-950/70 backdrop-blur-sm" onClick={() => !busy && finish(null)} />
          <motion.div role="dialog" aria-modal="true" aria-label={title}
            className="relative w-full max-w-sm rounded-t-3xl bg-white p-6 pb-8 text-center shadow-2xl dark:bg-night-800 sm:rounded-3xl"
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 320 }}>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              {mode === 'enter' ? <Lock className="h-7 w-7 text-green-700 dark:text-green-300" /> : <ShieldCheck className="h-7 w-7 text-green-700 dark:text-green-300" />}
            </div>
            <h2 className="text-lg font-extrabold text-green-950 dark:text-white">{title}</h2>
            {current.message && mode === 'enter' && <p className="mt-1 text-sm text-green-700 dark:text-night-200">{current.message}</p>}

            {mode === 'enter' && (
              <div className="mt-5 space-y-4">
                <PinBoxes value={pin} onChange={(v) => { setPin(v); setErr('') }} onComplete={(v) => finish(v)} error={!!err} />
                {err && <p role="alert" className="text-xs font-semibold text-red-600">{err}</p>}
                <button type="button" onClick={() => setMode('reset')} className="text-xs font-bold text-green-700 underline dark:text-night-200">Forgot PIN?</button>
                <button type="button" onClick={() => finish(null)} className="block w-full rounded-xl border-2 border-green-100 py-3 text-sm font-bold text-green-800 dark:border-night-500 dark:text-night-100">Cancel</button>
              </div>
            )}

            {mode !== 'enter' && (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-green-700 dark:text-night-200">
                  {mode === 'setup' ? 'Choose 4 digits. You will use this PIN for airtime, bills, identity services and anything else that needs your approval.' : 'Enter your login password, then choose a new 4-digit PIN.'}
                </p>
                {mode === 'reset' && (
                  <input type="password" autoComplete="current-password" placeholder="Login password" value={loginPw} onChange={(e) => setLoginPw(e.target.value)}
                    className="w-full rounded-xl border border-green-200 bg-white px-3 py-3 text-sm dark:border-night-500 dark:bg-night-700 dark:text-white" />
                )}
                <div><p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">New PIN</p><PinBoxes value={pin} onChange={setPin} label="New PIN" autoFocus={mode === 'setup'} /></div>
                <div><p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">Type it again</p><PinBoxes value={again} onChange={setAgain} autoFocus={false} label="Confirm PIN" error={again.length === 4 && again !== pin} /></div>
                {err && <p role="alert" className="text-xs font-semibold text-red-600">{err}</p>}
                <button type="button" disabled={busy || pin.length !== 4 || again.length !== 4} onClick={save}
                  className="w-full rounded-xl bg-green-700 py-3 text-sm font-bold text-white transition active:scale-95 disabled:opacity-50">{busy ? 'Please wait…' : mode === 'setup' ? 'Save PIN and continue' : 'Reset PIN and continue'}</button>
                <button type="button" disabled={busy} onClick={() => (mode === 'reset' && hasPin ? setMode('enter') : finish(null))} className="text-xs font-bold text-green-700 underline dark:text-night-200">{mode === 'reset' && hasPin ? 'Back' : 'Not now'}</button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
