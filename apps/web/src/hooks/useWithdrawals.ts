import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Withdrawal, WithdrawForm, PaginatedResponse } from '@/types'
import toast from 'react-hot-toast'
import { showFeedback } from '@/store/feedback.store'

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
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
      showFeedback.success('Withdrawal requested', 'A director will review and process this shortly.')
    },
    onError: (e: Error) => showFeedback.error('Withdrawal request failed', e.message),
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
      showFeedback.success('Withdrawal claimed', 'This request is now assigned to you.')
    },
    onError: (e: Error) => showFeedback.error('Could not claim withdrawal', e.message),
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
      showFeedback.success('Withdrawal rejected', 'The customer will be notified.')
    },
    onError: (e: Error) => showFeedback.error('Could not reject withdrawal', e.message),
  })
}
