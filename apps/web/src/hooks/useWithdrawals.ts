import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Withdrawal, WithdrawForm, PaginatedResponse } from '@/types'
import toast from 'react-hot-toast'

export function useMyWithdrawals() {
  return useQuery({
    queryKey: ['my-withdrawals'],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<Withdrawal>>('/withdrawals/me')
      return data.data
    },
  })
}

export function usePendingWithdrawals() {
  return useQuery({
    queryKey: ['pending-withdrawals'],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<Withdrawal>>('/withdrawals?status=pending')
      return data.data
    },
    refetchInterval: 30000,
  })
}

export function useRequestWithdrawal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (form: WithdrawForm) => {
      const { data } = await api.post<Withdrawal>('/withdrawals', form)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-withdrawals'] })
      qc.invalidateQueries({ queryKey: ['cards'] })
      qc.invalidateQueries({ queryKey: ['wallet'] })
      toast.success('Withdrawal request submitted!')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useClaimWithdrawal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/withdrawals/${id}/claim`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-withdrawals'] })
      toast.success('Withdrawal claimed!')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useMarkWithdrawalPaid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/withdrawals/${id}/mark-paid`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-withdrawals'] })
      toast.success('Withdrawal marked as paid!')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useRejectWithdrawal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data } = await api.post(`/withdrawals/${id}/reject`, { reason })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-withdrawals'] })
      toast.success('Withdrawal rejected.')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
