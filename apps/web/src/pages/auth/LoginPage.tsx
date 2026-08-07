import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, Phone, Fingerprint, Moon, Sun } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import { useAuthStore } from '@/store/auth.store'
import { Button } from '@/components/ui/Button'
import { StarfieldBackground } from '@/components/ui/StarfieldBackground'
import { useDarkMode } from '@/hooks/useDarkMode'
import { isBiometricAvailable, loginWithBiometric } from '@/lib/webauthn'
import type { AuthUser } from '@/types'

const schema = z.object({
  phone_number:     z.string().min(10, 'Enter a valid phone number'),
  password:         z.string().min(6, 'Password must be at least 6 characters'),
})
type FormData = z.infer<typeof schema>

const dashboardMap: Record<string, string> = {
  customer: '/customer/dashboard',
  officer:  '/officer/dashboard',
  admin:    '/director/dashboard',
  director: '/director/dashboard',
}

export default function LoginPage() {
  const navigate   = useNavigate()
  const { setUser } = useAuthStore()
  const { isDark, toggle: toggleDark } = useDarkMode()
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioLoading, setBioLoading] = useState(false)
  const autoPromptedRef = useRef(false)

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })
  const phoneValue = watch('phone_number')

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable)

    if (sessionStorage.getItem('mk_logout_reason') === 'inactivity') {
      sessionStorage.removeItem('mk_logout_reason')
      toast('You were logged out after a period of inactivity, for your security.', { icon: '🔒', duration: 5000 })
    }
  }, [])

  const landOnDashboard = (data: AuthUser) => {
    const role = typeof data.role === 'object' ? (data.role as any).value ?? 'customer' : data.role
    // CRITICAL: clear any cached data from a previous session BEFORE
    // setting the new user. Query keys like ['wallet'] and ['cards']
    // aren't scoped by user id, so without this, logging in as a
    // different person on the same browser (a shared/family device,
    // or just not having explicitly logged out last time) can render
    // straight from the PREVIOUS person's cached wallet balance and
    // cards — instantly, and for up to 5 minutes (the query staleTime)
    // before a refetch would ever correct it.
    queryClient.clear()
    setUser({ ...data, role })
    navigate(dashboardMap[role] ?? '/customer/dashboard', { replace: true })
  }

  const onSubmit = async (values: FormData) => {
    setLoading(true)
    try {
      const { data } = await api.post<AuthUser>('/auth/login', {
        phone_number: values.phone_number.replace(/\s/g, ''),
        password: values.password,
      })
      landOnDashboard(data)
    } catch (err: any) {
      // The 4th-attempt warning and lockout messages come through as
      // { code, message } (see login_service.py) — getErrorMessage
      // already unwraps that into a plain string, and gives the wrong-
      // password / locked cases a longer toast so they're actually read.
      const detail = err?.response?.data?.detail
      const code = typeof detail === 'object' ? detail?.code : null
      toast.error(getErrorMessage(err), {
        duration: code === 'WRONG_PASSWORD_WARNING' || code === 'ACCOUNT_LOCKED' ? 6000 : 4000,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleBiometricLogin = async (silent = false) => {
    if (!phoneValue || phoneValue.trim().length < 10) {
      if (!silent) toast.error('Enter your phone number first')
      return
    }
    setBioLoading(true)
    try {
      const user = await loginWithBiometric(phoneValue.replace(/\s/g, ''))
      landOnDashboard(user)
    } catch (err: any) {
      // Silent (auto-triggered the moment the password field is focused,
      // Opay-style) means: the person dismissed the fingerprint prompt,
      // has no biometric set up on this device, or it just failed — any
      // of those are completely normal and should drop them back to
      // typing their password with zero interruption, not an error toast.
      // A toast only makes sense when THEY explicitly tapped the
      // fingerprint icon to retry.
      if (!silent) toast.error(getErrorMessage(err))
    } finally {
      setBioLoading(false)
    }
  }

  const handlePasswordFocus = () => {
    if (autoPromptedRef.current) return
    if (!bioAvailable) return
    if (!phoneValue || phoneValue.trim().length < 10) return
    autoPromptedRef.current = true
    handleBiometricLogin(true)
  }

  return (
    <div className="relative h-dvh bg-hero-gradient dark:bg-night-gradient flex flex-col overflow-hidden transition-colors duration-500">
      {isDark && <StarfieldBackground className="opacity-80" />}

      <button
        onClick={toggleDark}
        className="absolute top-6 right-6 z-10 w-9 h-9 rounded-full bg-green-800/50 dark:bg-white/10 flex items-center justify-center backdrop-blur-sm"
        aria-label="Toggle dark mode"
      >
        {isDark ? <Sun className="w-4 h-4 text-night-100" /> : <Moon className="w-4 h-4 text-green-200" />}
      </button>

      <div className="relative z-[1] flex-1 flex flex-col justify-center px-6 pt-16 pb-8">
        <div className="mb-8">
          <div className="w-14 h-14 bg-green-800 dark:bg-white/10 dark:backdrop-blur-sm rounded-2xl flex items-center justify-center mb-4 shadow-card-lg">
            <span className="text-copper-400 dark:text-night-100 font-extrabold text-2xl">₦</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white leading-tight">Welcome back</h1>
          <p className="text-green-300 dark:text-night-200 mt-1 text-sm">Sign in to your MonieKing account</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="input-label text-green-300 dark:text-night-200">Phone number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500 dark:text-night-300" />
              <input
                type="tel"
                placeholder="08012345678"
                className="input login-input pl-10 bg-green-800/50 dark:bg-night-700/70 border-green-700 dark:border-night-500 text-white placeholder:text-green-600 dark:placeholder:text-night-400 focus:border-copper-400 dark:focus:border-night-200 focus:ring-copper-400/20 dark:focus:ring-night-200/20"
                {...register('phone_number')}
              />
            </div>
            {errors.phone_number && <p className="input-error text-copper-300 dark:text-copper-200">{errors.phone_number.message}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="input-label text-green-300 dark:text-night-200">Password</label>
              <Link to="/auth/forgot-password" className="text-copper-400 dark:text-night-100 text-xs font-semibold hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="Enter your password"
                className="input login-input pr-16 bg-green-800/50 dark:bg-night-700/70 border-green-700 dark:border-night-500 text-white placeholder:text-green-600 dark:placeholder:text-night-400 focus:border-copper-400 dark:focus:border-night-200 focus:ring-copper-400/20 dark:focus:ring-night-200/20"
                {...register('password')}
                onFocus={handlePasswordFocus}
              />
              {bioAvailable && (
                <button
                  type="button"
                  onClick={() => handleBiometricLogin(false)}
                  disabled={bioLoading}
                  aria-label="Sign in with fingerprint"
                  className="absolute right-9 top-1/2 -translate-y-1/2 text-amber-400 dark:text-night-200 disabled:opacity-40"
                >
                  <Fingerprint className={`w-4 h-4 ${bioLoading ? 'animate-pulse' : ''}`} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-300"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && <p className="input-error text-copper-300 dark:text-copper-200">{errors.password.message}</p>}
          </div>

          <Button type="submit" variant="accent" size="lg" fullWidth loading={loading} className="mt-2 shadow-copper dark:shadow-none">
            Sign in
          </Button>
        </form>

        <p className="text-center text-green-400 dark:text-night-300 text-sm mt-6">
          New customer?{' '}
          <Link to="/auth/register" className="text-copper-400 dark:text-night-100 font-semibold hover:underline">
            Create account
          </Link>
        </p>
      </div>

      <div className="px-6 pb-8 text-center">
        <p className="text-green-700 dark:text-night-400 text-xs">MonieKing Contributors © {new Date().getFullYear()}</p>
      </div>
    </div>
  )
}
