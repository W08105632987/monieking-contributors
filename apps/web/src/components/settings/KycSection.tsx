import { useNavigate } from 'react-router-dom'
import { CreditCard, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { kycPath } from '@/lib/kyc'

interface KycSectionProps {
  bvnLinked: boolean
  ninLinked: boolean
  bvnLast4?: string | null
  ninLast4: string | null
  hasVirtualAccount?: boolean
  onVerified?: (fields: { bvnLinked: boolean; ninLinked: boolean; bvnLast4: string | null; ninLast4: string | null }) => void
}

/** A simple row: shows KYC status and opens the full-screen KYC page. */
export function KycSection({ bvnLinked, ninLinked, ninLast4, isLast = false }: KycSectionProps & { isLast?: boolean }) {
  const nav = useNavigate()
  const role = useAuthStore((s) => s.user?.role)
  const done = ninLinked || bvnLinked
  return (
    <button
      onClick={() => nav(kycPath(role))}
      className={`w-full flex items-center gap-3 py-3.5 active:bg-green-50/50 dark:active:bg-white/5 transition-all text-left ${isLast ? '' : 'border-b border-green-50 dark:border-night-600'}`}
    >
      <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
        <CreditCard className="w-4 h-4 text-green-500 dark:text-night-200" />
      </div>
      <div className="flex-1">
        <p className="text-green-900 dark:text-white text-sm font-semibold">Identity verification (KYC)</p>
        <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
          {done ? `NIN verified${ninLast4 ? ` · ••••${ninLast4}` : ''}` : 'Verify your NIN to unlock every service'}
        </p>
      </div>
      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${done ? 'text-green-600 dark:text-green-300 bg-green-50 dark:bg-green-500/10' : 'text-red-500 dark:text-red-300 bg-red-50 dark:bg-red-500/10'}`}>
        {done ? 'KYC complete' : 'Not verified'}
      </span>
      <ChevronRight className="w-4 h-4 text-green-300" />
    </button>
  )
}
