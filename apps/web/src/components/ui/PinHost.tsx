import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Delete, Lock, ShieldCheck } from 'lucide-react'
import { usePinStore } from '@/store/pin.store'
import { useAuthStore } from '@/store/auth.store'
import { api, getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PasswordInput } from '@/components/ui/PasswordInput'

/** Digits typed on a real keyboard (desktop) or a hardware keypad. Ignored while the person is typing in a normal text field. */
function useDigitKeys(enabled: boolean, onDigit: (d: string) => void, onBackspace: () => void) {
  useEffect(() => {
    if (!enabled) return
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); onDigit(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); onBackspace() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [enabled, onDigit, onBackspace])
}

/** Four boxes that run the full width. Each fills with the theme green, with a small pop, as a digit goes in. */
export function PinDisplay({ value, active = true, error, label = 'PIN', onTap }: {
  value: string; active?: boolean; error?: boolean; label?: string; onTap?: () => void
}) {
  return (
    <div role="group" aria-label={`${label}: ${value.length} of 4 digits entered`} onClick={onTap}
      className={cn('grid w-full grid-cols-4 gap-3', onTap && 'cursor-pointer')}>
      {[0, 1, 2, 3].map((i) => {
        const filled = i < value.length
        const here = active && value.length === i
        return (
          <motion.span key={i}
            animate={error ? { x: [0, -7, 7, -5, 5, 0] } : { x: 0, scale: filled ? [1, 1.1, 1] : 1 }}
            transition={{ duration: error ? 0.35 : 0.22 }}
            className={cn('relative flex h-16 w-full items-center justify-center overflow-hidden rounded-2xl border-2 transition-colors duration-150',
              error ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
                : filled ? 'border-green-600 bg-green-600'
                : here ? 'border-green-500 bg-white shadow-[0_0_0_4px_rgba(16,185,129,0.18)] dark:bg-night-700'
                : 'border-green-200 bg-white dark:border-night-500 dark:bg-night-700')}>
            <AnimatePresence>
              {filled && (
                <motion.span key="dot" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 22 }}
                  className="block h-3.5 w-3.5 rounded-full bg-white" />
              )}
            </AnimatePresence>
            {here && !error && <motion.span aria-hidden className="absolute h-6 w-0.5 rounded bg-green-500" animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} />}
          </motion.span>
        )
      })}
    </div>
  )
}

/** The app's own number pad. Because the PIN is always 4 digits the phone keyboard is never needed, so it can never
 *  cover the screen or push a sheet out of place. */
export function PinPad({ onDigit, onBackspace, disabled }: { onDigit: (d: string) => void; onBackspace: () => void; disabled?: boolean }) {
  const buzz = () => { try { navigator.vibrate?.(8) } catch { /* not supported */ } }
  const key = 'flex h-14 select-none items-center justify-center rounded-2xl text-2xl font-extrabold text-green-950 dark:text-white disabled:opacity-40'
  return (
    <div className="grid w-full grid-cols-3 gap-2.5" role="group" aria-label="PIN keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <motion.button key={d} type="button" disabled={disabled} whileTap={{ scale: 0.92 }} aria-label={d}
          onClick={() => { buzz(); onDigit(d) }} className={cn(key, 'bg-green-50 active:bg-green-200 dark:bg-night-600 dark:active:bg-night-500')}>{d}</motion.button>
      ))}
      <span aria-hidden />
      <motion.button type="button" disabled={disabled} whileTap={{ scale: 0.92 }} aria-label="0"
        onClick={() => { buzz(); onDigit('0') }} className={cn(key, 'bg-green-50 active:bg-green-200 dark:bg-night-600 dark:active:bg-night-500')}>0</motion.button>
      <motion.button type="button" disabled={disabled} whileTap={{ scale: 0.92 }} aria-label="Delete last digit"
        onClick={() => { buzz(); onBackspace() }} className={cn(key, 'text-green-700 active:bg-green-100 dark:text-night-100 dark:active:bg-night-500')}><Delete className="h-6 w-6" /></motion.button>
    </div>
  )
}

/** One PIN: boxes plus the in-app keypad. Drop-in replacement for the old PinBoxes (same props). */
export function PinBoxes({ value, onChange, onComplete, label = 'PIN', error, keypad = true, autoFocus = true }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean; label?: string; error?: boolean; keypad?: boolean
}) {
  const valueRef = useRef(value)
  valueRef.current = value
  const add = useCallback((d: string) => {
    const cur = valueRef.current
    if (cur.length >= 4) return
    const v = cur + d
    valueRef.current = v
    onChange(v)
    if (v.length === 4) onComplete?.(v)
  }, [onChange, onComplete])
  const back = useCallback(() => { const v = valueRef.current.slice(0, -1); valueRef.current = v; onChange(v) }, [onChange])
  useDigitKeys(autoFocus, add, back)
  return (
    <div className="w-full space-y-5">
      <PinDisplay value={value} error={error} label={label} />
      {keypad && <PinPad onDigit={add} onBackspace={back} />}
    </div>
  )
}

/** Several PINs on one screen (e.g. current / new / again) sharing ONE keypad. Moves on by itself when a box is full. */
export function PinFields({ fields }: { fields: { label: string; value: string; onChange: (v: string) => void; error?: boolean }[] }) {
  const [active, setActive] = useState(() => Math.max(0, fields.findIndex((f) => f.value.length < 4)))
  const ref = useRef({ fields, active })
  ref.current = { fields, active }
  const add = useCallback((d: string) => {
    const { fields: fs, active: a } = ref.current
    const f = fs[a]
    if (!f || f.value.length >= 4) return
    const v = f.value + d
    f.onChange(v)
    if (v.length === 4 && a < fs.length - 1) setTimeout(() => setActive(a + 1), 160)
  }, [])
  const back = useCallback(() => {
    const { fields: fs, active: a } = ref.current
    const f = fs[a]
    if (!f) return
    if (f.value.length === 0 && a > 0) { setActive(a - 1); return }
    f.onChange(f.value.slice(0, -1))
  }, [])
  useDigitKeys(true, add, back)
  return (
    <div className="w-full space-y-4">
      {fields.map((f, i) => (
        <div key={f.label} className="text-center">
          <p className={cn('mb-1.5 text-[11px] font-bold uppercase tracking-wide', i === active ? 'text-green-700 dark:text-green-300' : 'text-green-600/70 dark:text-night-300')}>{f.label}</p>
          <PinDisplay value={f.value} active={i === active} error={f.error} label={f.label} onTap={() => setActive(i)} />
        </div>
      ))}
      <PinPad onDigit={add} onBackspace={back} />
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
          <div className="absolute inset-0 bg-green-950/70" onClick={() => !busy && finish(null)} />
          <motion.div role="dialog" aria-modal="true" aria-label={title}
            className="relative max-h-[100dvh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-center shadow-2xl dark:bg-night-800 sm:rounded-3xl"
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 320 }}>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              {mode === 'enter' ? <Lock className="h-7 w-7 text-green-700 dark:text-green-300" /> : <ShieldCheck className="h-7 w-7 text-green-700 dark:text-green-300" />}
            </div>
            <h2 className="text-lg font-extrabold text-green-950 dark:text-white">{title}</h2>
            {current.message && mode === 'enter' && <p className="mt-1 text-sm text-green-700 dark:text-night-200">{current.message}</p>}

            {mode === 'enter' && (
              <div className="mt-5 space-y-4">
                <PinBoxes value={pin} onChange={(v) => { setPin(v); setErr('') }} onComplete={(v) => { setTimeout(() => finish(v), 150) }} error={!!err} />
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
                  <PasswordInput autoComplete="current-password" placeholder="Login password" value={loginPw} onChange={(e) => setLoginPw(e.target.value)}
                    className="w-full rounded-xl border border-green-200 bg-white px-3 py-3 text-sm dark:border-night-500 dark:bg-night-700 dark:text-white" />
                )}
                <PinFields fields={[
                  { label: 'New PIN', value: pin, onChange: (v) => { setPin(v); setErr('') } },
                  { label: 'Type it again', value: again, onChange: (v) => { setAgain(v); setErr('') }, error: again.length === 4 && again !== pin },
                ]} />
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
