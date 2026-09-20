import { useState, useEffect } from 'react'
import { Fingerprint } from 'lucide-react'
import toast from 'react-hot-toast'
import { getErrorMessage } from '@/lib/api'
import { isBiometricAvailable, enrollBiometric, listBiometricCredentials, removeBiometricCredential } from '@/lib/webauthn'
import { FEATURE_FLAGS } from '@/config/featureFlags'

interface Credential {
  id: string
  nickname: string
  created_at: string
  last_used_at: string | null
}

/**
 * Lives inside the Security card now (see Profile pages), as a row
 * matching every other row there — not its own standalone card.
 * Always the last row in that card, so no bottom border on any of its
 * three possible states below (disabled-by-flag, unavailable, live).
 */
export function BiometricSection() {
  // Temporarily disabled app-wide — see config/featureFlags.ts. Shown as
  // a disabled row with a "Coming soon" badge instead of a working
  // toggle, so nobody can turn biometrics on right now, but nothing
  // about the underlying enroll/login/step-up code changes. Split into
  // a separate no-hooks wrapper (rather than an early return inside the
  // hook-using component) so this can't ever trip React's rules of
  // hooks, regardless of how the flag is read.
  if (!FEATURE_FLAGS.BIOMETRICS_ENABLED) {
    return (
      <div className="w-full flex items-center gap-3 py-3.5 opacity-60">
        <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
          <Fingerprint className="w-4 h-4 text-green-300 dark:text-night-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-green-900 dark:text-white text-sm font-semibold">Biometric authentication</p>
          <p className="text-green-400 dark:text-night-300 text-[11px] mt-0.5">Coming soon</p>
        </div>
        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-1 rounded-full flex-shrink-0">SOON</span>
      </div>
    )
  }
  return <BiometricSectionLive />
}

function BiometricSectionLive() {
  const [available, setAvailable]     = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [busy, setBusy]               = useState(false)

  const refresh = async () => {
    try {
      setCredentials(await listBiometricCredentials())
    } catch { /* not fatal — toggle just shows as off */ }
  }

  useEffect(() => {
    isBiometricAvailable().then(setAvailable)
    refresh()
  }, [])

  const isOn = credentials.length > 0

  // Turning the toggle ON is the ONLY step — it goes straight into the
  // device's native fingerprint prompt. No intermediate confirmation
  // screen, no separate "set up" button first.
  const handleToggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (isOn) {
        // Turning off: remove every enrolled credential for this device/account.
        await Promise.all(credentials.map(c => removeBiometricCredential(c.id)))
        toast.success('Biometric authentication turned off')
      } else {
        await enrollBiometric('Fingerprint')
        toast.success('Biometric authentication turned on')
      }
      await refresh()
    } catch (e) {
      // A dismissed or failed fingerprint prompt just leaves the toggle
      // off — no scary error, since this is exactly the same
      // "cancel and nothing happens" behavior every other app has.
      const msg = getErrorMessage(e)
      if (msg) toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  if (!available) {
    return (
      <div className="w-full flex items-center gap-3 py-3.5">
        <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
          <Fingerprint className="w-4 h-4 text-green-300 dark:text-night-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-green-900 dark:text-white text-sm font-semibold">Biometric authentication</p>
          <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">Not available on this device or browser.</p>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={handleToggle}
      disabled={busy}
      className="w-full flex items-center gap-3 py-3.5 active:bg-green-50/50 dark:active:bg-white/5 transition-all disabled:opacity-70 text-left"
    >
      <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
        <Fingerprint className={`w-4 h-4 ${isOn ? 'text-green-600 dark:text-green-300' : 'text-green-300 dark:text-night-400'} ${busy && !isOn ? 'animate-pulse' : ''}`} />
      </div>
      <div className="flex-1">
        <p className="text-green-900 dark:text-white text-sm font-semibold">Biometric authentication</p>
        <p className="text-green-400 dark:text-night-300 text-[11px] mt-0.5">
          {busy ? (isOn ? 'Turning off…' : 'Waiting for fingerprint…') : (isOn ? 'On for login and withdrawals' : 'Off')}
        </p>
      </div>
      <div className={`w-11 h-6 rounded-full flex items-center px-0.5 transition-colors flex-shrink-0 ${isOn ? 'bg-green-700 justify-end' : 'bg-green-100 dark:bg-night-500 justify-start'}`}>
        <div className="w-5 h-5 rounded-full bg-white shadow" />
      </div>
    </button>
  )
}
