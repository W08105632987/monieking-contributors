import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, Share2, Image as ImageIcon, FileText, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, formatDateTime, cn } from '@/lib/utils'
import { AppLogo } from '@/components/ui/AppLogo'
import { FallbackError } from '@/components/ui/FallbackError'

interface ReceiptData {
  id: string
  type: 'credit' | 'debit'
  category: string
  amount_kobo: number
  balance_after_kobo: number
  reference: string
  description: string | null
  created_at: string
  account_holder_name: string | null
  verification_code: string
  details: Record<string, string | number>
}

const CATEGORY_TITLE: Record<string, string> = {
  wallet_funding:       'Wallet Funding',
  contribution:         'Contribution',
  withdrawal:           'Withdrawal',
  charge:               'Service Payment',
  officer_contribution: 'Cash Contribution',
  reversal:             'Reversal',
  sms_fee:              'SMS Subscription',
}

/**
 * The one shared receipt used everywhere a transaction needs to appear
 * as a formal record — wallet funding, withdrawals, contributions, bill
 * payments, manual services, everything. Rendered once as the single
 * source-of-truth layout, then captured via html2canvas for both the
 * on-screen view and the PDF/image exports, so the exported document
 * can never visually drift from what's shown on screen.
 */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const receiptRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState<'pdf' | 'image' | null>(null)

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['transaction-receipt', id],
    queryFn: async () => {
      const { data } = await api.get<ReceiptData>(`/wallets/transactions/${id}/receipt`)
      return data
    },
    enabled: !!id,
  })

  async function captureCanvas() {
    if (!receiptRef.current) return null
    const html2canvas = (await import('html2canvas')).default
    return html2canvas(receiptRef.current, {
      backgroundColor: '#ffffff',
      scale: 2, // crisp on retina screens and when zoomed into the PDF
      useCORS: true,
    })
  }

  async function handleShareImage() {
    setExporting('image')
    try {
      const canvas = await captureCanvas()
      if (!canvas) return
      canvas.toBlob(async (blob) => {
        if (!blob) return
        const file = new File([blob], `MonieKing-Receipt-${data?.verification_code}.png`, { type: 'image/png' })
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'MonieKing Receipt' })
        } else {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = file.name
          a.click()
          URL.revokeObjectURL(url)
        }
      }, 'image/png')
    } finally {
      setExporting(null)
    }
  }

  async function handleSharePdf() {
    setExporting('pdf')
    try {
      const canvas = await captureCanvas()
      if (!canvas) return
      const { jsPDF } = await import('jspdf')
      const imgData = canvas.toDataURL('image/png')
      // A4-proportioned single page sized to the captured receipt's
      // own aspect ratio, so the receipt isn't awkwardly letterboxed.
      const pdfWidth = 210
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width
      const pdf = new jsPDF({ unit: 'mm', format: [pdfWidth, pdfHeight] })
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
      const blob = pdf.output('blob')
      const file = new File([blob], `MonieKing-Receipt-${data?.verification_code}.pdf`, { type: 'application/pdf' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'MonieKing Receipt' })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        URL.revokeObjectURL(url)
      }
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Receipt</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isError ? (
          <FallbackError title="Couldn't load this receipt" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading || !data ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl h-96 animate-pulse" />
        ) : (
          <>
            {/* ── The receipt itself — this exact DOM subtree is what gets captured for PDF/image export ── */}
            <div
              ref={receiptRef}
              className="relative bg-white rounded-2xl border border-green-100 shadow-card overflow-hidden"
            >
              {/* Watermark — logo repeated diagonally at low opacity across the whole body */}
              <div
                className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-[0.04]"
                style={{ transform: 'rotate(-30deg) scale(2.2)' }}
                aria-hidden="true"
              >
                <div className="grid grid-cols-3 gap-10">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <AppLogo key={i} size={80} />
                  ))}
                </div>
              </div>

              <div className="relative p-6">
                {/* Header */}
                <div className="flex items-center justify-between pb-5 border-b-2 border-dashed border-green-100">
                  <div className="flex items-center gap-3">
                    <AppLogo size={44} />
                    <div>
                      <p className="text-green-900 font-extrabold text-base leading-tight">MonieKing</p>
                      <p className="text-green-400 text-[11px] font-semibold">Official Transaction Receipt</p>
                    </div>
                  </div>
                  <div className={cn(
                    'px-3 py-1 rounded-full text-[11px] font-bold',
                    data.type === 'credit' ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500',
                  )}>
                    {data.type === 'credit' ? 'MONEY IN' : 'MONEY OUT'}
                  </div>
                </div>

                {/* Amount */}
                <div className="text-center py-6">
                  <p className="text-green-400 text-xs font-bold uppercase tracking-wide mb-1">
                    {CATEGORY_TITLE[data.category] || data.category}
                  </p>
                  <p className={cn('text-4xl font-extrabold tracking-tight', data.type === 'credit' ? 'text-green-700' : 'text-red-500')}>
                    {data.type === 'credit' ? '+' : '-'}{formatNaira(data.amount_kobo)}
                  </p>
                  {data.description && (
                    <p className="text-green-600 text-sm font-semibold mt-2">{data.description}</p>
                  )}
                </div>

                {/* Core fields */}
                <div className="bg-green-50/70 rounded-2xl p-4 space-y-2.5">
                  <Row label="Account holder" value={data.account_holder_name || '—'} />
                  <Row label="Date & time" value={formatDateTime(data.created_at)} />
                  <Row label="Reference" value={data.reference} mono />
                  <Row label="Balance after" value={formatNaira(data.balance_after_kobo)} />
                  {Object.entries(data.details).map(([label, value]) => (
                    <Row key={label} label={label} value={String(value)} />
                  ))}
                </div>

                {/* Security footer */}
                <div className="flex items-center justify-between mt-5 pt-4 border-t-2 border-dashed border-green-100">
                  <div className="flex items-center gap-1.5 text-green-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-semibold">Verification code</span>
                  </div>
                  <span className="text-green-700 text-xs font-mono font-bold tracking-wider">{data.verification_code}</span>
                </div>
                <p className="text-green-300 text-[10px] text-center mt-3">
                  This is a system-generated official record from MonieKing. Generated {formatDateTime(new Date().toISOString())}.
                </p>
              </div>
            </div>

            {/* ── Share actions — outside the captured subtree, not part of the receipt itself ── */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button
                onClick={handleSharePdf}
                disabled={exporting !== null}
                className="flex items-center justify-center gap-2 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm py-3.5 rounded-xl active:scale-95 transition-all disabled:opacity-50"
              >
                {exporting === 'pdf' ? <Download className="w-4 h-4 animate-bounce" /> : <FileText className="w-4 h-4" />}
                Share as PDF
              </button>
              <button
                onClick={handleShareImage}
                disabled={exporting !== null}
                className="flex items-center justify-center gap-2 bg-white dark:bg-night-700 border-2 border-green-900 dark:border-night-300 text-green-900 dark:text-white font-bold text-sm py-3.5 rounded-xl active:scale-95 transition-all disabled:opacity-50"
              >
                {exporting === 'image' ? <Download className="w-4 h-4 animate-bounce" /> : <ImageIcon className="w-4 h-4" />}
                Share as Image
              </button>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-green-300 dark:text-night-300 text-xs mt-3">
              <Share2 className="w-3.5 h-3.5" /> Uses your device's native share sheet where available
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-green-500 text-xs font-semibold shrink-0">{label}</span>
      <span className={cn('text-green-900 text-sm font-bold text-right min-w-0 break-words', mono && 'font-mono text-xs break-all')}>
        {value}
      </span>
    </div>
  )
}
