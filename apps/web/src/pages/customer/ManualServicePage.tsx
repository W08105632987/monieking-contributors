import { useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, ShieldCheck, AlertCircle, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira } from '@/lib/utils'

// Form components
import { NinModificationForm } from '@/components/manual-services/NinModificationForm'
import { NinValidationForm } from '@/components/manual-services/NinValidationForm'
import { BvnModificationForm } from '@/components/manual-services/BvnModificationForm'
import { BvnRetrievalForm } from '@/components/manual-services/BvnRetrievalForm'
import { BvnLicenseForm } from '@/components/manual-services/BvnLicenseForm'
import { NinDelinkingForm } from '@/components/manual-services/NinDelinkingForm'
import { TinRegistrationForm } from '@/components/manual-services/TinRegistrationForm'
import { AttestationForm } from '@/components/manual-services/AttestationForm'
import { CacRegistrationForm } from '@/components/manual-services/CacRegistrationForm'
import { SelfServiceModificationForm } from '@/components/manual-services/SelfServiceModificationForm'

// ─── Service metadata ────────────────────────────────────────────────────────
export const MANUAL_SERVICE_META: Record<string, {
  title: string
  category: string
  description: string
  emoji: string
}> = {
  nin_modification: {
    title: 'NIN Modification',
    category: 'nin_modification',
    description: 'Update your NIN record — name, phone, date of birth, or address.',
    emoji: '🪪',
  },
  nin_validation: {
    title: 'NIN Validation',
    category: 'nin_validation',
    description: 'Validate or resolve issues with an existing NIN record.',
    emoji: '✅',
  },
  bvn_modification: {
    title: 'BVN Modification',
    category: 'bvn_modification',
    description: 'Update your BVN record through your enrollment bank.',
    emoji: '🏦',
  },
  bvn_retrieval: {
    title: 'BVN Retrieval',
    category: 'bvn_retrieval',
    description: 'Retrieve a lost or forgotten BVN by phone number or CRM.',
    emoji: '🔍',
  },
  bvn_license: {
    title: 'BVN License Creation',
    category: 'bvn_license',
    description: 'Create and register a new BVN with your enrollment bank.',
    emoji: '🔐',
  },
  nin_delinking: {
    title: 'NIN Delinking',
    category: 'nin_delinking',
    description: 'Delink a SIM, phone, or account from your NIN.',
    emoji: '🔗',
  },
  tin_registration: {
    title: 'TIN Registration',
    category: 'tin_registration',
    description: 'Register a Tax Identification Number (TIN) for individuals or companies.',
    emoji: '📋',
  },
  nin_attestation: {
    title: 'NIN Attestation',
    category: 'nin_attestation',
    description: 'Officially attest your NIN for use abroad or legal purposes.',
    emoji: '📜',
  },
  cac_registration: {
    title: 'CAC Registration',
    category: 'cac_registration',
    description: 'Register your business name or company with the CAC.',
    emoji: '🏢',
  },
  self_service_modification: {
    title: 'Self-Service Modification',
    category: 'self_service_modification',
    description: 'Modify your NIN record directly through the self-service portal.',
    emoji: '⚙️',
  },
}

// ─── Payload type shared by all child forms ───────────────────────────────────
interface FormPayload {
  service_type: string
  enrollment_bank?: string
  form_data: Record<string, any>
  uploaded_files: string[]
  price_kobo: number
  bulk_count?: number
}

export default function ManualServicePage() {
  const navigate = useNavigate()
  const { serviceKey, customerId } = useParams<{ serviceKey: string; customerId?: string }>()

  const meta = MANUAL_SERVICE_META[serviceKey ?? '']

  const [formPayload, setFormPayload] = useState<FormPayload | null>(null)
  const [referralCode, setReferralCode] = useState('')
  const [referralWorker, setReferralWorker] = useState<string | null>(null)
  const [consentGiven, setConsentGiven] = useState(false)
  const [txPin, setTxPin] = useState('')
  const [showPin, setShowPin] = useState(false)

  const handleReferralChange = async (code: string) => {
    const clean = code.trim().toUpperCase()
    setReferralCode(clean)
    if (clean.length >= 6) {
      try {
        const { data } = await api.get(`/manual-services/validate-referral/${clean}`)
        if (data.valid) setReferralWorker(data.worker_name || 'Verified Service Worker')
        else setReferralWorker(null)
      } catch {
        setReferralWorker(null)
      }
    } else {
      setReferralWorker(null)
    }
  }

  const handleFormChange = useCallback((payload: FormPayload) => {
    setFormPayload(payload)
  }, [])

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!formPayload) throw new Error('Form not ready')
      const body = {
        service_category: meta.category,
        service_type: formPayload.service_type,
        form_data: {
          ...formPayload.form_data,
          ...(referralCode ? { referral_code: referralCode, referred_worker: referralWorker } : {}),
        },
        uploaded_files: formPayload.uploaded_files,
        consent_given: consentGiven,
        referred_worker_id: referralCode || null,
        transaction_pin: txPin || null,
        enrollment_bank: formPayload.enrollment_bank || null,
        bulk_count: formPayload.bulk_count ?? 1,
      }
      const { data } = await api.post('/manual-services', body)
      return data
    },
    onSuccess: () => {
      toast.success('Service request submitted successfully!')
      navigate(-1)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const priceKobo = formPayload?.price_kobo ?? 0
  const canSubmit = consentGiven && formPayload && !submitMutation.isPending

  if (!meta) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-green-50 dark:bg-night-800 px-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
        <h1 className="text-green-900 dark:text-white font-bold text-xl mb-2">Service Not Found</h1>
        <p className="text-green-500 dark:text-night-300 text-sm mb-6">This service doesn't exist or isn't available.</p>
        <button
          onClick={() => navigate(-1)}
          className="bg-green-600 text-white font-bold px-6 py-2.5 rounded-full text-sm"
        >
          Go Back
        </button>
      </div>
    )
  }

  const renderForm = () => {
    switch (serviceKey) {
      case 'nin_modification':
        return <NinModificationForm onChange={handleFormChange} />
      case 'nin_validation':
        return <NinValidationForm onChange={handleFormChange} />
      case 'bvn_modification':
        return <BvnModificationForm onChange={handleFormChange} />
      case 'bvn_retrieval':
        return <BvnRetrievalForm onChange={handleFormChange} />
      case 'bvn_license':
        return <BvnLicenseForm onChange={handleFormChange} />
      case 'nin_delinking':
        return <NinDelinkingForm onChange={handleFormChange} />
      case 'tin_registration':
        return <TinRegistrationForm onChange={handleFormChange} />
      case 'nin_attestation':
        return <AttestationForm onChange={handleFormChange} />
      case 'cac_registration':
        return <CacRegistrationForm onChange={handleFormChange} />
      case 'self_service_modification':
        return <SelfServiceModificationForm onChange={handleFormChange} />
      default:
        return (
          <div className="text-center py-12">
            <p className="text-green-500 dark:text-night-300 text-sm">Form not implemented yet.</p>
          </div>
        )
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-night-900 border-b border-green-100 dark:border-night-600 flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-green-900 dark:text-white font-bold text-base leading-tight truncate">
            {meta.emoji} {meta.title}
          </h1>
          <p className="text-green-500 dark:text-night-300 text-xs truncate">{meta.description}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-36">
        <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">

          {/* Officer Banner */}
          {customerId && (
            <div className="bg-amber-50 dark:bg-night-700 border border-amber-200 dark:border-night-500 rounded-2xl px-4 py-3">
              <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">
                Submitting on this customer's behalf — charged to their wallet.
              </p>
            </div>
          )}

          {/* Render the appropriate form */}
          {renderForm()}

          {/* Referral Code */}
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200">
                Service Worker Referral Code (Optional)
              </label>
              {referralWorker && (
                <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs">✓ {referralWorker}</span>
              )}
            </div>
            <input
              value={referralCode}
              onChange={e => handleReferralChange(e.target.value)}
              placeholder="e.g. SW-A1B2C3"
              className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-800 px-4 py-2.5 text-sm font-mono text-green-900 dark:text-white uppercase outline-none focus:border-green-500"
            />
          </div>

          {/* Transaction PIN */}
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200">
              Transaction PIN (Required to confirm payment)
            </label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={txPin}
                onChange={e => setTxPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter your 4–6 digit PIN"
                className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-800 px-4 py-3 pr-12 text-sm font-mono tracking-widest text-green-900 dark:text-white outline-none focus:border-green-500"
              />
              <button
                type="button"
                onClick={() => setShowPin(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300"
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Bar (fixed) */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-white dark:bg-night-900 border-t border-green-100 dark:border-night-600 px-4 py-4 space-y-3 max-w-lg mx-auto">
        {/* Consent */}
        <button
          type="button"
          onClick={() => setConsentGiven(c => !c)}
          className="w-full flex items-start gap-2.5 bg-green-50 dark:bg-night-700 rounded-2xl p-3 text-left"
        >
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-green-700 dark:text-night-100" />
          <p className="text-[11px] leading-relaxed text-green-800 dark:text-night-100">
            {consentGiven ? '☑' : '☐'} I confirm I have provided accurate information and consent to this service being processed. Charges are non-refundable once submitted.
          </p>
        </button>

        {/* Price + Submit */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            {priceKobo > 0 && (
              <>
                <p className="text-xs text-green-500 dark:text-night-300 font-semibold">Amount to pay</p>
                <p className="text-green-900 dark:text-white font-extrabold text-xl leading-tight">{formatNaira(priceKobo)}</p>
              </>
            )}
          </div>
          <button
            onClick={() => submitMutation.mutate()}
            disabled={!canSubmit}
            className="flex-1 font-bold text-sm rounded-full py-3.5 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900 disabled:opacity-40 transition-opacity"
          >
            {submitMutation.isPending
              ? 'Submitting…'
              : priceKobo > 0
                ? `Pay ${formatNaira(priceKobo)}`
                : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
