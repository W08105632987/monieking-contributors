import { useAuthStore } from '@/store/auth.store'
import { useKycGateStore } from '@/store/kyc.store'
import type { AuthUser } from '@/types'

/** Customers and officers must finish KYC (NIN) before they can use the app's services. Directors and workers are never gated. */
export function needsKyc(user: Pick<AuthUser, 'role' | 'nin_linked' | 'bvn_linked'> | null | undefined): boolean {
  if (!user) return false
  return (user.role === 'customer' || user.role === 'officer') && !(user.nin_linked || user.bvn_linked)
}

export const kycPath = (role?: string) => (role === 'officer' ? '/officer/kyc' : '/customer/kyc')

/** Call at the top of any "Next / Pay / Submit" handler. Returns false (and shows the "Complete your KYC" box) when KYC is missing. */
export function ensureKyc(): boolean {
  const user = useAuthStore.getState().user
  if (!needsKyc(user)) return true
  useKycGateStore.getState().show()
  return false
}
