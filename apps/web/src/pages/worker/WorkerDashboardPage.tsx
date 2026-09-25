import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Clock, CheckCircle2, Copy, Check,
  ArrowRight, RefreshCw, X, Upload
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { BottomNav } from '@/components/layout/BottomNav'
import { WorkerHeader } from '@/components/worker/WorkerHeader'
import { formatNaira, copyToClipboard } from '@/lib/utils'

interface JobItem {
  id: string
  user_id: string
  customer_name?: string
  customer_phone?: string
  service_category: string
  service_type: string
  form_data: Record<string, any>
  uploaded_files?: string[]
  price_kobo: number
  status: string
  claimed_by_id?: string | null
  claimed_at?: string | null
  expires_at?: string | null
  completed_at?: string | null
  worker_commission_kobo: number
  created_at: string
}

function CountdownTimer({ expiresAt, onExpire }: { expiresAt: string; onExpire?: () => void }) {
  const [timeLeft, setTimeLeft] = useState<{ minutes: number; seconds: number; isExpired: boolean }>({
    minutes: 0,
    seconds: 0,
    isExpired: false,
  })

  useEffect(() => {
    const calc = () => {
      const diff = new Date(expiresAt).getTime() - Date.now()
      if (diff <= 0) {
        setTimeLeft({ minutes: 0, seconds: 0, isExpired: true })
        onExpire?.()
        return
      }
      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setTimeLeft({ minutes, seconds, isExpired: false })
    }

    calc()
    const timer = setInterval(calc, 1000)
    return () => clearInterval(timer)
  }, [expiresAt, onExpire])

  // Color coding:
  // Green: > 10 mins
  // Yellow/Amber: 1 - 10 mins
  // Red: < 1 min or expired
  let colorTheme = 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30'
  if (timeLeft.isExpired || (timeLeft.minutes === 0 && timeLeft.seconds <= 60)) {
    colorTheme = 'text-rose-500 bg-rose-500/10 border-rose-500/40 animate-pulse'
  } else if (timeLeft.minutes < 10) {
    colorTheme = 'text-amber-500 bg-amber-500/10 border-amber-500/30'
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono font-bold ${colorTheme}`}>
      <Clock className="w-3.5 h-3.5" />
      <span>
        {timeLeft.isExpired
          ? 'EXPIRED'
          : `${String(timeLeft.minutes).padStart(2, '0')}:${String(timeLeft.seconds).padStart(2, '0')} remaining`}
      </span>
    </div>
  )
}

export default function WorkerDashboardPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [copiedCode, setCopiedCode] = useState(false)
  const [resolveModalJob, setResolveModalJob] = useState<JobItem | null>(null)

  // Resolve form state
  const [resolveStatus, setResolveStatus] = useState<'completed' | 'rejected'>('completed')
  const [remarks, setRemarks] = useState('')
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [resultFileUrl, setResultFileUrl] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  // Fetch Worker's own jobs (to find any currently claimed/active job)
  const {
    data: myJobsData,
    refetch: refetchMyJobs,
  } = useQuery({
    queryKey: ['worker-my-jobs'],
    queryFn: async () => {
      const res = await api.get('/worker/jobs/mine')
      return res.data?.data as JobItem[]
    },
    refetchInterval: 10000,
  })

  // Fetch open pool jobs
  const {
    data: poolData,
    isLoading: loadingPool,
    refetch: refetchPool,
    isRefetching: isRefreshingPool,
  } = useQuery({
    queryKey: ['worker-pool', selectedCategory],
    queryFn: async () => {
      const params = selectedCategory !== 'all' ? { category: selectedCategory } : {}
      const res = await api.get('/worker/jobs/pool', { params })
      return res.data?.data as JobItem[]
    },
    refetchInterval: 12000,
  })

  // Worker earnings summary
  useQuery({
    queryKey: ['worker-earnings-summary'],
    queryFn: async () => {
      const res = await api.get('/worker/earnings/summary')
      return res.data
    },
  })

  const activeJob = myJobsData?.find((j) => j.status === 'in_progress')
  const hasActiveJob = Boolean(activeJob)

  // Claim mutation
  const claimMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await api.post(`/worker/jobs/${jobId}/claim`)
      return res.data
    },
    onSuccess: () => {
      toast.success('Job claimed successfully! Please resolve before SLA expires.')
      queryClient.invalidateQueries({ queryKey: ['worker-my-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['worker-pool'] })
    },
    onError: (err) => {
      toast.error(getErrorMessage(err))
    },
  })

  // Resolve mutation
  const resolveMutation = useMutation({
    mutationFn: async ({
      jobId,
      status,
      worker_remarks,
      worker_additional_info,
      worker_result_file_url,
    }: {
      jobId: string
      status: string
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
        resolveStatus === 'completed'
          ? `Job resolved! Commission credited to your balance.`
          : `Job marked as rejected.`
      )
      setResolveModalJob(null)
      setRemarks('')
      setAdditionalInfo('')
      setResultFileUrl('')
      queryClient.invalidateQueries({ queryKey: ['worker-my-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['worker-pool'] })
      queryClient.invalidateQueries({ queryKey: ['worker-earnings-summary'] })
    },
    onError: (err) => {
      toast.error(getErrorMessage(err))
    },
  })

  const handleCopyReferral = async () => {
    if (!user?.referral_code) return
    await copyToClipboard(user.referral_code)
    setCopiedCode(true)
    toast.success('Referral code copied!')
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Preview or convert to base64 Data URL for attachment
    if (file.size > 8 * 1024 * 1024) {
      toast.error('File size must be under 8MB')
      return
    }

    setIsUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      setResultFileUrl(reader.result as string)
      setIsUploading(false)
      toast.success('Document attached!')
    }
    reader.onerror = () => {
      setIsUploading(false)
      toast.error('Failed to read file')
    }
    reader.readAsDataURL(file)
  }

  const categories = [
    { id: 'all', label: 'All Jobs' },
    { id: 'nimc', label: 'NIMC / NIN' },
    { id: 'bvn', label: 'BVN' },
    { id: 'tin', label: 'TIN' },
    { id: 'cac', label: 'CAC' },
    { id: 'attestation', label: 'Attestation' },
  ]

  return (
    <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 pb-24 text-green-950 dark:text-white">
      <WorkerHeader title="Worker Station" subtitle={hasActiveJob ? 'Busy — 1 active job' : 'Free to claim'} />

      <main className="flex-1 px-4 py-4 space-y-5 max-w-lg mx-auto w-full">
        {/* Referral Card */}
        {user?.referral_code && (
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-green-900 via-green-950 to-green-900 text-white flex items-center justify-between shadow-sm border border-green-800">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-brand-gold tracking-wide">
                Your Referral Code
              </span>
              <p className="font-mono text-sm font-black text-white">
                {user.referral_code}
              </p>
            </div>
            <button
              onClick={handleCopyReferral}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-xs font-bold flex items-center gap-1.5 transition-all text-white border border-white/10"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCode ? 'Copied' : 'Share'}
            </button>
          </div>
        )}

        {/* ── Active Job Banner (Priority) ── */}
        {activeJob && (
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
                  onExpire={() => {
                    refetchMyJobs()
                    refetchPool()
                  }}
                />
              )}
            </div>

            <div className="bg-green-50 dark:bg-night-900/60 p-3 rounded-xl border border-green-100 dark:border-night-700 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-sm text-green-950 dark:text-white">
                    {activeJob.service_type || activeJob.service_category.toUpperCase()}
                  </h3>
                  <p className="text-xs text-green-700 dark:text-night-300">
                    Category: {activeJob.service_category}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-green-600 dark:text-night-400 uppercase font-semibold">
                    Commission
                  </span>
                  <p className="font-mono text-sm font-black text-emerald-600 dark:text-emerald-400">
                    +{formatNaira(activeJob.worker_commission_kobo)}
                  </p>
                </div>
              </div>

              {/* Customer information */}
              {activeJob.customer_name && (
                <div className="text-xs text-green-800 dark:text-night-200 pt-1 border-t border-green-100 dark:border-night-700">
                  <span className="font-semibold">Customer:</span> {activeJob.customer_name}
                </div>
              )}

              {/* Form Data Snapshot */}
              {activeJob.form_data && Object.keys(activeJob.form_data).length > 0 && (
                <div className="pt-2 border-t border-green-100 dark:border-night-700">
                  <span className="text-[11px] font-bold text-green-900 dark:text-night-200">
                    Submitted Request Details:
                  </span>
                  <div className="mt-1 max-h-36 overflow-y-auto space-y-1 bg-white/70 dark:bg-night-800/70 p-2 rounded-lg text-xs font-mono">
                    {Object.entries(activeJob.form_data).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2 border-b border-black/5 dark:border-white/5 pb-0.5">
                        <span className="text-green-700 dark:text-night-400">{k}:</span>
                        <span className="text-green-950 dark:text-white font-medium break-all">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Resolve Job Button */}
            <button
              onClick={() => setResolveModalJob(activeJob)}
              className="w-full py-3 px-4 rounded-xl bg-green-700 hover:bg-green-800 text-white font-bold text-sm shadow-md transition-all active:scale-[0.99] flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Complete or Resolve Job
            </button>
          </motion.div>
        )}

        {/* ── Open Job Pool ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-black text-sm uppercase tracking-wider text-green-950 dark:text-white">
                Available Job Pool
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-green-100 dark:bg-night-700 text-green-800 dark:text-night-200">
                {poolData?.length ?? 0}
              </span>
            </div>
            <button
              onClick={() => {
                refetchPool()
                refetchMyJobs()
              }}
              disabled={isRefreshingPool}
              className="p-1.5 rounded-lg text-green-700 dark:text-night-300 hover:bg-green-100 dark:hover:bg-night-800"
              title="Refresh Pool"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshingPool ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-green-800 text-white shadow-sm'
                    : 'bg-white dark:bg-night-800 text-green-800 dark:text-night-300 border border-green-200 dark:border-night-700'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Job Pool List */}
          {loadingPool ? (
            <div className="py-12 text-center text-sm text-green-600 dark:text-night-400">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-green-600" />
              Scanning for available jobs...
            </div>
          ) : !poolData || poolData.length === 0 ? (
            <div className="py-12 px-4 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 space-y-2">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
              <p className="font-bold text-sm text-green-950 dark:text-white">
                All caught up!
              </p>
              <p className="text-xs text-green-700 dark:text-night-400 max-w-xs mx-auto">
                No open jobs in the pool right now. New requests will appear automatically here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {poolData.map((job) => (
                <motion.div
                  key={job.id}
                  layout
                  className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm hover:shadow transition-all space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-green-600 dark:text-brand-gold bg-green-50 dark:bg-night-900 px-2 py-0.5 rounded-md border border-green-200 dark:border-night-700">
                        {job.service_category}
                      </span>
                      <h3 className="font-bold text-sm text-green-950 dark:text-white mt-1">
                        {job.service_type || 'Manual Verification'}
                      </h3>
                      {job.customer_name && (
                        <p className="text-xs text-green-700 dark:text-night-300">
                          From: {job.customer_name}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-green-600 dark:text-night-400">
                        Commission
                      </span>
                      <div className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400">
                        +{formatNaira(job.worker_commission_kobo)}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-green-100 dark:border-night-700 flex items-center justify-between">
                    <span className="text-[11px] text-green-600 dark:text-night-400">
                      Posted {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>

                    <button
                      disabled={hasActiveJob || claimMutation.isPending}
                      onClick={() => claimMutation.mutate(job.id)}
                      className="px-3.5 py-1.5 rounded-xl bg-green-700 hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 shadow-sm"
                      title={hasActiveJob ? 'Resolve your current active job first' : 'Claim this job'}
                    >
                      {claimMutation.isPending ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <span>Claim Job</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* ── Resolve Job Modal Sheet ── */}
      <AnimatePresence>
        {resolveModalJob && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 280 }}
              className="bg-white dark:bg-night-800 rounded-t-3xl sm:rounded-3xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto space-y-4 border border-green-100 dark:border-night-700"
            >
              <div className="flex items-center justify-between pb-2 border-b border-green-100 dark:border-night-700">
                <div>
                  <h3 className="font-black text-base text-green-950 dark:text-white">
                    Resolve Service Request
                  </h3>
                  <p className="text-xs text-green-700 dark:text-night-400">
                    {resolveModalJob.service_type || resolveModalJob.service_category}
                  </p>
                </div>
                <button
                  onClick={() => setResolveModalJob(null)}
                  className="w-8 h-8 rounded-full bg-green-100 dark:bg-night-700 flex items-center justify-center text-green-700 dark:text-night-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Status Switcher: Completed vs Rejected */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-green-50 dark:bg-night-900 rounded-xl">
                <button
                  type="button"
                  onClick={() => setResolveStatus('completed')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    resolveStatus === 'completed'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-green-800 dark:text-night-300'
                  }`}
                >
                  ✓ Mark Completed
                </button>
                <button
                  type="button"
                  onClick={() => setResolveStatus('rejected')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    resolveStatus === 'rejected'
                      ? 'bg-rose-600 text-white shadow'
                      : 'text-green-800 dark:text-night-300'
                  }`}
                >
                  ✗ Reject Request
                </button>
              </div>

              {/* Resolution Remarks */}
              <div>
                <label className="block text-xs font-bold text-green-900 dark:text-night-200 mb-1">
                  {resolveStatus === 'completed' ? 'Resolution Remarks' : 'Reason for Rejection'} *
                </label>
                <textarea
                  rows={3}
                  required
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={
                    resolveStatus === 'completed'
                      ? 'e.g. Verified and NIN slip generated successfully.'
                      : 'e.g. Details provided do not match national registry records.'
                  }
                  className="w-full p-3 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-900 text-green-950 dark:text-white text-xs outline-none focus:border-green-600"
                />
              </div>

              {/* Additional Information */}
              <div>
                <label className="block text-xs font-bold text-green-900 dark:text-night-200 mb-1">
                  Customer Message / Additional Information (Optional)
                </label>
                <input
                  type="text"
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  placeholder="e.g. Reference code: NIMC-98214"
                  className="w-full px-3 py-2 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-900 text-green-950 dark:text-white text-xs outline-none focus:border-green-600"
                />
              </div>

              {/* Result Slip / Document Attachment */}
              {resolveStatus === 'completed' && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-green-900 dark:text-night-200">
                    Attach Result Slip / Certificate (Optional)
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="flex-1 cursor-pointer flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-green-300 dark:border-night-600 hover:border-green-500 bg-green-50/50 dark:bg-night-900 text-xs font-bold text-green-800 dark:text-night-200 transition-colors">
                      <Upload className="w-4 h-4 text-green-600" />
                      <span>{isUploading ? 'Reading file...' : resultFileUrl ? 'Replace Attachment' : 'Choose Document / Slip'}</span>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                  {resultFileUrl && (
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-200">
                      <span className="truncate max-w-[240px]">Document attached ✓</span>
                      <button
                        type="button"
                        onClick={() => setResultFileUrl('')}
                        className="text-rose-500 font-bold hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Submit Resolve */}
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setResolveModalJob(null)}
                  className="flex-1 py-3 rounded-xl border border-green-200 dark:border-night-700 text-green-800 dark:text-night-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!remarks.trim() || resolveMutation.isPending}
                  onClick={() =>
                    resolveMutation.mutate({
                      jobId: resolveModalJob.id,
                      status: resolveStatus,
                      worker_remarks: remarks.trim(),
                      worker_additional_info: additionalInfo.trim(),
                      worker_result_file_url: resultFileUrl || undefined,
                    })
                  }
                  className={`flex-1 py-3 rounded-xl text-white font-bold text-xs shadow-md transition-all active:scale-[0.99] flex items-center justify-center gap-2 ${
                    resolveStatus === 'completed'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {resolveMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>Submit & Credit Commission</span>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  )
}
