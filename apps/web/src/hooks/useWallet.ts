import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useWalletStore } from '@/store/wallet.store'
import { useAuthStore } from '@/store/auth.store'
import type { Wallet, PaginatedResponse, WalletTransaction } from '@/types'

export function useWallet() {
  const { setWallet, setTransactions } = useWalletStore()
  const { isAuthenticated } = useAuthStore()

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data } = await api.get<Wallet>('/wallets/me')
      setWallet(data)
      return data
    },
    staleTime: 1000 * 30,
  })

  const txQuery = useQuery({
    queryKey: ['wallet-transactions'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<WalletTransaction>>(
        '/wallets/me/transactions?page=1&page_size=20',
      )
      setTransactions(data.data)
      return data
    },
  })

  return {
    wallet:       walletQuery.data,
    transactions: txQuery.data?.data ?? [],
    isLoading:    walletQuery.isLoading,
    refetch:      walletQuery.refetch,
  }
}