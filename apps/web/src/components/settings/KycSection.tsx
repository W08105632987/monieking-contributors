import { useState, useEffect, useRef } from 'react'
import { ShieldCheck, Eye, EyeOff, Fingerprint, CreditCard, X, Calendar } from 'lucide-react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { isBiometricAvailable, getStepUpAssertion } from '@/lib/webauthn'
import { FEATURE_FLAGS } from '@/config/featureFlags'

interface KycSectionProps {
  bvnLinked: boolean
  ninLinked: boolean
  bvnLast4: string | null
  ninLast4: string | null
  hasVirtualAccount: boolean
  onVerified: (fields: { bvnLinked: boolean; ninLinked: boolean; bvnLast4: string | null; ninLast4: string | null }) => void
}

export function KycSection({ bvnLinked, ninLinked, bvnLast4, ninLast4, hasVirtualAccount, onVerified, isLast = false }: KycSectionProps & { isLast?: boolean }) {
  const [open, setOpen] = useState(false)
  const tier = bvnLinked && ninLinked ? 'Full' : (bvnLinked || ninLinked) ? 'Basic' : 'Not verified'
  const tierColor = tier === 'Full'
    ? 'text-green-600 dark:text-green-300 bg-green-50 dark:bg-green-500/10'
    : tier === 'Basic'
    ? 'text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10'
    : 'text-red-500 dark:text-red-300 bg-red-50 dark:bg-red-500/10'

  return (
    <>
      {/* Same row shape as every other row in this card (InfoRow /
          MenuRow): icon in a rounded box on the left, text next to it,
          a bottom border shared with the row below — not its own
          independent "mini card" look. `isLast` drops that border when
          this is the last row in whichever card it's placed in
          (matches InfoRow's own last:border-0 behavior, done via a
          prop here instead since this component isn't always literally
          the last DOM child where it's used). */}
      <button
        onClick={() => setOpen(true)}
        className={`w-full flex items-center gap-3 py-3.5 active:bg-green-50/50 dark:active:bg-white/5 transition-all text-left ${isLast ? '' : 'border-b border-green-50 dark:border-night-600'}`}
      >
        <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
          <CreditCard className="w-4 h-4 text-green-500 dark:text-night-200" />
        </div>
        <div className="flex-1">
          <p className="text-green-900 dark:text-white text-sm font-semibold">Identity verification</p>
          {tier !== 'Full' && (
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
              {tier === 'Not verified' ? 'Verify to raise your transaction limit' : 'Add the other ID for the highest limit'}
            </p>
          )}
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${tierColor}`}>{tier}</span>
      </button>

      {open && (
        <KycSheet
          bvnLinked={bvnLinked} ninLinked={ninLinked}
          bvnLast4={bvnLast4} ninLast4={ninLast4}
          hasVirtualAccount={hasVirtualAccount}
          onClose={() => setOpen(false)}
          onVerified={onVerified}
        />
      )}
    </>
  )
}

function KycSheet({ bvnLinked, ninLinked, bvnLast4, ninLast4, hasVirtualAccount, onClose, onVerified }: KycSectionProps & { onClose: () => void }) {
  const [bvn, setBvn]             = useState('')
  const [nin, setNin]             = useState('')
  const [dob, setDob]             = useState('')
  const [password, setPassword]   = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioLoading, setBioLoading]     = useState(false)
  const [saving, setSaving]             = useState(false)
  const autoPromptedRef = useRef(false)

  useEffect(() => { if (FEATURE_FLAGS.BIOMETRICS_ENABLED) isBiometricAvailable().then(setBioAvailable) }, [])

  const bvnReady = bvn.length === 11 && !bvnLinked
  const ninReady = nin.length === 11 && !ninLinked
  const dobReady = !bvnReady || dob.length === 10
  const canSubmit = (bvnReady || ninReady) && dobReady

  const submitWithPassword = async () => {
    if (!canSubmit) return toast.error(!dobReady ? 'Enter your date of birth' : 'Enter your 11-digit BVN and/or NIN')
    if (!password) return toast.error('Enter your withdrawal password')
    await submit({ withdrawal_password: password, auth_method: 'password' })
  }

  const submitWithBiometric = async (silent = false) => {
    if (!canSubmit) return
    setBioLoading(true)
    try {
      const assertion = await getStepUpAssertion()
      await submit({ webauthn_assertion: assertion, auth_method: 'biometric' })
    } catch (err) {
      // Silent = auto-triggered the moment the password field was
      // focused — a dismissed/failed prompt there just falls back to
      // typing the password, no error toast. Only the explicit
      // fingerprint-icon tap shows one.
      if (!silent) toast.error(getErrorMessage(err))
    } finally {
      setBioLoading(false)
    }
  }

  const handlePasswordFocus = () => {
    if (autoPromptedRef.current) return
    if (!bioAvailable || !canSubmit) return
    autoPromptedRef.current = true
    submitWithBiometric(true)
  }

  const submit = async (authPayload: Record<string, any>) => {
    setSaving(true)
    try {
      await api.post('/wallets/me/submit-kyc', {
        bvn: bvnReady ? bvn : undefined,
        nin: ninReady ? nin : undefined,
        date_of_birth: bvnReady ? dob : undefined,
        ...authPayload,
      })
      toast.success(hasVirtualAccount ? 'Identity verification updated' : 'Verified — your account number is ready ✓')
      onVerified({
        bvnLinked: bvnLinked || bvnReady,
        ninLinked: ninLinked || ninReady,
        bvnLast4:  bvnReady ? bvn.slice(-4) : bvnLast4,
        ninLast4:  ninReady ? nin.slice(-4) : ninLast4,
      })
      onClose()
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        <button onClick={onClose} className="absolute top-5 right-5 w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
          <X className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>

        <h2 className="text-green-900 dark:text-white font-extrabold text-xl mb-1 pr-10">Identity verification</h2>
        <p className="text-green-400 dark:text-night-300 text-xs leading-relaxed mb-5">
          Required by the Central Bank of Nigeria to raise your transaction limit. Your BVN and NIN are
          sent directly to Monnify, our licensed payment processor, to confirm they're really yours —
          we don't store the full numbers, only that they've been linked, and the last 4 digits for your
          own reference.
        </p>

        <div className="mb-4">
          <label className="text-green-500 dark:text-night-200 text-xs font-semibold mb-1 block">
            BVN {bvnLinked && <span className="text-green-600 dark:text-green-300">· linked, ends {bvnLast4}</span>}
          </label>
          <input
            value={bvnLinked ? '' : bvn}
            onChange={e => setBvn(e.target.value.replace(/\D/g, '').slice(0, 11))}
            disabled={bvnLinked}
            inputMode="numeric"
            placeholder={bvnLinked ? 'Already linked' : '11-digit BVN'}
            className="w-full border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 rounded-xl px-4 py-2.5 text-sm text-green-900 dark:text-white disabled:bg-green-50 dark:disabled:bg-night-600 disabled:text-green-300 dark:disabled:text-night-400"
          />
        </div>

        {bvnReady && (
          <div className="mb-4">
            <label className="text-green-500 dark:text-night-200 text-xs font-semibold mb-1 block flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Date of birth
            </label>
            <input
              type="date"
              value={dob}
              onChange={e => setDob(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 rounded-xl px-4 py-2.5 text-sm text-green-900 dark:text-white"
            />
            <p className="text-green-400 dark:text-night-300 text-[11px] mt-1">Needed to confirm the BVN belongs to you — must match your BVN record exactly.</p>
          </div>
        )}

        <div className="mb-4">
          <label className="text-green-500 dark:text-night-200 text-xs font-semibold mb-1 block">
            NIN {ninLinked && <span className="text-green-600 dark:text-green-300">· linked, ends {ninLast4}</span>}
          </label>
          <input
            value={ninLinked ? '' : nin}
            onChange={e => setNin(e.target.value.replace(/\D/g, '').slice(0, 11))}
            disabled={ninLinked}
            inputMode="numeric"
            placeholder={ninLinked ? 'Already linked' : '11-digit NIN'}
            className="w-full border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 rounded-xl px-4 py-2.5 text-sm text-green-900 dark:text-white disabled:bg-green-50 dark:disabled:bg-night-600 disabled:text-green-300 dark:disabled:text-night-400"
          />
        </div>

        {(bvnReady || ninReady) && (
          <>
            <div className="flex items-center gap-2 bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2.5 mb-4">
              <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-300 flex-shrink-0" />
              <p className="text-green-900 dark:text-white text-xs">Confirm with your withdrawal password or fingerprint to continue</p>
            </div>

            <div className="relative mb-4">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={handlePasswordFocus}
                placeholder="Withdrawal password"
                className="w-full border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 rounded-xl pl-4 pr-16 py-2.5 text-sm text-green-900 dark:text-white"
              />
              {bioAvailable && (
                <button
                  type="button"
                  onClick={() => submitWithBiometric(false)}
                  disabled={bioLoading}
                  aria-label="Confirm with fingerprint"
                  className="absolute right-9 top-1/2 -translate-y-1/2 text-green-600 dark:text-night-200 disabled:opacity-40"
                >
                  <Fingerprint className={`w-4 h-4 ${bioLoading ? 'animate-pulse' : ''}`} />
                </button>
              )}
              <button onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              onClick={submitWithPassword}
              disabled={saving || bioLoading || !canSubmit}
              className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-sm rounded-full py-3.5 disabled:opacity-40"
            >
              {saving ? 'Verifying…' : bioLoading ? 'Confirm with fingerprint…' : 'Verify & activate'}
            </button>
          </>
        )}
      </motion.div>
    </div>
  )
}
