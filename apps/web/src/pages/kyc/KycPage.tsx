import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, BadgeCheck, Check, Fingerprint, Lock, Phone, ScanLine, ShieldCheck, SkipForward, User } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { withPin, isPinCancelled } from '@/lib/pin'
import { fireConfetti } from '@/lib/confetti'
import { useAuthStore } from '@/store/auth.store'
import { StarfieldBackground } from '@/components/ui/StarfieldBackground'
import { useDarkMode } from '@/hooks/useDarkMode'
import { cn } from '@/lib/utils'

type Step = 0 | 1 | 2 | 3   // 0 name · 1 phone · 2 NIN · 3 done
interface Preview { verified_name: string; registered_name: string; name_matches: boolean; id_masked: string; proof: string; message: string | null }

const STEPS = [
  { title: 'Your name', icon: User },
  { title: 'Phone', icon: Phone },
  { title: 'NIN', icon: Fingerprint },
]

const slide = {
  initial: { opacity: 0, x: 60, scale: 0.97 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: -60, scale: 0.97 },
}

/** The full KYC page for customers and officers: name → phone (optional) → NIN → done. */
export default function KycPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { isDark } = useDarkMode()
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const home = user?.role === 'officer' ? '/officer/dashboard' : '/customer/dashboard'
  const alreadyDone = !!(user?.nin_linked || user?.bvn_linked)
  const [step, setStep] = useState<Step>(alreadyDone ? 3 : 0)

  // phone
  const [phoneState, setPhoneState] = useState<'idle' | 'sent' | 'verified'>(user?.phone_verified ? 'verified' : 'idle')
  const [code, setCode] = useState('')
  // nin
  const [nin, setNin] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shake, setShake] = useState(0)
  const [info, setInfo] = useState('')

  const fail = (e: unknown) => { setErr(getErrorMessage(e)); setShake((n) => n + 1) }
  const maskedPhone = useMemo(() => (user?.phone_number ? user.phone_number.replace(/^(\d{4})\d{3}(\d{4})$/, '$1•••$2') : ''), [user?.phone_number])

  const sendCode = async () => {
    if (busy) return
    setBusy(true); setErr(''); setInfo('')
    try {
      const { data } = await api.post('/wallets/me/kyc/phone/send')
      if (data.already) { setPhoneState('verified'); return }
      setPhoneState('sent'); setInfo(data.message ?? '')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const verifyCode = async () => {
    if (busy || code.length !== 6) return
    setBusy(true); setErr('')
    try {
      await api.post('/wallets/me/kyc/phone/verify', { code })
      setPhoneState('verified')
      if (user) setUser({ ...user, phone_verified: true })
      setTimeout(() => { setErr(''); setStep(2) }, 900)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const checkNin = async () => {
    if (busy || nin.length !== 11) return
    setBusy(true); setScanning(true); setErr(''); setPreview(null)
    const minimum = new Promise((r) => setTimeout(r, 1600))   // let the scan animation breathe, even on a fast answer
    try {
      const [{ data }] = await Promise.all([api.post<Preview>('/wallets/me/kyc/nin/preview', { number: nin }), minimum])
      setPreview(data)
    } catch (e) { await minimum; fail(e) } finally { setBusy(false); setScanning(false) }
  }

  const confirm = async () => {
    if (busy || !preview?.name_matches) return
    setBusy(true); setErr('')
    try {
      await withPin((pin) => api.post('/wallets/me/kyc/nin/confirm', { number: nin, proof: preview.proof, auth_method: 'password', pin }),
        { title: 'Confirm with your PIN', message: `Enter your 4-digit payment PIN to confirm ${preview.verified_name}.`, skipKyc: true })
      if (user) setUser({ ...user, nin_linked: true, nin_last4: nin.slice(-4), kyc_complete: true })
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
      setStep(3)
      fireConfetti({ count: 160, duration: 2600 })
    } catch (e) { if (!isPinCancelled(e)) fail(e) } finally { setBusy(false) }
  }

  const sparkles = useRef(Array.from({ length: 14 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 7) * 0.6, size: 4 + (i % 4) * 3 })))

  return (
    <div className="relative min-h-dvh overflow-hidden bg-hero-gradient dark:bg-night-gradient px-5 pb-10 pt-14 transition-colors duration-500">
      {isDark && <StarfieldBackground className="opacity-80" />}
      {/* drifting glow + sparkles */}
      <motion.div aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }} transition={{ duration: 6, repeat: Infinity }} />
      <motion.div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-green-400/20 blur-3xl"
        animate={{ scale: [1.1, 0.95, 1.1], opacity: [0.4, 0.7, 0.4] }} transition={{ duration: 7, repeat: Infinity }} />
      {sparkles.current.map((s, i) => (
        <motion.span key={i} aria-hidden className="pointer-events-none absolute rounded-full bg-white/40" style={{ left: `${s.left}%`, width: s.size, height: s.size, bottom: -10 }}
          animate={{ y: [0, -700], opacity: [0, 0.8, 0] }} transition={{ duration: 9 + (i % 5), repeat: Infinity, delay: s.delay, ease: 'easeOut' }} />
      ))}

      <div className="relative z-[1] mx-auto flex max-w-md flex-col">
        <button onClick={() => (step === 3 ? nav(home, { replace: true }) : nav(-1))} aria-label="Back"
          className="mb-6 flex h-9 w-9 items-center justify-center rounded-full bg-green-800/50 dark:bg-white/10">
          <ArrowLeft className="h-4 w-4 text-white" />
        </button>

        <motion.h1 initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-extrabold leading-tight text-white">
          {step === 3 ? 'KYC complete' : 'Verify your identity'}
        </motion.h1>
        <p className="mb-6 mt-1 text-sm text-green-200">
          {step === 3 ? 'Thank you — you now have full access.' : 'Three quick steps. It takes about a minute and you only do it once.'}
        </p>

        {/* progress rail */}
        {step < 3 && (
          <div className="mb-6 flex items-center" role="list" aria-label="KYC progress">
            {STEPS.map((s, i) => {
              const done = i < step || (i === 1 && phoneState === 'verified' && step > 1)
              const active = i === step
              return (
                <div key={s.title} className="flex flex-1 items-center last:flex-none" role="listitem">
                  <div className="flex flex-col items-center">
                    <motion.div animate={active ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={active ? { duration: 1.6, repeat: Infinity } : {}}
                      className={cn('flex h-11 w-11 items-center justify-center rounded-full border-2 transition-colors',
                        done ? 'border-green-400 bg-green-500 text-white' : active ? 'border-amber-300 bg-amber-400 text-green-950' : 'border-white/20 bg-white/10 text-white/60')}>
                      {done ? <Check className="h-5 w-5" strokeWidth={3} /> : <s.icon className="h-5 w-5" />}
                    </motion.div>
                    <span className={cn('mt-1 text-[11px] font-bold', active ? 'text-amber-300' : done ? 'text-green-300' : 'text-white/50')}>{s.title}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="mx-2 mb-5 h-1 flex-1 overflow-hidden rounded-full bg-white/15">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-green-400 to-amber-300" initial={{ width: 0 }} animate={{ width: i < step ? '100%' : '0%' }} transition={{ duration: 0.6 }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* ───── Step 1: name ───── */}
          {step === 0 && (
            <motion.div key="s0" {...slide} transition={{ type: 'spring', damping: 24, stiffness: 260 }}
              className="rounded-3xl bg-white/95 p-5 shadow-2xl dark:bg-night-700/95">
              <h2 className="text-lg font-extrabold text-green-950 dark:text-white">Is this your name?</h2>
              <p className="mt-1 text-xs text-green-600 dark:text-night-300">Taken from your registration. It must match the name on your NIN, so it can't be edited here.</p>
              <div className="relative mt-4 overflow-hidden rounded-2xl border border-green-200 bg-green-50 px-4 py-4 dark:border-night-500 dark:bg-night-600">
                <motion.span aria-hidden className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/10"
                  animate={{ x: ['0%', '420%'] }} transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.2 }} />
                <div className="relative flex items-center gap-3">
                  <Lock className="h-4 w-4 shrink-0 text-green-500" />
                  <span className="truncate text-base font-extrabold text-green-950 dark:text-white">{user?.full_name}</span>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-green-600 dark:text-night-300">Wrong name? Ask your officer to correct it before you verify.</p>
              <button onClick={() => setStep(1)} className="mt-5 w-full rounded-2xl bg-green-900 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] dark:bg-copper-400 dark:text-green-950">Yes, continue</button>
            </motion.div>
          )}

          {/* ───── Step 2: phone (optional) ───── */}
          {step === 1 && (
            <motion.div key="s1" {...slide} transition={{ type: 'spring', damping: 24, stiffness: 260 }}
              className="rounded-3xl bg-white/95 p-5 shadow-2xl dark:bg-night-700/95">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-extrabold text-green-950 dark:text-white">Confirm your phone</h2>
                <span className="rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-green-700 dark:bg-night-500 dark:text-night-100">Optional</span>
              </div>
              <p className="mt-1 text-xs text-green-600 dark:text-night-300">We text a 6-digit code to <b>{maskedPhone}</b> to confirm the number is yours. You can skip this and still finish KYC.</p>

              {phoneState === 'verified' ? (
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-5 flex items-center gap-3 rounded-2xl bg-green-50 p-4 dark:bg-green-900/20">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-white"><Check className="h-5 w-5" strokeWidth={3} /></span>
                  <span className="text-sm font-bold text-green-800 dark:text-green-300">Phone number confirmed</span>
                </motion.div>
              ) : phoneState === 'idle' ? (
                <button onClick={sendCode} disabled={busy} className="mt-5 w-full rounded-2xl bg-green-900 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50 dark:bg-copper-400 dark:text-green-950">
                  {busy ? 'Sending…' : 'Text me a code'}
                </button>
              ) : (
                <div className="mt-5">
                  {info && <p className="mb-2 text-xs font-semibold text-green-700 dark:text-night-200">{info}</p>}
                  <input value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr('') }} inputMode="numeric" autoFocus placeholder="••••••"
                    className="w-full rounded-2xl border-2 border-green-200 bg-white px-4 py-3.5 text-center text-2xl font-extrabold tracking-[0.5em] text-green-950 focus:border-green-600 focus:outline-none dark:border-night-500 dark:bg-night-800 dark:text-white" />
                  <button onClick={verifyCode} disabled={busy || code.length !== 6} className="mt-3 w-full rounded-2xl bg-green-900 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40 dark:bg-copper-400 dark:text-green-950">
                    {busy ? 'Checking…' : 'Confirm code'}
                  </button>
                  <button onClick={sendCode} disabled={busy} className="mt-2 w-full py-2 text-xs font-semibold text-green-700 dark:text-night-200">Send a new code</button>
                </div>
              )}

              {err && <motion.p key={shake} animate={{ x: [0, -6, 6, -4, 4, 0] }} role="alert" className="mt-3 text-xs font-semibold text-red-600">{err}</motion.p>}
              <button onClick={() => { setErr(''); setStep(2) }} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-semibold text-green-700 dark:text-night-200">
                {phoneState === 'verified' ? 'Continue' : <><SkipForward className="h-4 w-4" /> Skip for now</>}
              </button>
            </motion.div>
          )}

          {/* ───── Step 3: NIN ───── */}
          {step === 2 && (
            <motion.div key="s2" {...slide} transition={{ type: 'spring', damping: 24, stiffness: 260 }}
              className="rounded-3xl bg-white/95 p-5 shadow-2xl dark:bg-night-700/95">
              <h2 className="text-lg font-extrabold text-green-950 dark:text-white">Verify your NIN</h2>
              <p className="mt-1 text-xs text-green-600 dark:text-night-300">Enter your 11-digit National Identification Number. We check it against the official record and show you the name on it before you confirm.</p>

              {!preview && !scanning && (
                <>
                  <input value={nin} onChange={(e) => { setNin(e.target.value.replace(/\D/g, '').slice(0, 11)); setErr('') }} inputMode="numeric" autoFocus placeholder="12345678901"
                    className="mt-4 w-full rounded-2xl border-2 border-green-200 bg-white px-4 py-3.5 text-center text-xl font-extrabold tracking-[0.25em] text-green-950 focus:border-green-600 focus:outline-none dark:border-night-500 dark:bg-night-800 dark:text-white" />
                  <div className="mt-2 flex justify-center gap-1" aria-hidden>
                    {Array.from({ length: 11 }).map((_, i) => (
                      <motion.span key={i} animate={{ scale: i < nin.length ? 1 : 0.6, opacity: i < nin.length ? 1 : 0.3 }} className="h-1.5 w-1.5 rounded-full bg-green-600" />
                    ))}
                  </div>
                  {err && <motion.p key={shake} animate={{ x: [0, -6, 6, -4, 4, 0] }} role="alert" className="mt-3 text-center text-xs font-semibold text-red-600">{err}</motion.p>}
                  <button onClick={checkNin} disabled={busy || nin.length !== 11} className="mt-4 w-full rounded-2xl bg-green-900 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40 dark:bg-copper-400 dark:text-green-950">Verify my NIN</button>
                </>
              )}

              {scanning && (
                <div className="flex flex-col items-center py-8">
                  <div className="relative h-28 w-28">
                    <motion.span className="absolute inset-0 rounded-full border-4 border-green-300/60" animate={{ scale: [1, 1.5], opacity: [0.8, 0] }} transition={{ duration: 1.4, repeat: Infinity }} />
                    <motion.span className="absolute inset-0 rounded-full border-4 border-amber-300/60" animate={{ scale: [1, 1.5], opacity: [0.8, 0] }} transition={{ duration: 1.4, repeat: Infinity, delay: 0.5 }} />
                    <div className="absolute inset-3 flex items-center justify-center overflow-hidden rounded-full bg-green-900 dark:bg-night-500">
                      <Fingerprint className="h-12 w-12 text-green-200" />
                      <motion.span className="absolute inset-x-0 h-1 bg-amber-300/80 shadow-[0_0_12px_rgba(252,211,77,0.9)]" animate={{ top: ['10%', '85%', '10%'] }} transition={{ duration: 1.6, repeat: Infinity }} />
                    </div>
                  </div>
                  <p className="mt-5 flex items-center gap-2 text-sm font-bold text-green-900 dark:text-white"><ScanLine className="h-4 w-4" /> Checking official records…</p>
                </div>
              )}

              {preview && !scanning && (
                <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                  <div className={cn('relative overflow-hidden rounded-2xl p-4', preview.name_matches ? 'bg-green-50 dark:bg-night-600' : 'bg-red-50 dark:bg-red-900/20')}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">Name on NIN {preview.id_masked}</p>
                    <motion.p initial={{ filter: 'blur(8px)', opacity: 0 }} animate={{ filter: 'blur(0px)', opacity: 1 }} transition={{ duration: 0.8 }} className="mt-1 text-xl font-extrabold text-green-950 dark:text-white">{preview.verified_name}</motion.p>
                    {preview.name_matches ? (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-green-700 dark:text-green-300"><ShieldCheck className="h-4 w-4" /> Matches your MonieKing name</p>
                    ) : (
                      <p className="mt-2 text-xs font-semibold text-red-600">{preview.message}</p>
                    )}
                  </div>
                  {err && <p role="alert" className="mt-3 text-xs font-semibold text-red-600">{err}</p>}
                  {preview.name_matches && (
                    <button onClick={confirm} disabled={busy} className="mt-4 w-full rounded-2xl bg-green-900 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50 dark:bg-copper-400 dark:text-green-950">
                      {busy ? 'Completing…' : "Yes, that's me — confirm with PIN"}
                    </button>
                  )}
                  <button onClick={() => { setPreview(null); setErr(''); setNin('') }} disabled={busy} className="mt-2 w-full py-2.5 text-xs font-semibold text-green-700 dark:text-night-200">
                    {preview.name_matches ? 'Not me / use a different NIN' : 'Try a different NIN'}
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ───── Done ───── */}
          {step === 3 && (
            <motion.div key="s3" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', damping: 18 }}
              className="rounded-3xl bg-white/95 p-7 text-center shadow-2xl dark:bg-night-700/95">
              <div className="relative mx-auto mb-5 h-28 w-28">
                <motion.span className="absolute inset-0 rounded-full bg-green-400/30" animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }} transition={{ duration: 2.2, repeat: Infinity }} />
                <motion.div initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', damping: 12, delay: 0.1 }}
                  className="absolute inset-2 flex items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-green-700 shadow-lg">
                  <BadgeCheck className="h-14 w-14 text-white" />
                </motion.div>
              </div>
              <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="text-2xl font-extrabold text-green-950 dark:text-white">KYC complete 🎉</motion.h2>
              <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }} className="mt-2 text-sm leading-relaxed text-green-700 dark:text-night-200">
                Thank you{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}! Your identity is verified and you now have full access to the app — contributions, airtime, bills and every other service.
              </motion.p>
              <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} onClick={() => nav(home, { replace: true })}
                className="mt-6 w-full rounded-2xl bg-green-900 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] dark:bg-copper-400 dark:text-green-950">
                Go to my dashboard
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
