import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Fingerprint, KeyRound } from 'lucide-react'
import { isBiometricAvailable, getStepUpAssertion } from '@/lib/webauthn'
import { FEATURE_FLAGS } from '@/config/featureFlags'
import { BigButton, Field, Sheet, inputCls } from './ui'
import { setStepUpHandler } from './stepup-bus'

export type AuthPayload = { auth_method: 'password' | 'biometric'; withdrawal_password?: string; webauthn_assertion?: object }

/**
 * Extra confirmation for money actions (rule: "Extra confirmation").
 * `ask(needed)` resolves with:
 *   undefined → no confirmation needed, carry on
 *   payload   → send it as `auth` in the request body
 *   null      → the person cancelled
 */
export function useAuthPrompt() {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [bio, setBio] = useState(false)
  const [busy, setBusy] = useState(false)
  const resolver = useRef<((v: AuthPayload | null) => void) | null>(null)

  const ask = useCallback(async (needed: boolean): Promise<AuthPayload | null | undefined> => {
    if (!needed) return undefined
    setPw('')
    setBio(FEATURE_FLAGS.BIOMETRICS_ENABLED ? await isBiometricAvailable() : false)
    setOpen(true)
    return new Promise((res) => { resolver.current = res })
  }, [])

  const finish = (v: AuthPayload | null) => { setOpen(false); resolver.current?.(v); resolver.current = null }

  const useBio = async () => {
    setBusy(true)
    try { finish({ auth_method: 'biometric', webauthn_assertion: await getStepUpAssertion() }) } catch { /* stay open */ } finally { setBusy(false) }
  }

  const sheet: ReactNode = (
    <Sheet open={open} onClose={() => finish(null)} title="Confirm it is you">
      <p className="mb-3 text-sm text-green-700 dark:text-night-200">This moves money, so please confirm with your withdrawal password{bio ? ' or your fingerprint' : ''}.</p>
      {bio && <div className="mb-3"><BigButton tone="ghost" loading={busy} onClick={useBio}><Fingerprint className="h-4 w-4" />Use fingerprint or face</BigButton></div>}
      <Field label="Withdrawal password"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} aria-label="Withdrawal password" /></Field>
      <div className="mt-4"><BigButton disabled={!pw} onClick={() => finish({ auth_method: 'password', withdrawal_password: pw })}><KeyRound className="h-4 w-4" />Confirm</BigButton></div>
    </Sheet>
  )
  return { ask, sheet }
}

/** Mounted once per cooperative page: answers "please confirm it is you" for any request that needs it. */
export function StepUpHost() {
  const { ask, sheet } = useAuthPrompt()
  useEffect(() => {
    setStepUpHandler(() => ask(true))
    return () => setStepUpHandler(null)
  }, [ask])
  return <>{sheet}</>
}

/** A new key per user action: a double tap or a retry after a bad connection cannot move money twice. */
export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
