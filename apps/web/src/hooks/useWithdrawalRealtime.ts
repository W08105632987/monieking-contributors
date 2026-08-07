import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth.store'

/**
 * Subscribes to Postgres changes on `withdrawals` via Supabase Realtime.
 * When another director claims a request, every other director's screen
 * updates instantly and shows a toast — instead of a stale list or a bare
 * 409 the next time they tap it.
 */
export function useWithdrawalRealtime() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const lastSeenClaims = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!user || user.role !== 'director') return

    const channel = supabase
      .channel('withdrawals-claims')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'withdrawals' },
        (payload) => {
          const updated = payload.new as {
            id: string
            status: string
            claimed_by_director_id: string | null
          }

          qc.invalidateQueries({ queryKey: ['director-withdrawals'] })

          if (
            updated.status === 'claimed' &&
            updated.claimed_by_director_id &&
            updated.claimed_by_director_id !== user.id &&
            !lastSeenClaims.current.has(updated.id)
          ) {
            lastSeenClaims.current.add(updated.id)
            toast('A withdrawal was just claimed by another director', { icon: '👤' })
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user?.id])
}
