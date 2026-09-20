import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import type { AdminUser } from '@/types'

export default function VerifyOtpPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const setUser = useAuthStore(s => s.setUser)
  const state = location.state as { pendingId?: string; phoneNumber?: string } | null
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)

  // No pending login to verify (e.g. a direct navigation or a page
  // refresh, which drops router state) — back to the start.
  if (!state?.pendingId) {
    navigate('/login', { replace: true })
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post<AdminUser>('/auth/admin/verify-otp', {
        pending_id: state.pendingId,
        otp,
      })
      setUser(data)
      navigate('/', { replace: true })
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-green-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <ShieldCheck className="w-6 h-6 text-copper-400" />
          <span className="text-white font-extrabold text-lg tracking-tight">MonieKing Admin</span>
        </div>

        <form onSubmit={handleSubmit} className="bg-green-900/60 border border-green-800 rounded-2xl p-8">
          <h1 className="text-white font-bold text-xl mb-1">Enter your code</h1>
          <p className="text-green-400 text-sm mb-6">
            We sent a 6-digit code to {state.phoneNumber ?? 'your phone'}. It expires in 5 minutes.
          </p>

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            required
            autoFocus
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
            placeholder="••••••"
            className="w-full bg-green-800/50 border border-green-700 rounded-xl text-center tracking-[0.5em] text-xl px-3 py-3 mb-6 text-white placeholder:text-green-600 focus:outline-none focus:border-copper-400"
          />

          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="w-full bg-copper-400 hover:bg-copper-500 text-green-950 font-bold rounded-xl py-2.5 transition-colors disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Verify & sign in'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/login')}
            className="w-full text-green-500 text-xs font-semibold mt-4"
          >
            ← Use a different account
          </button>
        </form>
      </div>
    </div>
  )
}
