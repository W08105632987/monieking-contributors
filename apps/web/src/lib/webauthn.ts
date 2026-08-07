import { startRegistration, startAuthentication, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser'
import { api } from '@/lib/api'

export async function isBiometricAvailable(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false
  try {
    return await platformAuthenticatorIsAvailable()
  } catch {
    return false
  }
}

/** Enroll a new fingerprint credential for the currently logged-in user. */
export async function enrollBiometric(nickname: string): Promise<void> {
  const { data: options } = await api.post('/webauthn/register/options')
  const credential = await startRegistration(options)
  await api.post('/webauthn/register/verify', { credential, nickname })
}

/** List the current user's registered biometric devices. */
export async function listBiometricCredentials() {
  const { data } = await api.get('/webauthn/credentials')
  return data as { id: string; nickname: string; created_at: string; last_used_at: string | null }[]
}

export async function removeBiometricCredential(id: string): Promise<void> {
  await api.delete(`/webauthn/credentials/${id}`)
}

/**
 * Passwordless login. The backend verifies the WebAuthn assertion and
 * sets the session as httpOnly cookies itself (see /webauthn/login/verify)
 * — this just returns the resulting user profile, there's no token for
 * the caller to handle anymore.
 */
export async function loginWithBiometric(phoneNumber: string) {
  const { data: options } = await api.post('/webauthn/login/options', { phone_number: phoneNumber })
  const credential = await startAuthentication(options)
  const { data: user } = await api.post('/webauthn/login/verify', {
    phone_number: phoneNumber,
    credential,
  })
  return user
}

/**
 * Step-up verification before a sensitive action (withdrawal, bank
 * details change). Returns the raw assertion JSON to include directly
 * in the action's request body as `webauthn_assertion` — the backend
 * verifies it inline against a challenge it just issued.
 */
export async function getStepUpAssertion(): Promise<object> {
  const { data: options } = await api.post('/webauthn/step-up/options')
  return await startAuthentication(options)
}
