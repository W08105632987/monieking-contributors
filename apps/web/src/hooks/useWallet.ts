import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useWalletStore } from '@/store/wallet.store'
import { useAuthStore } from '@/store/auth.store'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import type { Wallet, PaginatedResponse, WalletTransaction } from '@/types'

export function useWallet() {
  const { setWallet, setTransactions } = useWalletStore()
  const { isAuthenticated } = useAuthStore()
  const prevBalanceRef = useRef<number | null>(null)

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data } = await api.get<Wallet>('/wallets/me')
      setWallet(data)
      return data
    },
    staleTime: 1000 * 2, // 2s freshness
    refetchInterval: 4000, // Poll every 4 seconds for live balance
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
    staleTime: 1000 * 4,
    refetchInterval: 5000, // Poll transactions every 5s
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  // Detect incoming credit and show real-time celebratory toast
  useEffect(() => {
    const currentBalance = walletQuery.data?.balance_kobo
    if (currentBalance !== undefined) {
      if (prevBalanceRef.current !== null && currentBalance > prevBalanceRef.current) {
        const diffNaira = (currentBalance - prevBalanceRef.current) / 100
        toast.success(`Wallet credited with ₦${diffNaira.toLocaleString()}`, {
          icon: '💰',
          duration: 5000,
        })
        txQuery.refetch()
      }
      prevBalanceRef.current = currentBalance
    }
  }, [walletQuery.data?.balance_kobo])

  // Supabase Realtime channel for instant push updates if available
  useEffect(() => {
    const walletId = walletQuery.data?.id
    if (!walletId || !isAuthenticated) return

    // Unique channel name per hook instance to prevent collision when multiple
    // components (e.g. WalletPage and FundWalletSheet) use this hook simultaneously.
    const channelName = `realtime-wallet-${walletId}-${Math.random().toString(36).slice(2, 9)}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallets',
          filter: `id=eq.${walletId}`,
        },
        () => {
          walletQuery.refetch()
          txQuery.refetch()
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'wallet_transactions',
          filter: `wallet_id=eq.${walletId}`,
        },
        () => {
          walletQuery.refetch()
          txQuery.refetch()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [walletQuery.data?.id, isAuthenticated])

  return {
    wallet:       walletQuery.data,
    transactions: txQuery.data?.data ?? [],
    isLoading:    walletQuery.isLoading,
    refetch:      async () => {
      await Promise.all([walletQuery.refetch(), txQuery.refetch()])
    },
  }
}