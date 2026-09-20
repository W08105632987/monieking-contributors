import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Phone, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'

export default function LoginPage() {
  const navigate = useNavigate()
  const [phoneNumber, setPhoneNumber] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('/auth/admin/login', { phone_number: phoneNumber, password })
      navigate('/verify-otp', { state: { pendingId: data.pending_id, phoneNumber } })
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
          <h1 className="text-white font-bold text-xl mb-1">Sign in</h1>
          <p className="text-green-400 text-sm mb-6">Admin access only. A verification code will be sent after your password.</p>

          <label className="block text-green-300 text-xs font-semibold uppercase tracking-wide mb-1.5">Phone number</label>
          <div className="relative mb-4">
            <Phone className="w-4 h-4 text-green-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="tel"
              required
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              placeholder="0801 234 5678"
              className="w-full bg-green-800/50 border border-green-700 rounded-xl pl-10 pr-3 py-2.5 text-white placeholder:text-green-600 focus:outline-none focus:border-copper-400"
            />
          </div>

          <label className="block text-green-300 text-xs font-semibold uppercase tracking-wide mb-1.5">Password</label>
          <div className="relative mb-6">
            <Lock className="w-4 h-4 text-green-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-green-800/50 border border-green-700 rounded-xl pl-10 pr-3 py-2.5 text-white placeholder:text-green-600 focus:outline-none focus:border-copper-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-copper-400 hover:bg-copper-500 text-green-950 font-bold rounded-xl py-2.5 transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
