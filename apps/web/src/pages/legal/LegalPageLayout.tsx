import { useNavigate } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { Seo } from '@/components/seo/Seo'

export const LEGAL_DOCUMENT_VERSION = '2026-09-01'   // keep in sync with LEGAL_DOCUMENT_VERSION in backend/app/api/v1/routes/auth.py

export function LegalPageLayout({
  title, effectiveDate, children, onClose,
}: {
  title: string
  effectiveDate: string
  children: React.ReactNode
  // Set when this is rendered inside LegalDocumentModal (e.g. from the
  // registration form) rather than as its own routed page — swaps the
  // header's back-arrow for a close button, and skips the <Seo> tag
  // (this isn't the actual page in that context, no need for it to
  // compete with whatever page it's embedded in).
  onClose?: () => void
}) {
  const navigate = useNavigate()
  return (
    <div className={onClose ? 'h-full flex flex-col bg-green-50 dark:bg-night-800' : 'min-h-dvh bg-green-50 dark:bg-night-800'}>
      {!onClose && <Seo title={`${title} — MonieKing`} noindex={false} />}
      <header className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-green-50 dark:bg-night-800 z-10 border-b border-green-100 dark:border-night-600 shrink-0">
        <button
          onClick={onClose ?? (() => navigate(-1))}
          className="w-9 h-9 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-xl flex items-center justify-center flex-shrink-0"
        >
          {onClose ? <X className="w-4 h-4 text-green-700 dark:text-night-100" /> : <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />}
        </button>
        <div className="min-w-0">
          <h1 className="text-green-900 dark:text-white font-extrabold text-base truncate">{title}</h1>
          <p className="text-green-400 dark:text-night-300 text-[11px]">Effective {effectiveDate} · Version {LEGAL_DOCUMENT_VERSION}</p>
        </div>
      </header>
      <div className={onClose ? 'flex-1 min-h-0 overflow-y-auto max-w-2xl mx-auto px-5 py-6 pb-16 w-full' : 'max-w-2xl mx-auto px-5 py-6 pb-16'}>
        {children}
      </div>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-green-900 dark:text-white font-bold text-base mb-2">{title}</h2>
      <div className="text-green-700 dark:text-night-100 text-sm leading-relaxed space-y-3">{children}</div>
    </section>
  )
}
