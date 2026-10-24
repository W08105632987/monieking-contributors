import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { PinBoxes } from '@/components/ui/PinHost'

function Sheet({ title, sub, onClose, children }: { title: string; sub: string; onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[10005] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative w-full max-w-lg rounded-t-3xl bg-white p-6 pb-10 dark:bg-night-700 max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-green-200 dark:bg-night-500" />
        <h2 className="text-xl font-extrabold text-green-900 dark:text-white">{title}</h2>
        <p className="mb-5 mt-1 text-sm text-green-600 dark:text-night-200">{sub}</p>
        {children}
      </motion.div>
    </div>, document.body)
}

const primary = 'w-full rounded-2xl bg-green-700 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50'

/** Set or change the 4-digit payment PIN. First time needs no current PIN. */
export function PinSheet({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const has = !!user?.has_payment_pin
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const ready = pin.length === 4 && again.length === 4 && (!has || current.length === 4)
  const save = async () => {
    if (busy || !ready) return
    if (pin !== again) return setErr('The two PINs do not match.')
    setBusy(true); setErr('')
    try {
      await api.post('/auth/set-pin', { pin, ...(has ? { current_pin: current } : {}) })
      if (user) setUser({ ...user, has_payment_pin: true })
      setDone(true)
      setTimeout(onClose, 1100)
    } catch (e) { setErr(getErrorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title={has ? 'Change payment PIN' : 'Set up payment pin'} onClose={onClose}
      sub="Your 4-digit PIN approves airtime, bills, identity services and other actions in the app.">
      {done ? <p className="py-8 text-center text-sm font-bold text-green-700">PIN saved ✓</p> : (
        <div className="space-y-5 text-center">
          {has && <div><p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">Current PIN</p><PinBoxes value={current} onChange={setCurrent} label="Current PIN" /></div>}
          <div><p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">New PIN</p><PinBoxes value={pin} onChange={setPin} autoFocus={!has} label="New PIN" /></div>
          <div><p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">Type it again</p><PinBoxes value={again} onChange={setAgain} autoFocus={false} label="Confirm PIN" error={again.length === 4 && again !== pin} /></div>
          {err && <p role="alert" className="text-xs font-semibold text-red-600">{err}</p>}
          <button disabled={!ready || busy} onClick={save} className={primary}>{busy ? 'Please wait…' : 'Save PIN'}</button>
        </div>
      )}
    </Sheet>
  )
}

/** First-time set (no current password to verify). Changing it later stays in the profile page. */
export function WithdrawalPasswordSheet({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const input = 'w-full rounded-xl border border-green-200 bg-white px-4 py-3 text-sm text-green-900 dark:border-night-500 dark:bg-night-800 dark:text-white'
  const save = async () => {
    if (busy) return
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    if (/^\d+$/.test(pw)) return setErr('It cannot be all numbers. Add a letter or symbol.')
    if (pw !== again) return setErr('The two passwords do not match.')
    setBusy(true); setErr('')
    try {
      await api.post('/auth/set-withdrawal-password', { withdrawal_password: pw })
      if (user) setUser({ ...user, has_withdrawal_password: true })
      setDone(true)
      setTimeout(onClose, 1100)
    } catch (e) { setErr(getErrorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Set withdrawal password" onClose={onClose} sub="You will enter this every time you withdraw from your card or your cooperative. Keep it different from your login password and your PIN.">
      {done ? <p className="py-8 text-center text-sm font-bold text-green-700">Withdrawal password saved ✓</p> : (
        <div className="space-y-3">
          <input type="password" autoComplete="new-password" className={input} placeholder="Withdrawal password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input type="password" autoComplete="new-password" className={input} placeholder="Type it again" value={again} onChange={(e) => setAgain(e.target.value)} />
          {err && <p role="alert" className="text-xs font-semibold text-red-600">{err}</p>}
          <button disabled={busy || !pw || !again} onClick={save} className={primary}>{busy ? 'Please wait…' : 'Save withdrawal password'}</button>
        </div>
      )}
    </Sheet>
  )
}

/** Add or confirm an email. Step 1: type it, we send a 6-digit code. Step 2: type the code. */
export function EmailSheet({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const waiting = user?.pending_email ?? null
  const [email, setEmail] = useState(waiting ?? '')
  const [stage, setStage] = useState<'enter' | 'code'>(waiting ? 'code' : 'enter')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [done, setDone] = useState(false)
  const input = 'w-full rounded-xl border border-green-200 bg-white px-4 py-3 text-sm text-green-900 dark:border-night-500 dark:bg-night-800 dark:text-white'

  const send = async (resend = false) => {
    if (busy) return
    const e = email.trim()
    if (!resend && !/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter a valid email address.')
    setBusy(true); setErr(''); setInfo('')
    try {
      const { data } = resend ? await api.post('/auth/email/resend') : await api.post('/auth/email/send-code', { email: e })
      if (user) setUser({ ...user, pending_email: e.toLowerCase() })
      setStage('code'); setInfo(data.message ?? '')
    } catch (x) { setErr(getErrorMessage(x)) } finally { setBusy(false) }
  }
  const verify = async () => {
    if (busy || code.length !== 6) return
    setBusy(true); setErr('')
    try {
      const { data } = await api.post('/auth/email/verify', { code })
      if (user) setUser({ ...user, email: data.email, email_verified: true, pending_email: null })
      setDone(true); setTimeout(onClose, 1100)
    } catch (x) { setErr(getErrorMessage(x)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      await api.delete('/auth/email')
      if (user) setUser({ ...user, email: null, email_verified: false, pending_email: null })
      onClose()
    } catch (x) { setErr(getErrorMessage(x)) } finally { setBusy(false) }
  }
  return (
    <Sheet title={user?.email_verified ? 'Change email' : 'Add your email'} onClose={onClose}
      sub="Use it to reset your password by email. It is optional, and we only email you codes and important notices.">
      {done ? <p className="py-8 text-center text-sm font-bold text-green-700">Email verified ✓</p> : stage === 'enter' ? (
        <div className="space-y-4">
          <input className={input} type="email" autoCapitalize="none" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          {err && <p role="alert" className="text-xs font-semibold text-red-600">{err}</p>}
          <button disabled={busy} onClick={() => send()} className={primary}>{busy ? 'Sending…' : 'Send code'}</button>
          {user?.email && <button disabled={busy} onClick={remove} className="w-full py-2 text-xs font-semibold text-red-600">Remove email</button>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-green-700 dark:text-night-200">{info || `Enter the 6-digit code we sent to ${email}.`}</p>
          <input className={`${input} text-center tracking-[0.4em]`} inputMode="numeric" placeholder="123456" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          {err && <p role="alert" className="text-xs font-semibold text-red-600">{err}</p>}
          <button disabled={busy || code.length !== 6} onClick={verify} className={primary}>{busy ? 'Checking…' : 'Verify email'}</button>
          <div className="flex justify-between text-xs font-semibold text-green-700 dark:text-night-200">
            <button disabled={busy} onClick={() => send(true)}>Resend code</button>
            <button disabled={busy} onClick={() => { setStage('enter'); setCode(''); setErr('') }}>Use a different email</button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
