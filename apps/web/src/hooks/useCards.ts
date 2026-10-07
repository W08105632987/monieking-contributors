import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { getErrorMessage } from '@/lib/api'
import { showFeedback } from '@/store/feedback.store'
import type { ContributionCard, CreateCardForm, ContributeForm, CardGrid, Wallet } from '@/types'

interface ContributeResponse {
  message: string
  days_added: number
  card: ContributionCard
  wallet_balance_kobo: number
}

export function useCards() {
  const qc = useQueryClient()
  

  const { isAuthenticated } = useAuthStore()

  const cardsQuery = useQuery({
    queryKey: ['cards'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data } = await api.get<ContributionCard[]>('/cards', {
        params: { include_completed: true },
      })
      return data
    },
  })

  const createCard = useMutation({
    mutationFn: (form: CreateCardForm) => api.post('/cards', form),
    onSuccess: () => {
      showFeedback.success('Card created', 'Your new contribution card is ready to use.')
      qc.invalidateQueries({ queryKey: ['cards'] })
    },
    onError: (e) => showFeedback.error('Could not create card', getErrorMessage(e)),
  })

  const contribute = useMutation({
    mutationFn: (form: ContributeForm) => api.post<ContributeResponse>('/contributions', form),
    onSuccess: async ({ data }, form) => {
      showFeedback.success('Contribution recorded!')

      // The backend now returns the authoritative updated card and
      // wallet balance directly in this response — patch the caches
      // with THAT immediately instead of just marking them stale and
      // waiting for a separate background refetch to eventually catch
      // up. That wait (sometimes 1-3+ seconds under load, per the
      // slow-query logs) was the actual cause of the card grid not
      // shading in right away.
      //
      // cancelQueries first: if a background refetch from BEFORE this
      // mutation is still in flight, it could resolve AFTER we write
      // the fresh data below and clobber it with older data. Cancelling
      // stops that specific race — the exact "older response
      // overwriting newer data" case.
      await qc.cancelQueries({ queryKey: ['cards'] })
      await qc.cancelQueries({ queryKey: ['wallet'] })
      await qc.cancelQueries({ queryKey: ['wallet-transactions'] })

      qc.setQueryData<ContributionCard[]>(['cards'], (old) =>
        old?.map((c) => (c.id === data.card.id ? data.card : c)) ?? old
      )
      qc.setQueryData<Wallet | undefined>(['wallet'], (old) =>
        old ? { ...old, balance_kobo: data.wallet_balance_kobo } : old
      )

      // Recent/full transaction lists and the flip-side grid aren't
      // part of this response (the endpoint doesn't build a full
      // transaction record or day-grid payload), so those still need
      // an actual refetch — but now that happens in the background
      // against caches that are ALREADY correct everywhere else, not
      // as the only way any of this ever updates.
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
      qc.invalidateQueries({ queryKey: ['card-grid', form.card_id] })
      // The My Cards page reads ONE combined grid request, a different cache
      // key from the per-card grid above. It was never refreshed here, so My
      // Cards kept showing the old grid until a full page reload.
      qc.invalidateQueries({ queryKey: ['card-grids'] })
    },
    onError: (e) => showFeedback.error('Contribution failed', getErrorMessage(e)),
  })

  return {
    cards:      cardsQuery.data ?? [],
    isLoading:  cardsQuery.isLoading,
    createCard,
    contribute,
  }
}

export function useCardGrid(cardId: string) {
  return useQuery({
    queryKey: ['card-grid', cardId],
    queryFn: async () => {
      const { data } = await api.get<CardGrid>(`/cards/${cardId}/grid`)
      return data
    },
    enabled: !!cardId,
  })
}
