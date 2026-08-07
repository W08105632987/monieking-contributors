import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { getErrorMessage } from '@/lib/api'
import type { ContributionCard, CreateCardForm, ContributeForm, CardGrid } from '@/types'


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
      toast.success('Card created successfully')
      qc.invalidateQueries({ queryKey: ['cards'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const contribute = useMutation({
    mutationFn: (form: ContributeForm) => api.post('/contributions', form),
    onSuccess: () => {
      toast.success('Contribution recorded!')
      qc.invalidateQueries({ queryKey: ['cards'] })
      qc.invalidateQueries({ queryKey: ['wallet'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
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
