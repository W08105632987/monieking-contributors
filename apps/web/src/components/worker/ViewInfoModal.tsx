import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Copy, Check, FileText, ExternalLink, ArrowRight
} from 'lucide-react'
import toast from 'react-hot-toast'
import { copyToClipboard, formatNaira } from '@/lib/utils'

export interface JobDetailData {
  id: string
  service_category: string
  service_type: string
  price_kobo: number
  status: string
  customer_name?: string | null
  customer_phone?: string | null
  form_data?: Record<string, any>
  uploaded_files?: string[]
  claimed_at?: string | null
  expires_at?: string | null
  completed_at?: string | null
  worker_status?: string | null
  worker_response?: string | null
  worker_remarks?: string | null
  worker_additional_info?: string | null
  worker_result_file_url?: string | null
  worker_commission_kobo?: number
  referred_worker_id?: string | null
  created_at: string
}

interface ViewInfoModalProps {
  isOpen: boolean
  onClose: () => void
  job: JobDetailData | null
  isPreClaim?: boolean
  onClaim?: (jobId: string) => void
  isClaiming?: boolean
  canClaim?: boolean
  cannotClaimReason?: string
}

export function fieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

export function ViewInfoModal({
  isOpen,
  onClose,
  job,
  isPreClaim = false,
  onClaim,
  isClaiming = false,
  canClaim = true,
  cannotClaimReason,
}: ViewInfoModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  if (!isOpen || !job) return null

  const formData = job.form_data || {}
  const formEntries = Object.entries(formData).filter(
    ([k]) => !['submitted_by_officer_id'].includes(k)
  )

  const handleCopySingle = async (key: string, val: any) => {
    const text = typeof val === 'object' ? JSON.stringify(val) : String(val)
    await copyToClipboard(text)
    setCopiedKey(key)
    toast.success(`Copied ${fieldLabel(key)}`)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const handleCopyAll = async () => {
    const lines = formEntries.map(([k, v]) => `${fieldLabel(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    if (job.customer_name) lines.unshift(`Customer Name: ${job.customer_name}`)
    if (job.customer_phone) lines.unshift(`Customer Phone: ${job.customer_phone}`)
    lines.unshift(`Service: ${job.service_category.replace(/_/g, ' ').toUpperCase()} - ${job.service_type.replace(/_/g, ' ')}`)
    
    await copyToClipboard(lines.join('\n'))
    setCopiedAll(true)
    toast.success('All information copied as formatted text!')
    setTimeout(() => setCopiedAll(false), 2000)
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-green-950/70 dark:bg-night-950/80 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          className="relative bg-white dark:bg-night-800 rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-green-100 dark:border-night-700"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-green-100 dark:border-night-700 flex items-center justify-between bg-surface/50 dark:bg-night-800/50">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-100 dark:bg-night-700 text-green-800 dark:text-night-200">
                  {job.service_category.replace(/_/g, ' ')}
                </span>
                <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                  {formatNaira(job.price_kobo)}
                </span>
              </div>
              <h2 className="text-base font-black text-green-950 dark:text-white mt-1">
                {job.service_type.replace(/_/g, ' ')}
              </h2>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl border border-green-100 dark:border-night-700 text-green-600 dark:text-night-400 hover:bg-green-50 dark:hover:bg-night-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Quick Actions Bar */}
            <div className="flex items-center justify-between bg-green-50/70 dark:bg-night-700/50 p-3 rounded-2xl border border-green-100 dark:border-night-600">
              <span className="text-xs font-bold text-green-900 dark:text-night-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-green-600 dark:text-brand-gold" />
                Submitted Application Info
              </span>

              <button
                onClick={handleCopyAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-night-800 border border-green-200 dark:border-night-600 text-green-800 dark:text-night-100 text-xs font-bold hover:bg-green-100/50 dark:hover:bg-night-700 transition-colors shadow-sm"
              >
                {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-green-600" />}
                <span>{copiedAll ? 'Copied All!' : 'Copy all as text'}</span>
              </button>
            </div>

            {/* Customer Header info if available */}
            {(job.customer_name || job.customer_phone) && (
              <div className="bg-white dark:bg-night-700/40 p-3.5 rounded-2xl border border-green-100 dark:border-night-700 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-green-500 dark:text-night-400">
                  Customer Identifiers {isPreClaim && '(Masked in Pool)'}
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {job.customer_name && (
                    <div>
                      <span className="text-green-600 dark:text-night-400 block text-[10px]">Name</span>
                      <span className="font-semibold text-green-950 dark:text-white font-mono">{job.customer_name}</span>
                    </div>
                  )}
                  {job.customer_phone && (
                    <div>
                      <span className="text-green-600 dark:text-night-400 block text-[10px]">Phone</span>
                      <span className="font-semibold text-green-950 dark:text-white font-mono">{job.customer_phone}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Labeled Rows with individual copy buttons */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-night-400">
                Form Fields ({formEntries.length})
              </span>

              {formEntries.length === 0 ? (
                <div className="py-6 text-center text-xs text-green-600 dark:text-night-400 bg-surface/50 dark:bg-night-700/30 rounded-2xl">
                  No form data specified for this request.
                </div>
              ) : (
                <div className="divide-y divide-green-50 dark:divide-night-700 border border-green-100 dark:border-night-700 rounded-2xl overflow-hidden bg-white dark:bg-night-700/30">
                  {formEntries.map(([key, val]) => {
                    const displayVal = typeof val === 'object' ? JSON.stringify(val) : String(val)
                    const isCopied = copiedKey === key

                    return (
                      <div
                        key={key}
                        className="p-3 flex items-center justify-between hover:bg-green-50/40 dark:hover:bg-night-700/60 transition-colors"
                      >
                        <div className="min-w-0 pr-3">
                          <span className="text-[11px] font-bold text-green-700 dark:text-night-300 block">
                            {fieldLabel(key)}
                          </span>
                          <span className="text-xs font-mono font-semibold text-green-950 dark:text-white break-all">
                            {displayVal || '—'}
                          </span>
                        </div>

                        <button
                          onClick={() => handleCopySingle(key, val)}
                          className="flex-shrink-0 p-1.5 rounded-lg border border-green-100 dark:border-night-600 text-green-600 dark:text-night-300 hover:bg-green-100/50 dark:hover:bg-night-600 transition-colors"
                          title="Copy field value"
                        >
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Uploaded Files / Document Thumbnails */}
            {job.uploaded_files && job.uploaded_files.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-night-400">
                  Uploaded Attachments ({job.uploaded_files.length})
                </span>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {job.uploaded_files.map((url, idx) => {
                    const isImage = url.match(/\.(jpeg|jpg|png|webp)($|\?)/i) || url.startsWith('data:image')

                    return (
                      <div
                        key={idx}
                        className="group relative rounded-xl overflow-hidden border border-green-100 dark:border-night-700 bg-surface dark:bg-night-700 aspect-video flex items-center justify-center cursor-pointer shadow-sm hover:shadow transition-all"
                        onClick={() => {
                          if (isImage) {
                            setPreviewImage(url)
                          } else {
                            window.open(url, '_blank')
                          }
                        }}
                      >
                        {isImage ? (
                          <img
                            src={url}
                            alt={`Attachment ${idx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 p-2 text-center text-green-700 dark:text-night-200">
                            <FileText className="w-6 h-6 text-green-600 dark:text-brand-gold" />
                            <span className="text-[10px] font-bold truncate max-w-[100px]">Doc {idx + 1}</span>
                          </div>
                        )}

                        <div className="absolute inset-0 bg-green-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold gap-1">
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>View</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Post-Resolution Data (if resolved) */}
            {job.worker_response && (
              <div className="p-4 rounded-2xl bg-surface/70 dark:bg-night-700/60 border border-green-100 dark:border-night-600 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-green-700 dark:text-night-300">
                    Resolution Record
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      job.status === 'successful'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                    }`}
                  >
                    {job.status}
                  </span>
                </div>

                <div className="text-xs space-y-1.5 pt-1">
                  <div>
                    <span className="text-[10px] text-green-600 dark:text-night-400 block">Response</span>
                    <p className="font-semibold text-green-950 dark:text-white">{job.worker_response}</p>
                  </div>
                  {job.worker_remarks && (
                    <div>
                      <span className="text-[10px] text-green-600 dark:text-night-400 block">Remarks</span>
                      <p className="text-green-800 dark:text-night-200">{job.worker_remarks}</p>
                    </div>
                  )}
                  {job.worker_result_file_url && (
                    <div className="pt-1">
                      <a
                        href={job.worker_result_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-green-700 dark:text-brand-gold hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>View Attached Proof / Certificate</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer (Pre-claim mode has Claim button) */}
          {isPreClaim && onClaim && (
            <div className="p-4 border-t border-green-100 dark:border-night-700 bg-surface/50 dark:bg-night-800/80 flex items-center justify-between gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-green-200 dark:border-night-600 text-green-800 dark:text-night-200 text-xs font-bold hover:bg-green-50 dark:hover:bg-night-700"
              >
                Close
              </button>

              <button
                onClick={() => {
                  onClaim(job.id)
                  onClose()
                }}
                disabled={isClaiming || !canClaim}
                title={cannotClaimReason}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-green-700 hover:bg-green-800 text-white font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              >
                <span>{isClaiming ? 'Claiming…' : 'Claim this job now'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </motion.div>

        {/* Tap-to-Enlarge Image Lightbox */}
        {previewImage && (
          <div
            className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 cursor-pointer"
            onClick={() => setPreviewImage(null)}
          >
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 p-2 text-white/80 hover:text-white rounded-full bg-white/10"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={previewImage}
              alt="Enlarged Document"
              className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </AnimatePresence>
  )
}
