import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Link } from 'react-router-dom'
import {
  Eye, EyeOff, Phone, User, Building2,
  CreditCard, Users, ChevronRight, ChevronLeft, Check, ShieldCheck, AlertTriangle,
} from 'lucide-react'
import toast from '@/lib/notify'
import { supabase } from '@/lib/supabase'
import { api, getErrorMessage } from '@/lib/api'
import { BankPickerModal, type Bank } from '@/components/settings/BankPickerModal'
import { queryClient } from '@/lib/queryClient'
import { useAuthStore } from '@/store/auth.store'
import { Button } from '@/components/ui/Button'
import type { AuthUser } from '@/types'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'
import { LegalDocumentModal } from '@/pages/legal/LegalDocumentModal'
import { friendlyError } from '@/lib/errorText'

// ── Validation schema ─────────────────────────────────────────────
const schema = z.object({
  full_name:           z.string().min(3, 'Enter your full name'),
  phone_number:        z.string().min(10, 'Enter a valid phone number').max(15),
  email:               z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
  bank_name:           z.string().min(2, 'Enter your bank name'),
  account_number:      z.string().length(10, 'Account number must be exactly 10 digits'),
  account_name:        z.string().min(3, 'Enter the account name as it appears on your bank'),
  next_of_kin_name:    z.string().min(3, 'Enter next of kin full name'),
  next_of_kin_phone:   z.string().min(10, 'Enter next of kin phone number'),
  password:            z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password:    z.string(),
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


export default function RegisterPage() {
  const navigate    = useNavigate()
  const { setUser } = useAuthStore()
  const [step, setStep]   = useState(1)
  const isResume = new URLSearchParams(window.location.search).get('resume') === 'true'
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd]             = useState(false)
  const [showConfirm, setShowConfirm]     = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [legalDoc, setLegalDoc] = useState<'terms' | 'privacy' | null>(null)

  const { register, handleSubmit, trigger, setValue, getValues, watch, formState: { errors } } =
    useForm<FormData>({ resolver: zodResolver(schema), mode: 'onBlur' })

  // Legal-name confirmation (cannot be changed after sign-up; KYC compares it with the NIN and the bank account)
  const [confirmedName, setConfirmedName] = useState('')
  const [showNameConfirm, setShowNameConfirm] = useState(false)
  const [nameAck, setNameAck] = useState(false)

  // Bank + account number -> account name, filled in by the bank itself (never typed)
  const [bank, setBank] = useState<Bank | null>(null)
  const [showBankPicker, setShowBankPicker] = useState(false)
  const [resolvedName, setResolvedName] = useState('')
  const [resolving, setResolving] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const accountNumber = watch('account_number') ?? ''
  const typedName = watch('full_name') ?? ''

  useEffect(() => {
    setResolvedName(''); setLookupError('')
    setValue('account_name', '')
    if (!(bank && /^\d{10}$/.test(accountNumber))) { setResolving(false); return }
    let stale = false
    setResolving(true)
    api.get<{ account_name: string }>('/auth/resolve-bank-account', { params: { bank_code: bank.code, account_number: accountNumber } })
      .then(({ data }) => { if (stale) return; setResolvedName(data.account_name); setValue('account_name', data.account_name, { shouldValidate: true }) })
      .catch((e) => { if (!stale) setLookupError(getErrorMessage(e)) })
      .finally(() => { if (!stale) setResolving(false) })
    return () => { stale = true }
  }, [bank, accountNumber, setValue])

  // Does the bank's name share at least one word with the name typed in step 1? (KYC will compare them.)
  const words = (t: string) => t.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
  const nameOverlaps = !resolvedName || words(typedName).some(w => words(resolvedName).includes(w))

  const stepFields: Record<number, (keyof FormData)[]> = {
    1: ['full_name', 'phone_number', 'email'],
    2: ['bank_name', 'account_number', 'account_name'],
    3: ['next_of_kin_name', 'next_of_kin_phone'],
    4: ['password', 'confirm_password'],
  }

  const handleNext = async () => {
    if (step === 2 && !resolvedName) { toast.error(lookupError || 'Choose your bank and enter your account number so we can verify it'); return }
    const valid = await trigger(stepFields[step])
    if (!valid) return
    if (step === 1 && confirmedName !== getValues('full_name').trim()) {
      setNameAck(false); setShowNameConfirm(true); return   // must confirm the legal name before moving on
    }
    setStep(s => s + 1)
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
      let token: string | null = null
      if (!isResume) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email:    emailAlias,
          password: values.password,
        })
        if (signUpError && !signUpError.message.toLowerCase().includes('already')) {
          throw new Error(signUpError.message)
        }
        token = signUpData?.session?.access_token ?? null
      }

      if (!token) {
        const { data: sessionData } = await supabase.auth.getSession()
        token = sessionData?.session?.access_token ?? null
      }
      if (!token) {
        try {
          const { data: signInData } = await supabase.auth.signInWithPassword({
            email:    emailAlias,
            password: values.password,
          })
          token = signInData?.session?.access_token ?? null
        } catch {
          // Continue to session cookie attempt below
        }
      }

      // Small delay to ensure Supabase Auth has committed the user
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Step 2 — Start a session (backend sets it as an httpOnly cookie)
      try {
        await api.post('/auth/signup-session', {
          phone_number: values.phone_number.replace(/\s+/g, ''),
          password:     values.password,
        })
      } catch (sessionErr) {
        console.warn('Signup session cookie setup note:', sessionErr)
      }

      // Step 3 — Create platform user record on backend
      // Accepts session cookie OR Authorization Bearer token as fallback.
      const authHeaders: Record<string, string> = {}
      if (token) {
        authHeaders['Authorization'] = `Bearer ${token}`
      }

      try {
        await api.post('/auth/register', {
          full_name:           values.full_name,
          phone_number:        values.phone_number.replace(/\s+/g, ''),
          ...(values.email ? { email: values.email.trim() } : {}),
          bank_name:           bank?.name ?? values.bank_name,
          bank_code:           bank?.code,
          account_number:      values.account_number,
          account_name:        values.account_name,
          next_of_kin_name:    values.next_of_kin_name,
          next_of_kin_phone:   values.next_of_kin_phone.replace(/\s+/g, ''),
          password:            values.password,
          accepted_terms:      true,
        }, { headers: authHeaders })
      } catch (apiErr: any) {
        const rawDetail = apiErr?.response?.data?.detail
        const alreadyRegistered = typeof rawDetail === 'string' && rawDetail.toLowerCase().includes('already registered')
        const msg = friendlyError(apiErr, 'Registration failed. Please try again.')
        // If backend says already registered, just continue — user may be retrying
        if (!alreadyRegistered) {
          throw new Error(msg)
        }
      }

      // Step 4 — Fetch profile and set in store
      const { data: profile } = await api.get<AuthUser>('/users/me', { headers: authHeaders })
      queryClient.clear()  // same reasoning as login — never trust leftover cache from a prior session on this device
      setUser(profile)

      toast.success('Welcome to MonieKing! Your account is ready.')
      navigate('/auth/location-consent', { replace: true })

    } catch (err: any) {
      toast.error(friendlyError(err, 'Registration failed. Please try again.'))
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

              <div>
                <label className="input-label">Email <span className="font-normal text-green-500">(optional)</span></label>
                <input type="email" autoCapitalize="none" placeholder="you@example.com" className="input" {...register('email')} />
                {errors.email && <p className="input-error">{errors.email.message}</p>}
                <p className="text-xs text-green-500 mt-1">Lets you reset your password by email. We'll send a code to confirm it after you sign in.</p>
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
                <label className="input-label">Bank</label>
                <button type="button" onClick={() => setShowBankPicker(true)}
                  className="input flex items-center justify-between text-left">
                  <span className={bank ? 'text-green-900 font-semibold' : 'text-green-400'}>{bank ? bank.name : 'Choose your bank…'}</span>
                  <ChevronRight className="w-4 h-4 text-green-400" />
                </button>
                {errors.bank_name && !bank && <p className="input-error">{errors.bank_name.message}</p>}
              </div>

              <div>
                <label className="input-label">Account Number</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                  <input type="text" inputMode="numeric" placeholder="10-digit account number"
                    maxLength={10} className="input pl-10 tracking-widest"
                    {...register('account_number', { onChange: e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10) } })} />
                </div>
                {errors.account_number && <p className="input-error">{errors.account_number.message}</p>}
              </div>

              {resolving && <p className="text-green-500 text-xs">Verifying your account with the bank…</p>}
              {lookupError && <p className="input-error">{lookupError}</p>}
              {resolvedName && (
                <div className="rounded-2xl border border-green-200 bg-green-50 p-3.5">
                  <p className="text-[11px] font-semibold text-green-600 uppercase tracking-wide mb-1">Account name from your bank</p>
                  <p className="flex items-center gap-2 text-green-900 font-bold text-sm"><ShieldCheck className="w-4 h-4 text-green-600 shrink-0" />{resolvedName}</p>
                </div>
              )}
              {resolvedName && !nameOverlaps && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-amber-800 text-xs leading-relaxed">
                    This name is different from <b>{typedName.trim()}</b>, the name you entered earlier. Identity verification compares the two, so they should be the same person. Go back and correct your name if it was a nickname.
                  </p>
                </div>
              )}
            </div>
          )}

          <BankPickerModal open={showBankPicker} banksPath="/auth/banks" selectedCode={bank?.code}
            onClose={() => setShowBankPicker(false)}
            onSelect={b => { setBank(b); setValue('bank_name', b.name, { shouldValidate: true }) }} />

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

              <p className="rounded-xl border border-green-100 bg-green-50 p-3 text-xs text-green-700">
                After you log in, a short checklist helps you verify your identity and set your payment PIN and withdrawal password.
              </p>

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
      {showNameConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-green-950/70 backdrop-blur-sm" />
          <div className="relative bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 pb-8 animate-fade-up">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center mb-4"><ShieldCheck className="w-6 h-6 text-amber-600" /></div>
            <h2 className="text-green-900 font-extrabold text-xl mb-1">Is this your legal name?</h2>
            <p className="text-green-600 text-sm mb-4">You are about to create your account as:</p>
            <p className="text-green-900 font-extrabold text-2xl bg-green-50 rounded-2xl px-4 py-3 mb-4 break-words">{typedName.trim()}</p>
            <ul className="text-green-700 text-sm space-y-2 mb-5">
              <li className="flex gap-2"><Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />It <b>cannot be changed</b> after you create your account.</li>
              <li className="flex gap-2"><Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />It must be your <b>full legal name</b>, exactly as on your NIN and bank account. Not a nickname.</li>
              <li className="flex gap-2"><Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />We check it against your NIN and bank account when you verify your identity. A mismatch means you cannot complete verification.</li>
            </ul>
            <label className="flex items-start gap-2.5 text-sm text-green-900 font-semibold mb-5">
              <input type="checkbox" className="mt-1" checked={nameAck} onChange={e => setNameAck(e.target.checked)} />
              <span>Yes, this is my full legal name.</span>
            </label>
            <div className="flex gap-3">
              <Button type="button" variant="ghost" size="md" className="flex-1" onClick={() => setShowNameConfirm(false)}>Edit name</Button>
              <Button type="button" variant="primary" size="md" className="flex-1" disabled={!nameAck}
                onClick={() => { setConfirmedName(getValues('full_name').trim()); setShowNameConfirm(false); setStep(2) }}>
                Confirm and continue
              </Button>
            </div>
          </div>
        </div>
      )}
      <LegalDocumentModal doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </div>
  )
}