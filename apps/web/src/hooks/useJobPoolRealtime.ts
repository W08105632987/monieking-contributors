import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth.store'

/**
 * Subscribes to Postgres changes on `manual_service_requests` via Supabase Realtime.
 * Keeps the Worker job pool, referred queue, and active job in sync in real time
 * without requiring manual page refreshes.
 */
export function useJobPoolRealtime() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('manual_service_requests_pool')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'manual_service_requests' },
        () => {
          // Immediately invalidate pool, active job, and history
          qc.invalidateQueries({ queryKey: ['worker-pool'] })
          qc.invalidateQueries({ queryKey: ['worker-referred-jobs'] })
          qc.invalidateQueries({ queryKey: ['worker-active-job'] })
          qc.invalidateQueries({ queryKey: ['worker-my-jobs'] })
          qc.invalidateQueries({ queryKey: ['worker-earnings-summary'] })
          qc.invalidateQueries({ queryKey: ['director-worker-pool'] })
          qc.invalidateQueries({ queryKey: ['director-manual-services'] })
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [user?.id, qc])
}
