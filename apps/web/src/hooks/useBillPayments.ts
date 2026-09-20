import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Biller, BillerCategory, BillValidationResult, BillPaymentRequest } from '@/types'

export function useBillers(category: BillerCategory) {
  return useQuery({
    queryKey: ['billers', category],
    queryFn: async () => {
      const { data } = await api.get<Biller[]>('/bill-payments/billers', { params: { category } })
      return data
    },
  })
}

export function useValidateBill() {
  return useMutation({
    mutationFn: async (body: { biller_id: string; customer_reference: string }) => {
      const { data } = await api.post<BillValidationResult>('/bill-payments/validate', body)
      return data
    },
  })
}

export function usePayBill(customerId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      biller_id: string; customer_reference: string
      amount_kobo?: number | null; quantity?: number; validation_reference?: string | null
    }) => {
      const { data } = await api.post<BillPaymentRequest>(
        '/bill-payments/pay', body, { params: customerId ? { customer_id: customerId } : {} },
      )
      return data
    },
    onSuccess: () => {
      // Wallet balance changed — same invalidation pattern used by
      // useCards/useWithdrawals after any spend. Also invalidate
      // wallet-transactions: it's a separate cache from ['wallet'], and
      // was never being told to refresh, which is why a new transaction
      // wouldn't appear in the Recent Transactions list until something
      // unrelated happened to refetch it.
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
    },
  })
}
