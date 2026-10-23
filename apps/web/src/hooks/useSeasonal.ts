import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_SEASONAL, activeSeason, type Season, type SeasonalConfig } from '@/lib/seasonal'

export function useSeasonalConfig() {
  return useQuery({
    queryKey: ['seasonal'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => (await api.get<SeasonalConfig>('/seasonal')).data,
  })
}

export function useSeason(): Season {
  const { data } = useSeasonalConfig()
  return activeSeason(data ?? DEFAULT_SEASONAL)
}

export function useUpdateSeasonal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<SeasonalConfig>) => (await api.put<SeasonalConfig>('/seasonal', patch)).data,
    onSuccess: (d) => qc.setQueryData(['seasonal'], d),
  })
}
