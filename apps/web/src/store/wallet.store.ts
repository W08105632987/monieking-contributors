import { create } from 'zustand'
import type { Wallet, WalletTransaction } from '@/types'

interface WalletState {
  wallet: Wallet | null
  transactions: WalletTransaction[]
  isLoading: boolean
  setWallet: (wallet: Wallet | null) => void
  setTransactions: (txs: WalletTransaction[]) => void
  setLoading: (v: boolean) => void
  updateBalance: (newBalanceKobo: number) => void
  reset: () => void
}

export const useWalletStore = create<WalletState>()((set) => ({
  wallet: null,
  transactions: [],
  isLoading: false,
  setWallet: (wallet) => set({ wallet }),
  setTransactions: (transactions) => set({ transactions }),
  setLoading: (isLoading) => set({ isLoading }),
  updateBalance: (newBalanceKobo) =>
    set((state) =>
      state.wallet
        ? { wallet: { ...state.wallet, balance_kobo: newBalanceKobo } }
        : state,
    ),
  reset: () => set({ wallet: null, transactions: [], isLoading: false }),
}))
