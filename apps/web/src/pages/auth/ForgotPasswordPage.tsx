import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, KeyRound, Lock, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { StarfieldBackground } from '@/components/ui/StarfieldBackground'
import { useDarkMode } from '@/hooks/useDarkMode'

type Step = 'phone' | 'reset'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const { isDark } = useDarkMode()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)

  const requestOtp = async () => {
    if (phone.trim().length < 10) return toast.error('Enter a valid phone number')
    setLoading(true)
    try {
      await api.post('/auth/forgot-password/request-otp', { phone_number: phone })
      toast.success('If that number is registered, a code has been sent')
      setStep('reset')
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const resetPassword = async () => {
    if (otp.length !== 6) return toast.error('Enter the 6-digit code')
    if (newPassword.length < 8) return toast.error('Password must be at least 8 characters')
    setLoading(true)
    try {
      await api.post('/auth/forgot-password/reset', {
        phone_number: phone, otp, new_password: newPassword,
      })
      toast.success('Password updated — you can log in now')
      navigate('/auth/login', { replace: true })
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-dvh bg-hero-gradient dark:bg-night-gradient flex flex-col px-6 pt-16 pb-8 overflow-hidden transition-colors duration-500">
      {isDark && <StarfieldBackground className="opacity-80" />}
      <div className="relative z-[1] flex flex-col flex-1">
      <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-green-800/50 dark:bg-white/10 flex items-center justify-center mb-8">
        <ArrowLeft className="w-4 h-4 text-white" />
      </button>

      <h1 className="text-3xl font-extrabold text-white leading-tight mb-1">Forgot password?</h1>
      <p className="text-green-300 text-sm mb-8">
        {step === 'phone'
          ? "Enter your registered phone number and we'll text you a reset code."
          : `Enter the 6-digit code sent to ${phone}, and your new password.`}
      </p>

      {step === 'phone' ? (
        <div className="space-y-4">
          <div>
            <label className="input-label text-green-300">Phone number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="08012345678"
                className="input pl-10 bg-green-800/50 border-green-700 text-white placeholder:text-green-600 focus:border-copper-400 focus:ring-copper-400/20"
              />
            </div>
          </div>
          <button
            onClick={requestOtp}
            disabled={loading}
            className="w-full bg-amber-400 text-green-900 font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send reset code'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="input-label text-green-300">6-digit code</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
              <input
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                className="input pl-10 bg-green-800/50 border-green-700 text-white placeholder:text-green-600 focus:border-copper-400 focus:ring-copper-400/20 tracking-[0.3em]"
              />
            </div>
          </div>
          <div>
            <label className="input-label text-green-300">New password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
              <input
                type={showPwd ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="input pl-10 pr-10 bg-green-800/50 border-green-700 text-white placeholder:text-green-600 focus:border-copper-400 focus:ring-copper-400/20"
              />
              <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <button
            onClick={resetPassword}
            disabled={loading}
            className="w-full bg-amber-400 text-green-900 font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Updating…' : 'Reset password'}
          </button>
          <button onClick={() => setStep('phone')} className="w-full text-green-400 text-xs font-semibold py-2">
            Didn't get a code? Try again
          </button>
        </div>
      )}
      </div>
    </div>
  )
}
