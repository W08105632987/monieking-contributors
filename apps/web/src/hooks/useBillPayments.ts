import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { withPin } from '@/lib/pin'
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
      // The person tapping Pay confirms with their own 4-digit PIN (an officer paying for a customer uses the officer's PIN).
      return withPin(async (pin) => {
        const { data } = await api.post<BillPaymentRequest>(
          '/bill-payments/pay', { ...body, pin },
          // Electricity vends (AEDC and others) can take well over the app's usual 20s: the server
          // checks the meter, then waits on the provider. Giving up early meant no receipt and no token
          // even though the payment went through, so this call waits longer than any other.
          { params: customerId ? { customer_id: customerId } : {}, timeout: 90_000 },
        )
        return data
      }, { title: 'Confirm with your PIN', message: 'Enter your 4-digit payment PIN to complete this payment.' })
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
      qc.invalidateQueries({ queryKey: ['service-history'] })
    },
    onError: () => {
      // If the call timed out the payment may still have gone through — refresh what the person sees.
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['service-history'] })
    },
  })
}

/** One bill payment, kept fresh while it is still processing (and, for electricity, until its token arrives). */
export function useBillRequest(id: string | null | undefined, initial?: BillPaymentRequest | null) {
  return useQuery({
    queryKey: ['bill-request', id],
    enabled: !!id,
    initialData: initial ?? undefined,
    queryFn: async () => (await api.get<BillPaymentRequest>(`/bill-payments/requests/${id}`)).data,
    refetchInterval: (q) => {
      const r = q.state.data
      if (!r) return false
      const waitingForToken = r.status === 'completed' && r.biller_category === 'electricity' && !r.token
      return r.status === 'pending' || waitingForToken ? 4000 : false
    },
    refetchIntervalInBackground: false,
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
