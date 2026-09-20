import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

export function useNotifyMe(serviceId: string) {
  const [notified, setNotified] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.get<{ already_notified: boolean }>(`/identity-services/${serviceId}/notify-me/status`)
      .then(({ data }) => { if (!cancelled) setNotified(data.already_notified) })
      .catch(() => {})   // best-effort — button just starts unfilled if this fails
    return () => { cancelled = true }
  }, [serviceId])

  const notify = async () => {
    if (notified || loading) return
    setLoading(true)
    try {
      await api.post(`/identity-services/${serviceId}/notify-me`)
      setNotified(true)
    } finally {
      setLoading(false)
    }
  }

  return { notified, loading, notify }
}
