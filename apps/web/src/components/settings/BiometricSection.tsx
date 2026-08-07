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
      <div className="w-full flex items-center justify-between bg-white rounded-2xl border border-green-100 shadow-card p-4 opacity-60">
        <div className="flex items-center gap-2.5 text-left">
          <Fingerprint className="w-4 h-4 flex-shrink-0 text-green-300" />
          <div>
            <p className="text-green-900 font-bold text-sm">Biometric authentication</p>
            <p className="text-green-400 text-[11px] mt-0.5">Coming soon</p>
          </div>
        </div>
        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full flex-shrink-0">SOON</span>
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
      <div className="bg-white rounded-2xl border border-green-100 shadow-card p-4">
        <p className="text-green-900 font-bold text-sm mb-1">Biometric authentication</p>
        <p className="text-green-400 text-xs">Not available on this device or browser.</p>
      </div>
    )
  }

  return (
    <button
      onClick={handleToggle}
      disabled={busy}
      className="w-full flex items-center justify-between bg-white rounded-2xl border border-green-100 shadow-card p-4 transition-colors disabled:opacity-70"
    >
      <div className="flex items-center gap-2.5 text-left">
        <Fingerprint className={`w-4 h-4 flex-shrink-0 ${isOn ? 'text-green-600' : 'text-green-300'} ${busy && !isOn ? 'animate-pulse' : ''}`} />
        <div>
          <p className="text-green-900 font-bold text-sm">Biometric authentication</p>
          <p className="text-green-400 text-[11px] mt-0.5">
            {busy ? (isOn ? 'Turning off…' : 'Waiting for fingerprint…') : (isOn ? 'On for login and withdrawals' : 'Off')}
          </p>
        </div>
      </div>
      <div className={`w-11 h-6 rounded-full flex items-center px-0.5 transition-colors flex-shrink-0 ${isOn ? 'bg-green-700 justify-end' : 'bg-green-100 justify-start'}`}>
        <div className="w-5 h-5 rounded-full bg-white shadow" />
      </div>
    </button>
  )
}
