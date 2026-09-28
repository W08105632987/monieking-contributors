import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Clock, CheckCircle2, XCircle,
  Upload, ShieldAlert, X, Eye,
  Briefcase,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatServiceCategory, formatServiceType } from '@/lib/utils'
import { WorkerHeader } from '@/components/worker/WorkerHeader'
import { ViewInfoModal, type JobDetailData } from '@/components/worker/ViewInfoModal'
import { useJobPoolRealtime } from '@/hooks/useJobPoolRealtime'

interface JobItem {
  id: string
  user_id: string
  customer_name?: string | null
  customer_phone?: string | null
  service_category: string
  service_type: string
  price_kobo: number
  status: 'pending' | 'processing' | 'successful' | 'failed'
  claimed_at?: string | null
  expires_at?: string | null
  completed_at?: string | null
  worker_status?: string | null
  worker_response?: string | null
  worker_remarks?: string | null
  worker_additional_info?: string | null
  worker_result_file_url?: string | null
  worker_commission_kobo: number
  form_data?: Record<string, any>
  uploaded_files?: string[]
  created_at: string
}

function CountdownTimer({ expiresAt, onExpire }: { expiresAt: string; onExpire?: () => void }) {
  const [timeLeft, setTimeLeft] = useState('')
  const [isUrgent, setIsUrgent] = useState(false)

  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now()
      if (diff <= 0) {
        setTimeLeft('SLA Expired')
        setIsUrgent(true)
        onExpire?.()
        return
      }
      const mins = Math.floor(diff / 60000)
      const secs = Math.floor((diff % 60000) / 1000)
      setTimeLeft(`${mins}m ${secs < 10 ? '0' : ''}${secs}s`)
      setIsUrgent(mins < 5)
    }

    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [expiresAt, onExpire])

  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold ${
        isUrgent
          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 animate-pulse'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
      }`}
    >
      <Clock className="w-3.5 h-3.5" />
      <span>{timeLeft}</span>
    </div>
  )
}

export default function WorkerMyJobsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Realtime subscription for automatic instant updates
  useJobPoolRealtime()

  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active')

  // Selected job for ViewInfoModal
  const [selectedJob, setSelectedJob] = useState<JobDetailData | null>(null)

  // Resolve Modal State
  const [resolveModalJob, setResolveModalJob] = useState<JobItem | null>(null)
  const [resolveStatus, setResolveStatus] = useState<'successful' | 'failed'>('successful')
  const [remarks, setRemarks] = useState('')
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [resultFileUrl, setResultFileUrl] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  // Dispute Modal State
  const [disputeModalJob, setDisputeModalJob] = useState<JobItem | null>(null)
  const [disputeReason, setDisputeReason] = useState<string>('customer_info_incorrect')
  const [disputeMessage, setDisputeMessage] = useState('')
  const [disputeAttachmentUrl, setDisputeAttachmentUrl] = useState('')
  const [isDisputeUploading, setIsDisputeUploading] = useState(false)

  // Dedicated active job query so claimed job appears immediately without waiting
  const { data: activeJobRes } = useQuery<{ job: JobItem | null }>({
    queryKey: ['worker-active-job'],
    queryFn: async () => {
      const res = await api.get('/worker/jobs/active')
      return res.data
    },
    refetchInterval: 8000,
  })

  // Fetch claimed jobs for this worker
  const { data: myJobsData, isLoading } = useQuery<{
    data: JobItem[]
    total: number
  }>({
    queryKey: ['worker-my-jobs'],
    queryFn: async () => {
      const res = await api.get('/worker/jobs/mine')
      return res.data
    },
    refetchInterval: 10000,
  })

  const jobsList = myJobsData?.data || []
  const activeJob = activeJobRes?.job ?? jobsList.find((j) => j.status === 'processing')
  const completedJobs = jobsList.filter((j) => j.status === 'successful' || j.status === 'failed')

  // Immediate SLA expiration action: triggers backend reclaim and refreshes state
  const handleExpire = async () => {
    try {
      await api.post('/worker/jobs/reclaim-expired')
    } catch (_) {}
    queryClient.invalidateQueries({ queryKey: ['worker-active-job'] })
    queryClient.invalidateQueries({ queryKey: ['worker-my-jobs'] })
    queryClient.invalidateQueries({ queryKey: ['worker-pool'] })
    queryClient.invalidateQueries({ queryKey: ['worker-referred-jobs'] })
    toast.error('SLA expired! The job has returned to the open pool.')
  }

  // Resolve Job Mutation
  const resolveMutation = useMutation({
    mutationFn: async ({
      jobId,
      status,
      worker_remarks,
      worker_additional_info,
      worker_result_file_url,
    }: {
      jobId: string
      status: 'successful' | 'failed'
      worker_remarks: string
      worker_additional_info: string
      worker_result_file_url?: string
    }) => {
      const res = await api.post(`/worker/jobs/${jobId}/resolve`, {
        worker_status: status,
        worker_remarks,
        worker_additional_info,
        worker_result_file_url: worker_result_file_url || null,
      })
      return res.data
    },
    onSuccess: () => {
      toast.success(
        resolveStatus === 'successful'
          ? `Job marked successful! Commission credited.`
          : `Job marked as failed.`
      )
      setResolveModalJob(null)
      setRemarks('')
      setAdditionalInfo('')
      setResultFileUrl('')
      queryClient.invalidateQueries({ queryKey: ['worker-active-job'] })
      queryClient.invalidateQueries({ queryKey: ['worker-my-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['worker-pool'] })
      queryClient.invalidateQueries({ queryKey: ['worker-referred-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['worker-earnings-summary'] })
    },
    onError: (err) => {
      toast.error(getErrorMessage(err))
    },
  })

  // Worker Dispute Mutation
  const disputeMutation = useMutation({
    mutationFn: async ({
      jobId,
      reason,
      message,
      attachment_url,
    }: {
      jobId: string
      reason: string
      message: string
      attachment_url?: string
    }) => {
      const res = await api.post('/disputes/manual-service/worker-raise', {
        service_request_id: jobId,
        reason,
        message,
        attachment_url: attachment_url || null,
      })
      return res.data
    },
    onSuccess: () => {
      toast.success('Dispute submitted to Director queue.')
      setDisputeModalJob(null)
      setDisputeMessage('')
      setDisputeAttachmentUrl('')
      queryClient.invalidateQueries({ queryKey: ['worker-disputes'] })
      navigate('/worker/disputes')
    },
    onError: (err) => {
      toast.error(getErrorMessage(err))
    },
  })

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isForDispute = false) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 8 * 1024 * 1024) {
      toast.error('File size must be under 8MB')
      return
    }

    if (isForDispute) setIsDisputeUploading(true)
    else setIsUploading(true)

    const reader = new FileReader()
    reader.onload = () => {
      if (isForDispute) {
        setDisputeAttachmentUrl(reader.result as string)
        setIsDisputeUploading(false)
        toast.success('Dispute evidence attached!')
      } else {
        setResultFileUrl(reader.result as string)
        setIsUploading(false)
        toast.success('Resolution document attached!')
      }
    }
    reader.onerror = () => {
      if (isForDispute) setIsDisputeUploading(false)
      else setIsUploading(false)
      toast.error('Failed to read file')
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 pb-safe-nav text-green-950 dark:text-white">
      <WorkerHeader
        title="My Jobs"
        subtitle={activeJob ? '1 active job in progress' : 'No active jobs claimed'}
      />

      <main className="flex-1 px-4 py-4 space-y-4 max-w-lg mx-auto w-full">
        {/* Segmented Control */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-green-100/60 dark:bg-night-800 rounded-2xl">
          <button
            onClick={() => setActiveTab('active')}
            className={`py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'active'
                ? 'bg-white dark:bg-night-700 text-green-950 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300'
            }`}
          >
            <span>Active</span>
            {activeJob && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('completed')}
            className={`py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'completed'
                ? 'bg-white dark:bg-night-700 text-green-950 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300'
            }`}
          >
            Completed ({completedJobs.length})
          </button>
        </div>

        {/* ── Tab: Active Job ── */}
        {activeTab === 'active' && (
          <div className="space-y-4">
            {activeJob ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 rounded-2xl bg-white dark:bg-night-800 border-2 border-brand-gold shadow-md space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                    </span>
                    <span className="text-xs font-black uppercase tracking-wider text-green-950 dark:text-white">
                      Active Claimed Job
                    </span>
                  </div>
                  {activeJob.expires_at && (
                    <CountdownTimer
                      expiresAt={activeJob.expires_at}
                      onExpire={handleExpire}
                    />
                  )}
                </div>

                <div className="bg-green-50 dark:bg-night-900/60 p-3.5 rounded-xl border border-green-100 dark:border-night-700 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-sm text-green-950 dark:text-white">
                        {formatServiceType(activeJob.service_type || activeJob.service_category)}
                      </h3>
                      <p className="text-xs text-green-700 dark:text-night-300">
                        Category: {formatServiceCategory(activeJob.service_category)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-green-600 dark:text-night-400 uppercase font-semibold">
                        Service Fee
                      </span>
                      <p className="font-mono text-sm font-black text-amber-600 dark:text-amber-400">
                        {formatNaira(activeJob.price_kobo)}
                      </p>
                    </div>
                  </div>

                  {activeJob.customer_name && (
                    <div className="pt-2 border-t border-green-100 dark:border-night-700 flex justify-between text-xs">
                      <span className="text-green-700 dark:text-night-400">Customer:</span>
                      <span className="font-bold text-green-950 dark:text-white">
                        {activeJob.customer_name} ({activeJob.customer_phone || 'No phone'})
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions: View Info, Resolve, Dispute */}
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSelectedJob(activeJob as JobDetailData)}
                      className="py-2.5 px-3 rounded-xl border border-green-200 dark:border-night-600 text-green-900 dark:text-white text-xs font-bold hover:bg-green-50 dark:hover:bg-night-700 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Eye className="w-4 h-4 text-green-600 dark:text-brand-gold" />
                      <span>View Info</span>
                    </button>

                    <button
                      onClick={() => {
                        setResolveModalJob(activeJob)
                        setResolveStatus('successful')
                        setRemarks('')
                        setAdditionalInfo('')
                        setResultFileUrl('')
                      }}
                      className="py-2.5 px-3 rounded-xl bg-green-700 hover:bg-green-800 text-white text-xs font-bold shadow transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Resolve Job</span>
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      setDisputeModalJob(activeJob)
                      setDisputeReason('customer_info_incorrect')
                      setDisputeMessage('')
                      setDisputeAttachmentUrl('')
                    }}
                    className="w-full py-2 px-3 rounded-xl text-rose-600 dark:text-rose-400 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center gap-1.5 transition-colors border border-rose-100 dark:border-rose-900/50"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Dispute this job</span>
                  </button>
                </div>
              </motion.div>
            ) : (
              <div className="py-16 px-4 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 space-y-3">
                <Briefcase className="w-10 h-10 text-green-300 dark:text-night-500 mx-auto" />
                <h3 className="font-bold text-sm text-green-950 dark:text-white">
                  No Active Job Right Now
                </h3>
                <p className="text-xs text-green-700 dark:text-night-400 max-w-xs mx-auto">
                  You are free to claim new requests from the Job Pool.
                </p>
                <button
                  onClick={() => navigate('/worker/dashboard')}
                  className="px-5 py-2.5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-bold text-xs shadow-md active:scale-95 transition-all"
                >
                  Go to Job Pool
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Completed Jobs ── */}
        {activeTab === 'completed' && (
          <div className="space-y-3">
            {isLoading ? (
              <div className="py-12 text-center text-xs text-green-600 dark:text-night-400">
                Loading history...
              </div>
            ) : completedJobs.length === 0 ? (
              <div className="py-16 px-4 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 space-y-2">
                <CheckCircle2 className="w-10 h-10 text-green-300 dark:text-night-500 mx-auto" />
                <h3 className="font-bold text-sm text-green-950 dark:text-white">
                  No Completed Jobs Yet
                </h3>
                <p className="text-xs text-green-700 dark:text-night-400">
                  Jobs you resolve will appear here with commission records.
                </p>
              </div>
            ) : (
              completedJobs.map((job) => (
                <div
                  key={job.id}
                  className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            job.status === 'successful'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          {job.status}
                        </span>
                        <span className="text-[10px] text-green-500 dark:text-night-400">
                          {job.completed_at
                            ? new Date(job.completed_at).toLocaleDateString()
                            : new Date(job.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="font-bold text-sm text-green-950 dark:text-white mt-1">
                        {formatServiceType(job.service_type || job.service_category)}
                      </h4>
                      <p className="text-xs text-green-600 dark:text-night-400">
                        {job.customer_name || 'Customer'}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] uppercase font-semibold text-green-600 dark:text-night-400 block">
                        Commission
                      </span>
                      <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        +{formatNaira(job.worker_commission_kobo || 0)}
                      </span>
                    </div>
                  </div>

                  {job.worker_remarks && (
                    <p className="text-xs bg-surface dark:bg-night-700/50 p-2.5 rounded-xl text-green-800 dark:text-night-300 italic border border-green-100 dark:border-night-600">
                      "{job.worker_remarks}"
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-green-50 dark:border-night-700">
                    <button
                      onClick={() => setSelectedJob(job as JobDetailData)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-green-700 dark:text-brand-gold hover:underline"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View Info</span>
                    </button>

                    <button
                      onClick={() => {
                        setDisputeModalJob(job)
                        setDisputeReason('commission_dispute')
                        setDisputeMessage('')
                        setDisputeAttachmentUrl('')
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Dispute this job</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Shared ViewInfoModal */}
      <ViewInfoModal
        isOpen={selectedJob !== null}
        onClose={() => setSelectedJob(null)}
        job={selectedJob}
        isPreClaim={false}
      />

      {/* Resolve Modal */}
      <AnimatePresence>
        {resolveModalJob && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setResolveModalJob(null)}
              className="absolute inset-0 bg-green-950/70 dark:bg-night-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white dark:bg-night-800 rounded-3xl w-full max-w-md p-5 space-y-4 shadow-2xl border border-green-100 dark:border-night-700"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-green-100 dark:border-night-700 pb-3">
                <h3 className="font-black text-base text-green-950 dark:text-white">
                  Resolve Service Request
                </h3>
                <button
                  onClick={() => setResolveModalJob(null)}
                  className="p-1 rounded-xl text-green-600 dark:text-night-400 hover:bg-green-50 dark:hover:bg-night-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Status Selector */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setResolveStatus('successful')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    resolveStatus === 'successful'
                      ? 'bg-emerald-500 text-white border-emerald-600 shadow-sm'
                      : 'border-green-200 dark:border-night-700 text-green-800 dark:text-night-300'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Mark Successful</span>
                </button>

                <button
                  type="button"
                  onClick={() => setResolveStatus('failed')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    resolveStatus === 'failed'
                      ? 'bg-rose-500 text-white border-rose-600 shadow-sm'
                      : 'border-green-200 dark:border-night-700 text-green-800 dark:text-night-300'
                  }`}
                >
                  <XCircle className="w-4 h-4" />
                  <span>Mark Failed</span>
                </button>
              </div>

              {/* Remarks Textarea */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-green-900 dark:text-white">
                  Resolution Remarks <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={
                    resolveStatus === 'successful'
                      ? 'e.g. NIN modification submitted and approved on NIMC portal. Slips generated.'
                      : 'e.g. Customer provided mismatched DOB; portal rejected validation.'
                  }
                  rows={3}
                  className="w-full p-3 rounded-xl border border-green-200 dark:border-night-700 bg-surface dark:bg-night-900 text-xs text-green-950 dark:text-white outline-none focus:border-green-600"
                />
              </div>

              {/* File Attachment */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-green-900 dark:text-white">
                  Result Slip / Confirmation Slip (Optional)
                </label>
                <div className="flex items-center gap-2">
                  <label className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-green-300 dark:border-night-600 bg-green-50/50 dark:bg-night-900/50 cursor-pointer hover:bg-green-50 transition-colors">
                    <Upload className="w-4 h-4 text-green-600 dark:text-night-400" />
                    <span className="text-xs text-green-800 dark:text-night-300 font-semibold">
                      {isUploading
                        ? 'Uploading…'
                        : resultFileUrl
                        ? 'Document Attached'
                        : 'Upload Photo / PDF (max 8MB)'}
                    </span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => handleFileUpload(e, false)}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResolveModalJob(null)}
                  className="flex-1 py-2.5 rounded-xl border border-green-200 dark:border-night-700 text-xs font-bold text-green-800 dark:text-night-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!remarks.trim() || resolveMutation.isPending || isUploading}
                  onClick={() => {
                    if (!resolveModalJob) return
                    resolveMutation.mutate({
                      jobId: resolveModalJob.id,
                      status: resolveStatus,
                      worker_remarks: remarks,
                      worker_additional_info: additionalInfo,
                      worker_result_file_url: resultFileUrl,
                    })
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-white font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 ${
                    resolveStatus === 'successful'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {resolveMutation.isPending ? 'Submitting…' : 'Confirm Resolution'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Worker Dispute Modal */}
      <AnimatePresence>
        {disputeModalJob && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDisputeModalJob(null)}
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
                    Dispute Job #{disputeModalJob.id.slice(0, 8)}
                  </h3>
                </div>
                <button
                  onClick={() => setDisputeModalJob(null)}
                  className="p-1 rounded-xl text-green-600 dark:text-night-400 hover:bg-green-50 dark:hover:bg-night-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-green-700 dark:text-night-300">
                This dispute lands directly in the Director queue for oversight and manual review.
              </p>

              {/* Reason Selector */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-green-900 dark:text-white">
                  Reason for Dispute
                </label>
                <select
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-green-200 dark:border-night-700 bg-surface dark:bg-night-900 text-xs font-semibold text-green-950 dark:text-white outline-none focus:border-green-600"
                >
                  <option value="customer_info_incorrect">Customer Information Incorrect / Unusable</option>
                  <option value="portal_unavailable">Government / Bank Portal Down</option>
                  <option value="commission_dispute">Commission / Pricing Discrepancy</option>
                  <option value="other">Other Operational Issue</option>
                </select>
              </div>

              {/* Message */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-green-900 dark:text-white">
                  Explanation for Director <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={disputeMessage}
                  onChange={(e) => setDisputeMessage(e.target.value)}
                  placeholder="Detail the issue encountered (e.g. portal returned specific error code, customer supplied invalid NIN)..."
                  rows={3}
                  className="w-full p-3 rounded-xl border border-green-200 dark:border-night-700 bg-surface dark:bg-night-900 text-xs text-green-950 dark:text-white outline-none focus:border-green-600"
                />
              </div>

              {/* Attachment */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-green-900 dark:text-white">
                  Screenshot or Portal Error Evidence (Optional)
                </label>
                <label className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-green-300 dark:border-night-600 bg-green-50/50 dark:bg-night-900/50 cursor-pointer hover:bg-green-50 transition-colors">
                  <Upload className="w-4 h-4 text-green-600 dark:text-night-400" />
                  <span className="text-xs text-green-800 dark:text-night-300 font-semibold">
                    {isDisputeUploading
                      ? 'Attaching…'
                      : disputeAttachmentUrl
                      ? 'Evidence Attached'
                      : 'Attach Screenshot / Proof'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => handleFileUpload(e, true)}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDisputeModalJob(null)}
                  className="flex-1 py-2.5 rounded-xl border border-green-200 dark:border-night-700 text-xs font-bold text-green-800 dark:text-night-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!disputeMessage.trim() || disputeMutation.isPending || isDisputeUploading}
                  onClick={() => {
                    if (!disputeModalJob) return
                    disputeMutation.mutate({
                      jobId: disputeModalJob.id,
                      reason: disputeReason,
                      message: disputeMessage,
                      attachment_url: disputeAttachmentUrl,
                    })
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {disputeMutation.isPending ? 'Submitting…' : 'Submit to Director'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
