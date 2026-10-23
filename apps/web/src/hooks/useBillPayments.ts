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

export interface BillsConfig {
  airtime_enabled: boolean
  data_enabled: boolean
  bills_enabled: boolean
  data_vtu_enabled: boolean
  data_standard_enabled: boolean
  networks: Record<string, boolean>
  min_airtime_naira: number
  max_airtime_naira: number
  notice: string
}

export const DEFAULT_BILLS_CONFIG: BillsConfig = {
  airtime_enabled: true, data_enabled: true, bills_enabled: true,
  data_vtu_enabled: true, data_standard_enabled: true,
  networks: { MTN: true, Airtel: true, Glo: true, '9mobile': true },
  min_airtime_naira: 50, max_airtime_naira: 50000, notice: '',
}

export function useBillsConfig() {
  return useQuery({
    queryKey: ['bills-config'],
    staleTime: 60_000,
    queryFn: async () => (await api.get<BillsConfig>('/bill-payments/config')).data,
  })
}

export function useUpdateBillsConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<BillsConfig>) => (await api.put<BillsConfig>('/bill-payments/admin/config', patch)).data,
    onSuccess: (data) => { qc.setQueryData(['bills-config'], data) },
  })
}

export interface PhoneCheck { valid: boolean; phone: string | null; network: string | null; verified: boolean; message: string | null }

export function usePhoneCheck() {
  return useMutation({
    mutationFn: async (body: { phone: string; network?: string | null }) =>
      (await api.post<PhoneCheck>('/bill-payments/validate-phone', body)).data,
  })
}
