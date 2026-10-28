import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type PricingCategory = 'airtime' | 'data' | 'electricity' | 'cable_tv' | 'education'

export interface PriceRow {
  id: string
  category: PricingCategory
  provider: string
  product_name: string
  product_id: string
  is_active: boolean
  fixed_price: boolean
  monnify_price_kobo: number | null
  override_price_kobo: number | null
  customer_price_kobo: number | null
  markup_percent: number
  commission_percent: number
  min_amount_kobo: number | null
  max_amount_kobo: number | null
  profit_kobo: number
  profit_basis_kobo: number
  commission_kobo: number
}

export interface PricingPatch {
  markup_percent?: number
  commission_percent?: number
  customer_price_kobo?: number | null
  is_active?: boolean
}

export function usePriceList(category: PricingCategory) {
  return useQuery({
    queryKey: ['bill-pricing', category],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<PriceRow[]>('/bill-payments/admin/pricing', { params: { category } })).data,
  })
}

export function useUpdatePrice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: PricingPatch }) =>
      (await api.put<PriceRow>(`/bill-payments/admin/pricing/${id}`, patch)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bill-pricing'] }); qc.invalidateQueries({ queryKey: ['billers'] }) },
  })
}

export function useBulkPrice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { category?: PricingCategory; name_contains?: string; markup_percent?: number; commission_percent?: number; clear_overrides?: boolean }) =>
      (await api.post<{ updated: number }>('/bill-payments/admin/pricing/bulk', body)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bill-pricing'] }); qc.invalidateQueries({ queryKey: ['billers'] }) },
  })
}

export interface ProfitRow {
  category: PricingCategory
  count: number
  sales_kobo: number
  vend_kobo: number
  markup_kobo: number
  commission_kobo: number
  profit_kobo: number
}
export interface ProfitReport { label: string; from: string; to: string; rows: ProfitRow[]; total: Omit<ProfitRow, 'category'> }
export type ProfitPeriod = 'today' | 'week' | 'month' | 'custom'

export function useProfitReport(period: ProfitPeriod, start?: string, end?: string) {
  const ready = period !== 'custom' || (!!start && !!end && end >= start)
  return useQuery({
    queryKey: ['bill-profit', period, start, end],
    enabled: ready,
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<ProfitReport>('/bill-payments/admin/profit', { params: { period, start, end } })).data,
  })
}
