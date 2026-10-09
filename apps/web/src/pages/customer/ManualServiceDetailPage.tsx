import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, AlertTriangle,
  FileText, ExternalLink, ShieldAlert, X, Upload
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatDateTime, cn, formatServiceCategory, formatServiceType } from '@/lib/utils'
import { fieldLabel } from '@/components/worker/ViewInfoModal'

interface ServiceRequestDetail {
  id: string
  service_category: string
  service_type: string
  price_kobo: number
  status: 'pending' | 'processing' | 'successful' | 'failed'
  worker_status?: string | null
  worker_response?: string | null
  worker_remarks?: string | null
  worker_result_file_url?: string | null
  form_data?: Record<string, any>
  uploaded_files?: string[]
  claimed_at?: string | null
  expires_at?: string | null
  completed_at?: string | null
  created_at: string
}

export default function ManualServiceDetailPage() {
  const { requestId } = useParams<{ requestId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [isDisputeOpen, setIsDisputeOpen] = useState(false)
  const [disputeMessage, setDisputeMessage] = useState('')
  const [disputeAttachmentUrl, setDisputeAttachmentUrl] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  const { data: request, isLoading, isError } = useQuery<ServiceRequestDetail>({
    queryKey: ['manual-service-request-detail', requestId],
    queryFn: async () => {
      const res = await api.get(`/manual-services/my-requests/${requestId}`)
      return res.data
    },
    enabled: Boolean(requestId),
  })

  // Dispute mutation
  const disputeMutation = useMutation({
    mutationFn: async ({
      serviceRequestId,
      message,
      attachmentUrl,
    }: {
      serviceRequestId: string
      message: string
      attachmentUrl?: string
    }) => {
      const res = await api.post('/disputes/manual-service', {
        service_request_id: serviceRequestId,
        message,
        attachment_url: attachmentUrl || null,
      })
      return res.data
    },
    onSuccess: (data) => {
      toast.success('Dispute submitted successfully! Our team will review it.')
      setIsDisputeOpen(false)
      setDisputeMessage('')
      setDisputeAttachmentUrl('')
      queryClient.invalidateQueries({ queryKey: ['my-disputes'] })
      navigate(`/disputes/${data.id}`)
    },
    onError: (err) => {
      toast.error(getErrorMessage(err))
    },
  })

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 8 * 1024 * 1024) {
      toast.error('File size must be under 8MB')
      return
    }

    setIsUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      setDisputeAttachmentUrl(reader.result as string)
      setIsUploading(false)
      toast.success('Attachment ready!')
    }
    reader.onerror = () => {
      setIsUploading(false)
      toast.error('Failed to read file')
    }
    reader.readAsDataURL(file)
  }

  if (isLoading) {
    return (
      <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 pb-20 text-green-950 dark:text-white">
        <header className="px-4 py-3 border-b border-green-100 dark:border-night-700 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-800 flex items-center justify-center">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-4 w-32 bg-green-100 dark:bg-night-700 rounded animate-pulse" />
        </header>
        <div className="p-4 space-y-4 max-w-lg mx-auto w-full">
          <div className="h-32 bg-white dark:bg-night-800 rounded-2xl animate-pulse" />
          <div className="h-48 bg-white dark:bg-night-800 rounded-2xl animate-pulse" />
        </div>
      </div>
    )
  }

  if (isError || !request) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 text-center bg-surface dark:bg-night-900">
        <AlertTriangle className="w-12 h-12 text-amber-500 mb-3" />
        <h2 className="text-base font-bold text-green-950 dark:text-white">Service Request Not Found</h2>
        <p className="text-xs text-green-700 dark:text-night-300 mt-1 mb-4">
          This service request may have been removed or does not belong to your account.
        </p>
        <button
          onClick={() => navigate('/customer/manual-services/history')}
          className="px-4 py-2 bg-green-700 text-white rounded-xl text-xs font-bold"
        >
          Back to History
        </button>
      </div>
    )
  }

  const formData = request.form_data || {}
  // Uploaded files are shown as "Doc 1 / Doc 2" buttons below, not as raw link rows.
  const uploadedUrls = new Set(request.uploaded_files || [])
  const formEntries = Object.entries(formData).filter(([k, v]) => {
    if (['submitted_by_officer_id', 'selected_modification'].includes(k)) return false
    if (typeof v === 'string' && uploadedUrls.has(v)) return false
    if (v === null || v === undefined) return false
    if (typeof v === 'string' && v.trim() === '') return false
    if (Array.isArray(v) && v.length === 0) return false
    return true
  })
  const isCompleted = request.status === 'successful' || request.status === 'failed'

  return (
    <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 pb-24 text-green-950 dark:text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-white/80 dark:bg-night-800/80 backdrop-blur-md border-b border-green-100 dark:border-night-700">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 bg-green-50 dark:bg-night-700 rounded-xl flex items-center justify-center text-green-800 dark:text-white border border-green-100 dark:border-night-600"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-base font-black text-green-950 dark:text-white">
            Request Details
          </h1>
          <p className="text-xs text-green-700 dark:text-night-400">
            #{request.id.slice(0, 8)}
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-4 max-w-lg mx-auto w-full">
        {/* Main Status & Fee Card */}
        <div className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                'text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full inline-block',
                request.status === 'successful'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                  : request.status === 'failed'
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300'
                  : request.status === 'processing'
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
              )}
            >
              {request.status === 'processing'
                ? 'Processing by Worker'
                : request.status === 'pending'
                ? 'Awaiting Worker Claim'
                : request.status.toUpperCase()}
            </span>
            <span className="text-xs font-semibold text-green-600 dark:text-night-300">
              {formatServiceCategory(request.service_category)}
            </span>
          </div>

          <div>
            <h2 className="text-lg font-black text-green-950 dark:text-white">
              {formatServiceType(request.service_type || request.service_category)}
            </h2>
            <p className="font-mono text-xl font-bold text-green-800 dark:text-brand-gold mt-0.5">
              {formatNaira(request.price_kobo)}
            </p>
          </div>
        </div>

        {/* ── Status Timeline ── */}
        <div className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm space-y-3">
          <h3 className="font-bold text-xs uppercase tracking-wider text-green-600 dark:text-night-400">
            Request Timeline
          </h3>

          <div className="space-y-4 relative pl-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-green-100 dark:before:bg-night-700">
            {/* Step 1: Submitted */}
            <div className="relative">
              <span className="absolute -left-5 top-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-white dark:ring-night-800" />
              <div>
                <p className="font-bold text-xs text-green-950 dark:text-white">Request Submitted</p>
                <p className="text-[10px] text-green-600 dark:text-night-400">
                  {formatDateTime(request.created_at)}
                </p>
              </div>
            </div>

            {/* Step 2: Claimed / Processing */}
            <div className="relative">
              <span
                className={cn(
                  'absolute -left-5 top-0.5 w-3 h-3 rounded-full ring-4 ring-white dark:ring-night-800',
                  request.claimed_at
                    ? 'bg-emerald-500'
                    : 'bg-green-200 dark:bg-night-600'
                )}
              />
              <div>
                <p className="font-bold text-xs text-green-950 dark:text-white">
                  {request.claimed_at ? 'Assigned to Service Worker' : 'Queued in Job Pool'}
                </p>
                <p className="text-[10px] text-green-600 dark:text-night-400">
                  {request.claimed_at
                    ? `Worker claimed at ${formatDateTime(request.claimed_at)}`
                    : 'Awaiting an available service worker'}
                </p>
              </div>
            </div>

            {/* Step 3: Resolution */}
            <div className="relative">
              <span
                className={cn(
                  'absolute -left-5 top-0.5 w-3 h-3 rounded-full ring-4 ring-white dark:ring-night-800',
                  request.status === 'successful'
                    ? 'bg-emerald-500'
                    : request.status === 'failed'
                    ? 'bg-rose-500'
                    : 'bg-green-200 dark:bg-night-600'
                )}
              />
              <div>
                <p className="font-bold text-xs text-green-950 dark:text-white">
                  {request.status === 'successful'
                    ? 'Successfully Completed'
                    : request.status === 'failed'
                    ? 'Marked as Failed'
                    : 'Resolution Pending'}
                </p>
                <p className="text-[10px] text-green-600 dark:text-night-400">
                  {request.completed_at
                    ? formatDateTime(request.completed_at)
                    : 'Worker will update with slip/confirmation once processed'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Worker Remarks & Result File ── */}
        {(request.worker_remarks || request.worker_result_file_url) && (
          <div className="p-4 rounded-2xl bg-surface dark:bg-night-800/80 border border-green-200 dark:border-night-700 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-green-700 dark:text-night-300">
              Worker Outcome Remarks
            </span>
            {request.worker_remarks && (
              <p className="text-xs text-green-900 dark:text-white font-medium">
                {request.worker_remarks}
              </p>
            )}
            {request.worker_result_file_url && (
              <div className="pt-2">
                <a
                  href={request.worker_result_file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-700 hover:bg-green-800 text-white text-xs font-bold shadow-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Download / View Slip</span>
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── Submitted Form Details (Read-only) ── */}
        <div className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm space-y-3">
          <h3 className="font-bold text-xs uppercase tracking-wider text-green-600 dark:text-night-400">
            Application Information
          </h3>

          <div className="divide-y divide-green-50 dark:divide-night-700 text-xs">
            {formEntries.map(([k, v]) => (
              <div key={k} className="py-2 flex items-center justify-between">
                <span className="text-green-600 dark:text-night-400">{fieldLabel(k)}</span>
                <span className="font-semibold text-green-950 dark:text-white font-mono">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
          </div>

          {/* Uploaded Files */}
          {request.uploaded_files && request.uploaded_files.length > 0 && (
            <div className="pt-2 border-t border-green-50 dark:border-night-700 space-y-2">
              <span className="text-[10px] uppercase font-bold text-green-600 dark:text-night-400">
                Attached Documents ({request.uploaded_files.length})
              </span>
              <div className="flex flex-wrap gap-2">
                {request.uploaded_files.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-50 dark:bg-night-700 text-green-800 dark:text-night-200 text-xs font-bold border border-green-100 dark:border-night-600 hover:bg-green-100"
                  >
                    <FileText className="w-3.5 h-3.5 text-green-600" />
                    <span>Doc {i + 1}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Dispute Action (for completed requests) ── */}
        {isCompleted && (
          <div className="pt-2">
            <button
              onClick={() => setIsDisputeOpen(true)}
              className="w-full py-3 px-4 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center gap-2 transition-colors"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Dispute this outcome</span>
            </button>
          </div>
        )}
      </main>

      {/* Customer Dispute Modal */}
      <AnimatePresence>
        {isDisputeOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDisputeOpen(false)}
              className="absolute inset-0 bg-green-950/70 dark:bg-night-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white dark:bg-night-800 rounded-3xl w-full max-w-md p-5 space-y-4 shadow-2xl border border-rose-100 dark:border-night-700"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-green-100 dark:border-night-700 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-rose-500" />
                  <h3 className="font-black text-base text-green-950 dark:text-white">
                    Dispute Service Outcome
                  </h3>
                </div>
                <button
                  onClick={() => setIsDisputeOpen(false)}
                  className="p-1 rounded-xl text-green-600 dark:text-night-400 hover:bg-green-50 dark:hover:bg-night-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-green-700 dark:text-night-300">
                If the service worker provided an incorrect slip or improperly marked your request, explain the issue below.
              </p>

              <div className="space-y-1">
                <label className="text-xs font-bold text-green-900 dark:text-white">
                  Reason / Message <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={disputeMessage}
                  onChange={(e) => setDisputeMessage(e.target.value)}
                  placeholder="Explain why this service request outcome is disputed..."
                  rows={4}
                  className="w-full p-3 rounded-xl border border-green-200 dark:border-night-700 bg-surface dark:bg-night-900 text-xs text-green-950 dark:text-white outline-none focus:border-green-600"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-green-900 dark:text-white">
                  Supporting Evidence / Screenshot (Optional)
                </label>
                <label className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-green-300 dark:border-night-600 bg-green-50/50 dark:bg-night-900/50 cursor-pointer hover:bg-green-50 transition-colors">
                  <Upload className="w-4 h-4 text-green-600 dark:text-night-400" />
                  <span className="text-xs text-green-800 dark:text-night-300 font-semibold">
                    {isUploading
                      ? 'Attaching…'
                      : disputeAttachmentUrl
                      ? 'File Attached'
                      : 'Attach Proof (Photo / PDF)'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDisputeOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-green-200 dark:border-night-700 text-xs font-bold text-green-800 dark:text-night-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!disputeMessage.trim() || disputeMutation.isPending || isUploading}
                  onClick={() => {
                    disputeMutation.mutate({
                      serviceRequestId: request.id,
                      message: disputeMessage,
                      attachmentUrl: disputeAttachmentUrl,
                    })
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {disputeMutation.isPending ? 'Submitting…' : 'Submit Dispute'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
