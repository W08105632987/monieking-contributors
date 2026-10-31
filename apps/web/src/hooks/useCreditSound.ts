import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useWalletStore } from '@/store/wallet.store'
import { installAudioUnlock } from '@/lib/notificationFeedback'
import { registerBalance, creditFromPush, resetCreditTracker } from '@/lib/coinSound'
import { isWalletFundedTitle } from '@/lib/creditTracker'
import type { Wallet } from '@/types'

/**
 * Mount ONCE at app-shell level. Plays the coin sound when money enters the
 * wallet: seen through the balance (any screen, via the shared tracker) or
 * through a "Wallet funded" push forwarded by the service worker while the app
 * is open. Debits never play it.
 */
export function useCreditSound() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const userId = useAuthStore((s) => s.user?.id)
  const storeBalance = useWalletStore((s) => s.wallet?.balance_kobo)

  useEffect(() => installAudioUnlock(), [])

  // fresh baseline for every login / account switch so a different balance is never "a credit"
  useEffect(() => { resetCreditTracker() }, [userId])

  // keeps the balance fresh on screens that do not use useWallet (same cache key, deduped)
  const { data } = useQuery({
    queryKey: ['wallet'],
    enabled: isAuthenticated,
    queryFn: async () => (await api.get<Wallet>('/wallets/me')).data,
    staleTime: 2000,
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (isAuthenticated && data?.balance_kobo !== undefined) registerBalance(data.balance_kobo)
  }, [data?.balance_kobo, isAuthenticated])

  useEffect(() => {
    if (isAuthenticated && storeBalance !== undefined) registerBalance(storeBalance)
  }, [storeBalance, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !navigator.serviceWorker) return
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'push-received' && isWalletFundedTitle(e.data.title)) creditFromPush()
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [isAuthenticated])
}
