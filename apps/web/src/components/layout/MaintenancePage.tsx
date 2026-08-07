import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { useServerHealthStore } from '@/store/serverHealth.store'

const RETRY_INTERVAL_MS = 8000

function ArtMaintenance() {
  return (
    <svg viewBox="0 0 240 200" className="w-48 h-auto mx-auto mb-6">
      <ellipse cx="120" cy="175" rx="80" ry="10" fill="#166534" opacity="0.08" />
      <circle cx="120" cy="90" r="75" fill="#F0FDF4" />
      <rect x="75" y="65" width="90" height="65" rx="10" fill="#166534" />
      <rect x="87" y="77" width="66" height="30" rx="4" fill="#F0FDF4" />
      <circle cx="120" cy="118" r="6" fill="#F0FDF4" />
      <g transform="translate(150,50) rotate(20)">
        <rect x="-6" y="-28" width="12" height="40" rx="6" fill="#FBBF24" />
        <circle cx="0" cy="16" r="10" fill="#FBBF24" />
      </g>
      <g transform="translate(90,45) rotate(-15)">
        <rect x="-5" y="-22" width="10" height="32" rx="5" fill="#34D399" />
        <circle cx="0" cy="12" r="8" fill="#34D399" />
      </g>
    </svg>
  )
}

export function MaintenancePage() {
  const { setDown } = useServerHealthStore()
  const [checking, setChecking] = useState(false)
  const [secondsToRetry, setSecondsToRetry] = useState(RETRY_INTERVAL_MS / 1000)

  const checkNow = useCallback(async () => {
    setChecking(true)
    try {
      await api.get('/health', { timeout: 5000 })
      setDown(false)   // success — interceptor would also clear this, but don't wait for a second round trip
    } catch {
      // still down — countdown just restarts below
    } finally {
      setChecking(false)
      setSecondsToRetry(RETRY_INTERVAL_MS / 1000)
    }
  }, [setDown])

  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsToRetry((s) => {
        if (s <= 1) {
          checkNow()
          return RETRY_INTERVAL_MS / 1000
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [checkNow])

  return (
    <div className="min-h-dvh bg-green-50 flex flex-col items-center justify-center px-6 text-center">
      <ArtMaintenance />
      <h1 className="text-green-900 font-extrabold text-xl mb-2">We'll be right back</h1>
      <p className="text-green-500 text-sm leading-relaxed max-w-xs mb-1">
        MonieKing is briefly unavailable — your money and your contribution history are safe, nothing is lost.
      </p>
      <p className="text-green-400 text-xs mb-6">
        Checking again in {secondsToRetry}s…
      </p>
      <button
        onClick={checkNow}
        disabled={checking}
        className="flex items-center gap-2 bg-green-900 text-white font-bold text-sm rounded-full px-6 py-3 active:scale-95 transition-all disabled:opacity-60"
      >
        <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
        {checking ? 'Checking…' : 'Try again now'}
      </button>
    </div>
  )
}
