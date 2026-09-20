import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, Phone, Lock, Fingerprint, Moon, Sun, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import { useAuthStore } from '@/store/auth.store'
import { Button } from '@/components/ui/Button'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'
import { StarfieldBackground } from '@/components/ui/StarfieldBackground'
import { useDarkMode } from '@/hooks/useDarkMode'
import { isBiometricAvailable, loginWithBiometric } from '@/lib/webauthn'
import { FEATURE_FLAGS } from '@/config/featureFlags'
import { Seo } from '@/components/seo/Seo'
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
function TypewriterText({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const fullText = text

    if (!isDeleting && displayed.length < fullText.length) {
      // typing
      timer = setTimeout(() => {
        setDisplayed(fullText.slice(0, displayed.length + 1))
      }, 65)
    } else if (!isDeleting && displayed.length === fullText.length) {
      // pause at end
      timer = setTimeout(() => {
        setIsDeleting(true)
      }, 2500)
    } else if (isDeleting && displayed.length > 0) {
      // deleting
      timer = setTimeout(() => {
        setDisplayed(fullText.slice(0, displayed.length - 1))
      }, 30)
    } else if (isDeleting && displayed.length === 0) {
      // pause before re-typing
      timer = setTimeout(() => {
        setIsDeleting(false)
      }, 400)
    }

    return () => clearTimeout(timer)
  }, [displayed, isDeleting, text])

  return (
    <span className="inline-flex items-center">
      <span>{displayed}</span>
      <span className="w-1 h-3.5 bg-copper-500 dark:bg-amber-400 ml-0.5 rounded-full animate-pulse inline-block" />
    </span>
  )
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
    if (!FEATURE_FLAGS.BIOMETRICS_ENABLED) return
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
    <div className="relative min-h-dvh bg-surface-gradient dark:bg-night-gradient flex flex-col overflow-x-hidden transition-colors duration-500">
      {/* CHANGED: was `overflow-hidden` (both axes) — on shorter phones,
          this page's total content (logo block, welcome heading, form,
          security card, footer) can be taller than the viewport, and
          `overflow-hidden` was clipping the excess instead of letting
          the page scroll to it. `overflow-x-hidden` keeps the
          decorative radial glow from creating a horizontal scrollbar
          without trapping vertical content the same way. */}
      <Seo title="Sign in — MonieKing" description="Sign in to your MonieKing contribution savings account." noindex={false} />
      {isDark && <StarfieldBackground className="opacity-80" />}

      {/* Soft radial accent behind the logo — echoes the splash screen's glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full pointer-events-none"
        style={{
          width: 420, height: 420,
          background: 'radial-gradient(circle, rgba(5,150,105,0.12) 0%, rgba(5,150,105,0) 70%)',
        }}
      />

      <button
        onClick={toggleDark}
        disabled={loading}
        className="absolute top-6 right-6 z-10 w-9 h-9 rounded-full bg-white/70 dark:bg-white/10 flex items-center justify-center backdrop-blur-sm shadow-card disabled:opacity-40"
        aria-label="Toggle dark mode"
      >
        {isDark ? <Sun className="w-4 h-4 text-night-100" /> : <Moon className="w-4 h-4 text-green-700" />}
      </button>

      <div className="relative z-[1] flex-1 flex flex-col px-6 pt-6 pb-8">
        {/* Brand block: Splat logo + dynamic typing tagline directly underneath */}
        <div className="flex flex-col items-start gap-2 mb-8">
          <BrandBlobLogo height={42} />
          <p className="text-green-700 dark:text-night-200 text-xs font-semibold tracking-wide min-h-[1.25rem] flex items-center pl-1">
            <TypewriterText text="Contribution savings, reimagined" />
          </p>
        </div>

        {/* Pushes "Welcome back!" and the form down toward the center
            of the page instead of sitting right under the brand mark —
            paired with the existing flex-1 spacer further down (before
            the decorative flourish), which splits the extra vertical
            space between here and there, settling the security card
            and footer toward the bottom like before. */}
        <div className="flex-1" />

        {/* Welcome back heading */}
        <div className="text-center mb-7">
          <h2 className="text-xl font-extrabold text-green-950 dark:text-white">Welcome back!</h2>
          <p className="text-green-600 dark:text-night-200 text-sm mt-1">Log in to continue to your account</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="input-label text-green-700 dark:text-night-200">Phone Number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500 dark:text-night-300" />
              <input
                type="tel"
                placeholder="Enter your phone number"
                disabled={loading}
                className="input login-input pl-10 bg-white dark:bg-night-700/70 border-green-200 dark:border-night-500 text-green-950 dark:text-white placeholder:text-green-400 dark:placeholder:text-night-400 focus:border-copper-400 focus:ring-copper-400/20 rounded-2xl shadow-card disabled:opacity-60"
                {...register('phone_number')}
              />
            </div>
            {errors.phone_number && <p className="input-error text-danger">{errors.phone_number.message}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="input-label text-green-700 dark:text-night-200">Password</label>
              <Link
                to="/auth/forgot-password"
                onClick={(e) => { if (loading) e.preventDefault() }}
                className={`text-copper-500 dark:text-night-100 text-xs font-semibold hover:underline ${loading ? 'pointer-events-none opacity-50' : ''}`}
              >
                Forgot Password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500 dark:text-night-300" />
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="Enter your password"
                disabled={loading}
                className="input login-input pl-10 pr-16 bg-white dark:bg-night-700/70 border-green-200 dark:border-night-500 text-green-950 dark:text-white placeholder:text-green-400 dark:placeholder:text-night-400 focus:border-copper-400 focus:ring-copper-400/20 rounded-2xl shadow-card disabled:opacity-60"
                {...register('password')}
                onFocus={handlePasswordFocus}
              />
              {bioAvailable && (
                <button
                  type="button"
                  onClick={() => handleBiometricLogin(false)}
                  disabled={bioLoading || loading}
                  aria-label="Sign in with fingerprint"
                  className="absolute right-9 top-1/2 -translate-y-1/2 text-copper-500 dark:text-night-200 disabled:opacity-40"
                >
                  <Fingerprint className={`w-4 h-4 ${bioLoading ? 'animate-pulse' : ''}`} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                disabled={loading}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-300 disabled:opacity-40"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && <p className="input-error text-danger">{errors.password.message}</p>}
          </div>

          <Button type="submit" variant="accent" size="lg" fullWidth loading={loading} className="mt-2 shadow-copper">
            Login
          </Button>
        </form>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-green-100 dark:bg-night-600" />
          <span className="text-green-400 dark:text-night-400 text-xs">or</span>
          <div className="flex-1 h-px bg-green-100 dark:bg-night-600" />
        </div>

        <p className="text-center text-green-600 dark:text-night-300 text-sm">
          Don&apos;t have an account?{' '}
          <Link
            to="/auth/register"
            onClick={(e) => { if (loading) e.preventDefault() }}
            className={`text-copper-500 dark:text-night-100 font-semibold hover:underline ${loading ? 'pointer-events-none opacity-50' : ''}`}
          >
            Sign up
          </Link>
        </p>

        {/* Security reassurance card */}
        <div className="flex items-start gap-3 bg-brand-surface dark:bg-white/5 rounded-2xl p-4 mt-8">
          <div className="w-9 h-9 rounded-full bg-brand-soft dark:bg-white/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-green-800 dark:text-copper-300" />
          </div>
          <div>
            <p className="text-green-950 dark:text-white text-sm font-bold">Your security is our priority</p>
            <p className="text-green-600 dark:text-night-300 text-xs mt-0.5 leading-relaxed">
              We use bank-level security to keep your information and funds protected.
            </p>
          </div>
        </div>

        <div className="flex-1" />

        {/* Decorative bottom flourish — abstract brand shapes, not a stand-in for a real illustration */}
        <div className="relative h-16 mt-8 -mx-6 overflow-hidden pointer-events-none">
          <div
            className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-[140%] h-24 rounded-[50%]"
            style={{ background: 'linear-gradient(180deg, rgba(5,150,105,0.10) 0%, rgba(5,150,105,0) 100%)' }}
          />
        </div>
      </div>

      <div className="px-6 pb-8 text-center relative z-[1]">
        <p className="text-green-500 dark:text-night-400 text-xs">MonieKing Contributors © {new Date().getFullYear()}</p>
      </div>
    </div>
  )
}
