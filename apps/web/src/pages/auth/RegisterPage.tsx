import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Link } from 'react-router-dom'
import {
  Eye, EyeOff, Phone, User, Building2,
  CreditCard, Users, ChevronRight, ChevronLeft, Check,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import { useAuthStore } from '@/store/auth.store'
import { Button } from '@/components/ui/Button'
import type { AuthUser } from '@/types'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'
import { LegalDocumentModal } from '@/pages/legal/LegalDocumentModal'

// ── Validation schema ─────────────────────────────────────────────
const schema = z.object({
  full_name:           z.string().min(3, 'Enter your full name'),
  phone_number:        z.string().min(10, 'Enter a valid phone number').max(15),
  bank_name:           z.string().min(2, 'Enter your bank name'),
  account_number:      z.string().length(10, 'Account number must be exactly 10 digits'),
  account_name:        z.string().min(3, 'Enter the account name as it appears on your bank'),
  next_of_kin_name:    z.string().min(3, 'Enter next of kin full name'),
  next_of_kin_phone:   z.string().min(10, 'Enter next of kin phone number'),
  password:            z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password:    z.string(),
  withdrawal_password: z.string()
    .min(8, 'Withdrawal password must be at least 8 characters')
    .refine(v => !/^\d+$/.test(v), 'Withdrawal password can\'t be all numbers — add a letter or symbol'),
}).refine(d => d.password === d.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
})

type FormData = z.infer<typeof schema>

const STEPS = [
  { id: 1, title: 'Personal Info', icon: User },
  { id: 2, title: 'Bank Details',  icon: Building2 },
  { id: 3, title: 'Next of Kin',   icon: Users },
  { id: 4, title: 'Set Passwords', icon: CreditCard },
]

const BANKS = [
  'Access Bank','Citibank Nigeria','Ecobank Nigeria','Fidelity Bank',
  'First Bank of Nigeria','First City Monument Bank (FCMB)','Globus Bank',
  'Guaranty Trust Bank (GTBank)','Heritage Bank','Jaiz Bank','Keystone Bank',
  'Kuda Bank','Moniepoint MFB','Opay','Palmpay','Polaris Bank',
  'Premium Trust Bank','Providus Bank','Stanbic IBTC Bank','Standard Chartered Bank',
  'Sterling Bank','SunTrust Bank','Taj Bank','Titan Trust Bank',
  'Union Bank of Nigeria','United Bank for Africa (UBA)','Unity Bank',
  'VFD Microfinance Bank','Wema Bank','Zenith Bank',
].sort()

export default function RegisterPage() {
  const navigate    = useNavigate()
  const { setUser } = useAuthStore()
  const [step, setStep]   = useState(1)
  const isResume = new URLSearchParams(window.location.search).get('resume') === 'true'
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd]             = useState(false)
  const [showConfirm, setShowConfirm]     = useState(false)
  const [showWithdraw, setShowWithdraw]   = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [legalDoc, setLegalDoc] = useState<'terms' | 'privacy' | null>(null)

  const { register, handleSubmit, trigger, formState: { errors } } =
    useForm<FormData>({ resolver: zodResolver(schema), mode: 'onBlur' })

  const stepFields: Record<number, (keyof FormData)[]> = {
    1: ['full_name', 'phone_number'],
    2: ['bank_name', 'account_number', 'account_name'],
    3: ['next_of_kin_name', 'next_of_kin_phone'],
    4: ['password', 'confirm_password', 'withdrawal_password'],
  }

  const handleNext = async () => {
    const valid = await trigger(stepFields[step])
    if (valid) setStep(s => s + 1)
  }

  const onSubmit = async (values: FormData) => {
    if (!acceptedTerms) {
      toast.error('Please accept the Terms of Service and Privacy Policy to continue')
      return
    }
    setLoading(true)
    try {
      const emailAlias = `${values.phone_number.replace(/\s+/g, '')}@monieking.app`

      // Step 1 — Create or reuse Supabase Auth account
      if (!isResume) {
        const { error: signUpError } = await supabase.auth.signUp({
          email:    emailAlias,
          password: values.password,
        })
        if (signUpError && !signUpError.message.toLowerCase().includes('already')) {
          throw new Error(signUpError.message)
        }
      }

      // Small delay to ensure Supabase Auth has committed the user
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Step 2 — Start a session (backend sets it as an httpOnly cookie;
      // there's no platform `users` row yet at this point, so this can't
      // go through the normal /auth/login lockout-tracked flow — see
      // /auth/signup-session in auth.py)
      await api.post('/auth/signup-session', {
        phone_number: values.phone_number.replace(/\s+/g, ''),
        password:     values.password,
      })

      // Step 3 — Create platform user record on backend
      // The session cookie set above authenticates this call automatically.
      try {
        await api.post('/auth/register', {
          full_name:           values.full_name,
          phone_number:        values.phone_number.replace(/\s+/g, ''),
          bank_name:           values.bank_name,
          account_number:      values.account_number,
          account_name:        values.account_name,
          next_of_kin_name:    values.next_of_kin_name,
          next_of_kin_phone:   values.next_of_kin_phone.replace(/\s+/g, ''),
          password:            values.password,
          withdrawal_password: values.withdrawal_password,
          accepted_terms:      true,
        })
      } catch (apiErr: any) {
        const msg = apiErr?.response?.data?.detail ?? apiErr?.message ?? 'Registration failed'
        // If backend says already registered, just continue — user may be retrying
        if (!msg.toLowerCase().includes('already registered')) {
          throw new Error(msg)
        }
      }

      // Step 4 — Fetch profile and set in store
      const { data: profile } = await api.get<AuthUser>('/users/me')
      queryClient.clear()  // same reasoning as login — never trust leftover cache from a prior session on this device
      setUser(profile)

      toast.success('Welcome to MonieKing! Your account is ready.')
      navigate('/auth/location-consent', { replace: true })

    } catch (err: any) {
      toast.error(err?.message ?? 'Registration failed. Please try again.')
      console.error('Registration error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh bg-hero-gradient flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-2">
        <BrandBlobLogo height={34} hideBlob />
        <Link to="/auth/login" className="text-green-400 text-sm hover:text-green-300 font-medium">
          Sign in instead
        </Link>
      </div>

      {/* Heading */}
      <div className="px-6 pt-4 pb-4">
        <h1 className="text-white text-2xl font-extrabold">Create your account</h1>
        <p className="text-green-400 text-sm mt-1">
          Step {step} of {STEPS.length} — {STEPS[step - 1].title}
        </p>
      </div>

      {/* Progress bar */}
      <div className="px-6 mb-4">
        <div className="flex gap-1.5">
          {STEPS.map(s => (
            <div key={s.id} className="flex-1 h-1.5 rounded-full transition-all duration-300"
              style={{ background: s.id <= step ? '#F59E0B' : 'rgba(255,255,255,0.15)' }} />
          ))}
        </div>
        <div className="flex justify-between mt-2 px-0.5">
          {STEPS.map(s => (
            <div key={s.id}
              className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
              style={{
                background: s.id < step ? '#F59E0B' : s.id === step ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.1)',
                border: s.id === step ? '1.5px solid #F59E0B' : 'none',
                color: s.id < step ? '#052E16' : s.id === step ? '#F59E0B' : 'rgba(255,255,255,0.3)',
              }}
            >
              {s.id < step ? <Check className="w-3 h-3" /> : s.id}
            </div>
          ))}
        </div>
      </div>

      {/* Form card */}
      <div className="flex-1 bg-white rounded-t-3xl px-6 pt-6 pb-10 overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)} noValidate>

          {/* STEP 1 — Personal Info */}
          {step === 1 && (
            <div className="space-y-4 animate-fade-up">
              <h2 className="text-green-900 font-bold text-lg mb-4">Personal Information</h2>

              <div>
                <label className="input-label">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                  <input type="text" placeholder="e.g. Emeka Okafor"
                    className="input pl-10" {...register('full_name')} />
                </div>
                {errors.full_name && <p className="input-error">{errors.full_name.message}</p>}
              </div>

              <div>
                <label className="input-label">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                  <input type="tel" placeholder="e.g. 08012345678"
                    className="input pl-10" {...register('phone_number')} />
                </div>
                {errors.phone_number && <p className="input-error">{errors.phone_number.message}</p>}
                <p className="text-xs text-green-500 mt-1">This will be your login username</p>
              </div>
            </div>
          )}

          {/* STEP 2 — Bank Details */}
          {step === 2 && (
            <div className="space-y-4 animate-fade-up">
              <h2 className="text-green-900 font-bold text-lg mb-1">Bank Details</h2>
              <p className="text-green-500 text-sm mb-4">
                Your withdrawals will be sent to this account. Double-check everything.
              </p>

              <div>
                <label className="input-label">Bank Name</label>
                <select className="input" {...register('bank_name')}>
                  <option value="">Select your bank</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                {errors.bank_name && <p className="input-error">{errors.bank_name.message}</p>}
              </div>

              <div>
                <label className="input-label">Account Number</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                  <input type="text" placeholder="10-digit account number"
                    maxLength={10} className="input pl-10 tracking-widest"
                    {...register('account_number')} />
                </div>
                {errors.account_number && <p className="input-error">{errors.account_number.message}</p>}
              </div>

              <div>
                <label className="input-label">Account Name</label>
                <input type="text" placeholder="Name exactly as it appears on your bank"
                  className="input" {...register('account_name')} />
                {errors.account_name && <p className="input-error">{errors.account_name.message}</p>}
              </div>
            </div>
          )}

          {/* STEP 3 — Next of Kin */}
          {step === 3 && (
            <div className="space-y-4 animate-fade-up">
              <h2 className="text-green-900 font-bold text-lg mb-1">Next of Kin</h2>
              <p className="text-green-500 text-sm mb-4">
                This person will be contacted if we cannot reach you.
              </p>

              <div>
                <label className="input-label">Next of Kin Full Name</label>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                  <input type="text" placeholder="e.g. Ngozi Okafor"
                    className="input pl-10" {...register('next_of_kin_name')} />
                </div>
                {errors.next_of_kin_name && <p className="input-error">{errors.next_of_kin_name.message}</p>}
              </div>

              <div>
                <label className="input-label">Next of Kin Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                  <input type="tel" placeholder="e.g. 08098765432"
                    className="input pl-10" {...register('next_of_kin_phone')} />
                </div>
                {errors.next_of_kin_phone && <p className="input-error">{errors.next_of_kin_phone.message}</p>}
              </div>
            </div>
          )}

          {/* STEP 4 — Passwords */}
          {step === 4 && (
            <div className="space-y-4 animate-fade-up">
              <h2 className="text-green-900 font-bold text-lg mb-1">Set Your Passwords</h2>
              <p className="text-green-500 text-sm mb-4">
                You need two passwords — one to log in, one to authorise withdrawals.
              </p>

              <div>
                <label className="input-label">Login Password</label>
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'}
                    placeholder="At least 8 characters"
                    className="input pr-10" {...register('password')} />
                  <button type="button" onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400">
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && <p className="input-error">{errors.password.message}</p>}
              </div>

              <div>
                <label className="input-label">Confirm Login Password</label>
                <div className="relative">
                  <input type={showConfirm ? 'text' : 'password'}
                    placeholder="Repeat login password"
                    className="input pr-10" {...register('confirm_password')} />
                  <button type="button" onClick={() => setShowConfirm(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400">
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.confirm_password && <p className="input-error">{errors.confirm_password.message}</p>}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <label className="input-label text-amber-700">Withdrawal Password</label>
                <p className="text-xs text-amber-600 mb-3">
                  Required every time you request a withdrawal. Keep this different from your login password and memorise it.
                </p>
                <div className="relative">
                  <input type={showWithdraw ? 'text' : 'password'}
                    placeholder="At least 6 characters"
                    className="input pr-10 border-amber-300 focus:ring-amber-400"
                    {...register('withdrawal_password')} />
                  <button type="button" onClick={() => setShowWithdraw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400">
                    {showWithdraw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.withdrawal_password && <p className="input-error">{errors.withdrawal_password.message}</p>}
              </div>

              <label className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={e => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-green-700 flex-shrink-0"
                />
                <span className="text-green-600 text-xs leading-relaxed">
                  I agree to MonieKing's{' '}
                  <button type="button" onClick={() => setLegalDoc('terms')} className="text-green-800 font-semibold underline">
                    Terms of Service
                  </button>{' '}
                  and{' '}
                  <button type="button" onClick={() => setLegalDoc('privacy')} className="text-green-800 font-semibold underline">
                    Privacy Policy
                  </button>
                </span>
              </label>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex gap-3 mt-8">
            {step > 1 && (
              <Button type="button" variant="ghost" size="md"
                onClick={() => setStep(s => s - 1)} className="flex-1">
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
            )}

            {step < STEPS.length ? (
              <Button type="button" variant="primary" size="md"
                onClick={handleNext} className="flex-1">
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button type="submit" variant="accent" size="md"
                loading={loading} disabled={!acceptedTerms} className="flex-1">
                {loading ? 'Creating account…' : 'Create account'}
                {!loading && <Check className="w-4 h-4" />}
              </Button>
            )}
          </div>

          {step === 1 && (
            <p className="text-center text-green-500 text-xs mt-5">
              Already have an account?{' '}
              <Link to="/auth/login" className="text-green-700 font-semibold hover:underline">
                Sign in
              </Link>
            </p>
          )}
        </form>
      </div>
      <LegalDocumentModal doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </div>
  )
}