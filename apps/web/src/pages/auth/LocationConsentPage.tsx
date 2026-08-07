import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MapPin, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'

/**
 * Shown once, right after registration, before landing on the dashboard.
 * Purely optional — Skip goes straight through with no friction. Used
 * only so Directors can see which states the customer base is
 * concentrated in; never shown per-customer, only aggregated counts.
 */
export default function LocationConsentPage() {
  const navigate = useNavigate()
  const [requesting, setRequesting] = useState(false)

  const finish = () => navigate('/customer/dashboard', { replace: true })

  const handleAllow = () => {
    if (!window.isSecureContext) {
      toast('Location needs a secure (https) connection — this will work once the app is live. Continuing for now.')
      finish()
      return
    }
    if (!('geolocation' in navigator)) {
      toast('Location isn\'t available on this device — no problem, continuing.')
      finish()
      return
    }

    setRequesting(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await api.patch('/users/me/location', {
            consent: true,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          })
        } catch {
          // non-fatal — this is a nice-to-have, never block onboarding on it
        } finally {
          setRequesting(false)
          finish()
        }
      },
      async () => {
        // Permission denied or unavailable — record as declined and move on
        try { await api.patch('/users/me/location', { consent: false }) } catch { /* ignore */ }
        setRequesting(false)
        finish()
      },
      { timeout: 8000 },
    )
  }

  const handleSkip = async () => {
    try { await api.patch('/users/me/location', { consent: false }) } catch { /* ignore */ }
    finish()
  }

  return (
    <div className="min-h-dvh flex flex-col justify-between bg-green-50 px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="flex-1 flex flex-col items-center justify-center text-center"
      >
        <div className="w-20 h-20 rounded-3xl bg-green-900 flex items-center justify-center mb-6">
          <MapPin className="w-9 h-9 text-amber-400" />
        </div>

        <h1 className="text-green-900 font-extrabold text-2xl mb-3">Help us understand our community</h1>
        <p className="text-green-600 text-sm max-w-xs leading-relaxed mb-6">
          Sharing your location helps MonieKing see where our customers are across Nigeria, so we can
          serve every community better. It's completely optional, and you can carry on either way.
        </p>

        <div className="w-full max-w-[220px] mb-2">
          <svg viewBox="0 0 200 160" className="w-full h-auto">
            <ellipse cx="100" cy="140" rx="60" ry="8" fill="#166534" opacity="0.08" />
            <circle cx="100" cy="80" r="58" fill="#F0FDF4" stroke="#BBF7D0" strokeWidth="2" />
            <path d="M42 80a58 58 0 0 1 116 0" fill="none" stroke="#86EFAC" strokeWidth="1.5" opacity="0.7" />
            <ellipse cx="100" cy="80" rx="58" ry="22" fill="none" stroke="#86EFAC" strokeWidth="1.5" opacity="0.7" />
            <ellipse cx="100" cy="80" rx="24" ry="58" fill="none" stroke="#86EFAC" strokeWidth="1.5" opacity="0.7" />
            <path d="M58 55c8-6 20 4 30-2s18-10 28-4 14 16 8 26-22 8-32 16-24 2-30-8-12-22-4-28z" fill="#4ADE80" opacity="0.35" />
            <path d="M110 62c6-4 16 2 20 10s-2 16-10 18-14-6-16-14 0-10 6-14z" fill="#4ADE80" opacity="0.35" />
            <g>
              <path d="M100 30c-12 0-22 10-22 22 0 16 22 40 22 40s22-24 22-40c0-12-10-22-22-22z" fill="#166534" />
              <circle cx="100" cy="52" r="9" fill="#FBBF24" />
            </g>
          </svg>
        </div>

        <div className="flex items-center gap-2 text-green-500 text-xs bg-white rounded-full px-4 py-2 border border-green-100">
          <ShieldCheck className="w-3.5 h-3.5" />
          Only used in aggregate — never shown per-customer
        </div>
      </motion.div>

      <div className="space-y-3">
        <button
          onClick={handleAllow}
          disabled={requesting}
          className="w-full bg-green-900 text-white font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-60"
        >
          {requesting ? 'Requesting…' : 'Allow location access'}
        </button>
        <button
          onClick={handleSkip}
          disabled={requesting}
          className="w-full text-green-600 font-semibold text-sm py-3"
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
