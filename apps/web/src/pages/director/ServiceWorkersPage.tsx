import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, RefreshCw, X, Copy, Check,
  ArrowUpRight, Phone, CheckCircle2
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, copyToClipboard, formatServiceCategory, formatServiceType } from '@/lib/utils'
import { BottomNav } from '@/components/layout/BottomNav'

interface WorkerListItem {
  id: string
  full_name?: string | null
  phone_number: string
  referral_code?: string | null
  status: string
  state_of_residence?: string | null
  commission_balance_kobo: number
  onboarding_completed: boolean
  is_busy: boolean
  active_job_id?: string | null
  active_job_expires_at?: string | null
  jobs_completed: number
  pending_referred_count?: number
  created_at: string
}

interface WorkerStats {
  free_workers: number
  busy_workers: number
  unattended_jobs: number
  completed_today: number
  total_workers: number
  sla_breaches_today?: number
  referral_expiries_today?: number
}

interface JobOverview {
  id: string
  user_id: string
  customer_name?: string
  service_category: string
  service_type: string
  price_kobo: number
  status: string
  claimed_by_id?: string | null
  worker_name?: string | null
  referred_worker_id?: string | null
  referred_worker_name?: string | null
  claimed_at?: string | null
  expires_at?: string | null
  completed_at?: string | null
  worker_commission_kobo: number
  worker_result_file_url?: string | null
  dispute_id?: string | null
  dispute_status?: string | null
  dispute_created_at?: string | null
  commission_status?: string | null
  commission_held_kobo?: number | null
  created_at: string
}

interface PayoutRequest {
  id: string
  worker_id: string
  worker_name?: string
  worker_phone?: string
  amount_kobo: number
  bank_name: string
  account_number: string
  account_name: string
  status: string
  created_at: string
}

export default function ServiceWorkersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'workers' | 'jobs' | 'payouts'>('workers')

  // Search & Filter States
  const [workerSearch, setWorkerSearch] = useState('')
  const [workerFilter, setWorkerFilter] = useState<'all' | 'free' | 'busy'>('all')
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('all')
  const [jobCategoryFilter, setJobCategoryFilter] = useState<string>('all')
  const [poolTypeFilter, setPoolTypeFilter] = useState<'all' | 'referred' | 'open'>('all')

  // Create Worker Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [createdResult, setCreatedResult] = useState<{
    whatsapp_invite_text: string
    default_password: string
    worker: { phone_number: string; referral_code: string }
  } | null>(null)
  const [copiedInvite, setCopiedInvite] = useState(false)

  // Rejection modal
  const [rejectPayoutId, setRejectPayoutId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // 1. Live Stats Query
  const { data: stats, refetch: refetchStats } = useQuery<WorkerStats>({
    queryKey: ['director-worker-stats'],
    queryFn: async () => {
      const res = await api.get('/worker/stats')
      return res.data
    },
    refetchInterval: 10000,
  })

  // 2. Workers List Query
  const { data: workersData, isLoading: loadingWorkers, refetch: refetchWorkers } = useQuery<{
    data: WorkerListItem[]
    total: number
  }>({
    queryKey: ['director-workers-list'],
    queryFn: async () => {
      const res = await api.get('/worker/list')
      return res.data
    },
    refetchInterval: 12000,
  })

  // 3. Jobs Pool & Oversight Query
  const { data: jobsData, isLoading: loadingJobs, refetch: refetchJobs } = useQuery<{
    data: JobOverview[]
    total: number
  }>({
    queryKey: ['director-jobs-all', jobStatusFilter, jobCategoryFilter, poolTypeFilter],
    queryFn: async () => {
      const params: Record<string, string> = {}
      if (jobStatusFilter !== 'all') params.job_status = jobStatusFilter
      if (jobCategoryFilter !== 'all') params.category = jobCategoryFilter
      if (poolTypeFilter !== 'all') params.pool_type = poolTypeFilter
      const res = await api.get('/worker/jobs/all', { params })
      return res.data
    },
    refetchInterval: 12000,
  })

  // 4. Pending Payouts Query
  const { data: payoutsData, isLoading: loadingPayouts, refetch: refetchPayouts } = useQuery<PayoutRequest[]>({
    queryKey: ['director-pending-payouts'],
    queryFn: async () => {
      const res = await api.get('/worker/payouts/pending')
      const payload = res.data
      return Array.isArray(payload) ? payload : payload?.data || []
    },
    refetchInterval: 10000,
  })

  // Create Worker Mutation
  const createWorkerMutation = useMutation({
    mutationFn: async (phone: string) => {
      const res = await api.post('/worker/create', { phone_number: phone })
      return res.data
    },
    onSuccess: (data) => {
      toast.success('Service Worker created successfully!')
      setCreatedResult(data)
      queryClient.invalidateQueries({ queryKey: ['director-worker-stats'] })
      queryClient.invalidateQueries({ queryKey: ['director-workers-list'] })
    },
    onError: (err) => {
      toast.error(getErrorMessage(err))
    },
  })

  // Approve Payout Mutation
  const approvePayoutMutation = useMutation({
    mutationFn: async (payoutId: string) => {
      const res = await api.post(`/worker/payouts/${payoutId}/approve`)
      return res.data
    },
    onSuccess: () => {
      toast.success('Payout approved and marked paid!')
      queryClient.invalidateQueries({ queryKey: ['director-pending-payouts'] })
      queryClient.invalidateQueries({ queryKey: ['director-workers-list'] })
      queryClient.invalidateQueries({ queryKey: ['director-worker-stats'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })

  // Reject Payout Mutation
  const rejectPayoutMutation = useMutation({
    mutationFn: async ({ payoutId, reason }: { payoutId: string; reason: string }) => {
      const res = await api.post(`/worker/payouts/${payoutId}/reject`, { reason })
      return res.data
    },
    onSuccess: () => {
      toast.success('Payout rejected and refunded to worker balance.')
      setRejectPayoutId(null)
      setRejectReason('')
      queryClient.invalidateQueries({ queryKey: ['director-pending-payouts'] })
      queryClient.invalidateQueries({ queryKey: ['director-workers-list'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })

  const handleCopyInvite = async () => {
    if (!createdResult) return
    await copyToClipboard(createdResult.whatsapp_invite_text)
    setCopiedInvite(true)
    toast.success('WhatsApp invitation copied!')
    setTimeout(() => setCopiedInvite(false), 2000)
  }

  // Filtered workers list
  const filteredWorkers = (workersData?.data || []).filter((w) => {
    const matchesSearch =
      (w.full_name?.toLowerCase().includes(workerSearch.toLowerCase()) ?? false) ||
      w.phone_number.includes(workerSearch) ||
      (w.referral_code?.toLowerCase().includes(workerSearch.toLowerCase()) ?? false)

    if (!matchesSearch) return false
    if (workerFilter === 'free') return !w.is_busy
    if (workerFilter === 'busy') return w.is_busy
    return true
  })

  return (
    <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 pb-24 text-green-950 dark:text-white">
      {/* Header */}
      <header className="sticky top-0 z-30 px-4 py-3 bg-white/80 dark:bg-night-800/80 backdrop-blur-md border-b border-green-100 dark:border-night-700 flex items-center justify-between">
        <div>
          <h1 className="font-black text-lg text-green-950 dark:text-white">
            Service Workers Command
          </h1>
          <p className="text-xs text-green-700 dark:text-night-300">
            Live workforce monitoring & job pool oversight
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              refetchStats()
              refetchWorkers()
              refetchJobs()
              refetchPayouts()
              toast.success('Stats refreshed')
            }}
            className="p-2 rounded-xl border border-green-200 dark:border-night-700 text-green-700 dark:text-night-300 hover:bg-green-50 dark:hover:bg-night-800"
            title="Refresh All"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setIsAddModalOpen(true)
              setCreatedResult(null)
              setNewPhone('')
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-700 hover:bg-green-800 text-white font-bold text-xs shadow-sm transition-transform active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Add Worker</span>
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-5 max-w-4xl mx-auto w-full">
        {/* ── Live Statistics Metric Strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* Free Workers */}
          <div className="p-3 rounded-2xl bg-white dark:bg-night-800 border border-emerald-200 dark:border-emerald-800/60 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700 dark:text-emerald-400">
                Free Workers
              </span>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                {stats?.free_workers ?? 0}
              </span>
              <span className="text-[10px] text-green-600 dark:text-night-400">
                / {stats?.total_workers ?? 0}
              </span>
            </div>
            <p className="text-[9px] text-green-600 dark:text-night-400 mt-0.5">
              Ready to claim
            </p>
          </div>

          {/* Busy Workers */}
          <div className="p-3 rounded-2xl bg-white dark:bg-night-800 border border-amber-200 dark:border-amber-800/60 shadow-sm">
            <span className="text-[10px] uppercase font-bold tracking-wider text-amber-700 dark:text-amber-400">
              Busy Workers
            </span>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-xl font-black font-mono text-amber-600 dark:text-amber-400">
                {stats?.busy_workers ?? 0}
              </span>
              <span className="text-[10px] text-green-600 dark:text-night-400">active</span>
            </div>
            <p className="text-[9px] text-green-600 dark:text-night-400 mt-0.5">
              Handling claims
            </p>
          </div>

          {/* Unattended Job Pool */}
          <div className="p-3 rounded-2xl bg-white dark:bg-night-800 border border-purple-200 dark:border-purple-800/60 shadow-sm">
            <span className="text-[10px] uppercase font-bold tracking-wider text-purple-700 dark:text-purple-400">
              Unattended
            </span>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-xl font-black font-mono text-purple-600 dark:text-purple-400">
                {stats?.unattended_jobs ?? 0}
              </span>
              <span className="text-[10px] text-green-600 dark:text-night-400">in pool</span>
            </div>
            <p className="text-[9px] text-green-600 dark:text-night-400 mt-0.5">
              Awaiting claim
            </p>
          </div>

          {/* Completed Today */}
          <div className="p-3 rounded-2xl bg-white dark:bg-night-800 border border-green-200 dark:border-night-700 shadow-sm">
            <span className="text-[10px] uppercase font-bold tracking-wider text-green-700 dark:text-night-300">
              Completed
            </span>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-xl font-black font-mono text-green-800 dark:text-brand-gold">
                {stats?.completed_today ?? 0}
              </span>
              <span className="text-[10px] text-green-600 dark:text-night-400">today</span>
            </div>
            <p className="text-[9px] text-green-600 dark:text-night-400 mt-0.5">
              Resolved
            </p>
          </div>

          {/* SLA Breaches Today */}
          <div className="p-3 rounded-2xl bg-white dark:bg-night-800 border border-rose-200 dark:border-rose-900/60 shadow-sm">
            <span className="text-[10px] uppercase font-bold tracking-wider text-rose-700 dark:text-rose-400">
              SLA Breaches
            </span>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-xl font-black font-mono text-rose-600 dark:text-rose-400">
                {stats?.sla_breaches_today ?? 0}
              </span>
              <span className="text-[10px] text-rose-500 dark:text-rose-400">reclaimed</span>
            </div>
            <p className="text-[9px] text-rose-600 dark:text-rose-400 mt-0.5">
              Returned to pool
            </p>
          </div>

          {/* Referral Expiries Today */}
          <div className="p-3 rounded-2xl bg-white dark:bg-night-800 border border-indigo-200 dark:border-indigo-900/60 shadow-sm">
            <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-700 dark:text-indigo-400">
              Hold Expiries
            </span>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-xl font-black font-mono text-indigo-600 dark:text-indigo-400">
                {stats?.referral_expiries_today ?? 0}
              </span>
              <span className="text-[10px] text-indigo-500 dark:text-indigo-400">expired</span>
            </div>
            <p className="text-[9px] text-indigo-600 dark:text-indigo-400 mt-0.5">
              Fell back to pool
            </p>
          </div>
        </div>

        {/* ── Main Tab Navigation ── */}
        <div className="grid grid-cols-3 gap-2 p-1 bg-green-100/60 dark:bg-night-800 rounded-2xl">
          <button
            onClick={() => setActiveTab('workers')}
            className={`py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'workers'
                ? 'bg-white dark:bg-night-700 text-green-950 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300'
            }`}
          >
            Workers ({workersData?.total ?? 0})
          </button>
          <button
            onClick={() => setActiveTab('jobs')}
            className={`py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'jobs'
                ? 'bg-white dark:bg-night-700 text-green-950 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300'
            }`}
          >
            Job Oversight ({jobsData?.total ?? 0})
          </button>
          <button
            onClick={() => setActiveTab('payouts')}
            className={`py-2 text-xs font-bold rounded-xl transition-all relative ${
              activeTab === 'payouts'
                ? 'bg-white dark:bg-night-700 text-green-950 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300'
            }`}
          >
            <span>Payouts</span>
            {(payoutsData?.length ?? 0) > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[10px] font-mono">
                {payoutsData?.length}
              </span>
            )}
          </button>
        </div>

        {/* ── Tab 1: Service Workers List ── */}
        {activeTab === 'workers' && (
          <div className="space-y-4">
            {/* Search & Filter Bar */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-3 w-4 h-4 text-green-600 dark:text-night-400" />
                <input
                  type="text"
                  value={workerSearch}
                  onChange={(e) => setWorkerSearch(e.target.value)}
                  placeholder="Search by worker name, phone, or referral code..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-800 text-green-950 dark:text-white text-xs outline-none focus:border-green-600"
                />
              </div>

              <div className="flex items-center gap-1.5">
                {(['all', 'free', 'busy'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setWorkerFilter(filter)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors ${
                      workerFilter === filter
                        ? 'bg-green-800 text-white shadow-sm'
                        : 'bg-white dark:bg-night-800 text-green-800 dark:text-night-300 border border-green-200 dark:border-night-700'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            {/* Workers Cards */}
            {loadingWorkers ? (
              <div className="py-12 text-center text-xs text-green-600 dark:text-night-400">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-green-600" />
                Loading service workers...
              </div>
            ) : filteredWorkers.length === 0 ? (
              <div className="py-12 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 text-xs text-green-600 dark:text-night-400">
                No workers match your filter or search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredWorkers.map((w) => (
                  <div
                    key={w.id}
                    className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-green-950 dark:text-white">
                            {w.full_name || 'Unregistered Name'}
                          </h4>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              w.is_busy
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            }`}
                          >
                            {w.is_busy ? 'Busy (Handling Job)' : 'Free'}
                          </span>
                          {Boolean(w.pending_referred_count && w.pending_referred_count > 0) && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                              {w.pending_referred_count} in referral hold
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-green-700 dark:text-night-300 mt-0.5 flex items-center gap-1.5">
                          <Phone className="w-3 h-3" />
                          <span>{w.phone_number}</span>
                          {w.state_of_residence && (
                            <span className="text-green-500 dark:text-night-400">
                              • {w.state_of_residence}
                            </span>
                          )}
                        </p>
                      </div>

                      {w.referral_code && (
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-green-600 dark:text-night-400 block">
                            Code
                          </span>
                          <span className="font-mono text-xs font-black text-brand-gold-dark dark:text-brand-gold bg-brand-gold/10 px-2 py-0.5 rounded-md border border-brand-gold/20">
                            {w.referral_code}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-green-100 dark:border-night-700 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[11px] text-green-600 dark:text-night-400 block">
                          Commission Balance
                        </span>
                        <span className="font-mono font-bold text-green-950 dark:text-white">
                          {formatNaira(w.commission_balance_kobo)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-green-600 dark:text-night-400 block">
                          Jobs Completed
                        </span>
                        <span className="font-mono font-bold text-green-950 dark:text-white">
                          {w.jobs_completed} jobs
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab 2: Job Oversight & All Requests ── */}
        {activeTab === 'jobs' && (
          <div className="space-y-4">
            {/* Pool Type Filter pills */}
            <div className="flex items-center gap-2">
              {[
                { id: 'all', label: 'All Pools' },
                { id: 'referred', label: 'Referred to Worker' },
                { id: 'open', label: 'Open Pool' },
              ].map((pt) => (
                <button
                  key={pt.id}
                  onClick={() => setPoolTypeFilter(pt.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                    poolTypeFilter === pt.id
                      ? 'bg-purple-800 text-white shadow-sm'
                      : 'bg-white dark:bg-night-800 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-night-700'
                  }`}
                >
                  {pt.label}
                </button>
              ))}
            </div>

            {/* Status Filter pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {['all', 'pending', 'in_progress', 'completed', 'disputed', 'rejected'].map((st) => (
                <button
                  key={st}
                  onClick={() => setJobStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase whitespace-nowrap transition-colors ${
                    jobStatusFilter === st
                      ? 'bg-green-800 text-white shadow-sm'
                      : 'bg-white dark:bg-night-800 text-green-800 dark:text-night-300 border border-green-200 dark:border-night-700'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>

            {/* Category Filter pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {[
                { id: 'all', label: 'All Categories' },
                { id: 'nin_modification', label: 'NIN Modification' },
                { id: 'nin_validation', label: 'NIN Validation' },
                { id: 'bvn_modification', label: 'BVN Mod' },
                { id: 'bvn_retrieval', label: 'BVN Retrieval' },
                { id: 'tin_registration', label: 'TIN' },
                { id: 'cac', label: 'CAC' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setJobCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    jobCategoryFilter === cat.id
                      ? 'bg-brand-gold text-green-950 font-bold'
                      : 'bg-green-50/60 dark:bg-night-800 text-green-700 dark:text-night-300 border border-green-100 dark:border-night-700'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {loadingJobs ? (
              <div className="py-12 text-center text-xs text-green-600 dark:text-night-400">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-green-600" />
                Loading jobs oversight...
              </div>
            ) : !jobsData?.data || jobsData.data.length === 0 ? (
              <div className="py-12 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 text-xs text-green-600 dark:text-night-400">
                No jobs found under this status filter.
              </div>
            ) : (
              <div className="space-y-3">
                {jobsData.data.map((job) => (
                  <div
                    key={job.id}
                    className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm space-y-2.5"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-green-50 dark:bg-night-900 border border-green-200 dark:border-night-700 text-green-700 dark:text-night-300">
                            {formatServiceCategory(job.service_category)}
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              job.dispute_id
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                                : job.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : job.status === 'in_progress'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-800 dark:bg-night-700 dark:text-night-300'
                            }`}
                          >
                            {job.dispute_id ? `Disputed: ${job.dispute_status || 'active'}` : job.status.replace('_', ' ')}
                          </span>
                          {job.referred_worker_name && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                              Referred: {job.referred_worker_name}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-sm text-green-950 dark:text-white mt-1">
                          {formatServiceType(job.service_type || job.service_category)}
                        </h4>
                        {job.customer_name && (
                          <p className="text-xs text-green-700 dark:text-night-300">
                            Customer: {job.customer_name}
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-green-600 dark:text-night-400 block">
                          Fee
                        </span>
                        <span className="font-mono text-xs font-bold text-green-950 dark:text-white">
                          {formatNaira(job.price_kobo)}
                        </span>
                      </div>
                    </div>

                    {job.dispute_id && (
                      <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-xl p-2.5 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-purple-900 dark:text-purple-200 block">
                            Dispute #{job.dispute_id.slice(0, 8)} · Status: <span className="uppercase">{job.dispute_status || 'Open'}</span>
                          </span>
                          {job.commission_held_kobo ? (
                            <span className="text-[11px] text-purple-700 dark:text-purple-300">
                              Commission held: {formatNaira(job.commission_held_kobo)}
                            </span>
                          ) : null}
                        </div>
                        <button
                          onClick={() => navigate(`/disputes/${job.dispute_id}`)}
                          className="bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs px-3 py-1.5 rounded-lg active:scale-95 transition-all shadow-sm flex items-center gap-1"
                        >
                          <span>Open Dispute</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="pt-2 border-t border-green-100 dark:border-night-700 flex items-center justify-between text-xs text-green-700 dark:text-night-400">
                      <div>
                        {job.worker_name ? (
                          <span>Assigned Worker: <strong className="text-green-950 dark:text-white">{job.worker_name}</strong></span>
                        ) : (
                          <span className="text-purple-600 dark:text-purple-400 font-semibold">Unclaimed in pool</span>
                        )}
                      </div>

                      {job.worker_result_file_url && (
                        <a
                          href={job.worker_result_file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold text-green-700 dark:text-brand-gold hover:underline flex items-center gap-1"
                        >
                          <span>View Result</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab 3: Payout Approvals ── */}
        {activeTab === 'payouts' && (
          <div className="space-y-4">
            {loadingPayouts ? (
              <div className="py-12 text-center text-xs text-green-600 dark:text-night-400">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-green-600" />
                Loading payout requests...
              </div>
            ) : (!Array.isArray(payoutsData) || payoutsData.length === 0) ? (
              <div className="py-12 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 text-xs text-green-600 dark:text-night-400">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                No pending payout requests from service workers.
              </div>
            ) : (
              <div className="space-y-3">
                {(Array.isArray(payoutsData) ? payoutsData : []).map((p) => (
                  <div
                    key={p.id}
                    className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-green-950 dark:text-white">
                          {p.worker_name || 'Worker'}
                        </h4>
                        <p className="text-xs text-green-700 dark:text-night-400">
                          {p.worker_phone}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-green-600 dark:text-night-400 block">
                          Requested Amount
                        </span>
                        <span className="font-mono text-base font-black text-green-950 dark:text-white">
                          {formatNaira(p.amount_kobo)}
                        </span>
                      </div>
                    </div>

                    <div className="p-2.5 bg-green-50 dark:bg-night-900 rounded-xl text-xs space-y-0.5">
                      <div className="flex justify-between">
                        <span className="text-green-700 dark:text-night-400">Bank:</span>
                        <span className="font-bold text-green-950 dark:text-white">{p.bank_name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-green-700 dark:text-night-400">Account Number:</span>
                        <span className="font-mono font-bold text-green-950 dark:text-white">{p.account_number}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-green-700 dark:text-night-400">Account Name:</span>
                        <span className="font-bold text-green-950 dark:text-white">{p.account_name}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-2 border-t border-green-100 dark:border-night-700 flex gap-2">
                      <button
                        onClick={() => {
                          setRejectPayoutId(p.id)
                          setRejectReason('')
                        }}
                        disabled={rejectPayoutMutation.isPending}
                        className="flex-1 py-2 px-3 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 font-bold text-xs hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => approvePayoutMutation.mutate(p.id)}
                        disabled={approvePayoutMutation.isPending}
                        className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve & Mark Paid</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Add Worker Modal ── */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-3xl w-full max-w-md p-6 space-y-4 border border-green-100 dark:border-night-700 shadow-2xl"
            >
              <div className="flex items-center justify-between pb-2 border-b border-green-100 dark:border-night-700">
                <h3 className="font-black text-base text-green-950 dark:text-white">
                  Add New Service Worker
                </h3>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-green-100 dark:bg-night-700 flex items-center justify-center text-green-700 dark:text-night-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!createdResult ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (newPhone.trim().length >= 10) {
                      createWorkerMutation.mutate(newPhone.trim())
                    }
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-xs font-bold text-green-900 dark:text-night-200 mb-1">
                      Worker Phone Number *
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-3.5 w-4 h-4 text-green-600 dark:text-night-400" />
                      <input
                        type="tel"
                        required
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value.replace(/\s+/g, ''))}
                        placeholder="e.g. 08012345678"
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-900 text-green-950 dark:text-white text-sm font-mono outline-none focus:border-green-600"
                      />
                    </div>
                    <p className="text-[11px] text-green-600 dark:text-night-400 mt-1">
                      Initial password will automatically be set to <code className="font-mono font-bold text-green-800 dark:text-brand-gold">&#123;phone&#125;MK</code>
                    </p>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsAddModalOpen(false)}
                      className="flex-1 py-3 rounded-xl border border-green-200 dark:border-night-700 text-green-800 dark:text-night-300 font-bold text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={createWorkerMutation.isPending || newPhone.trim().length < 10}
                      className="flex-1 py-3 rounded-xl bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-bold text-xs shadow-md transition-all active:scale-[0.99] flex items-center justify-center gap-2"
                    >
                      {createWorkerMutation.isPending ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <span>Generate & Add</span>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs space-y-1">
                    <p className="font-bold text-emerald-800 dark:text-emerald-200">
                      ✓ Worker Account Created!
                    </p>
                    <p className="text-emerald-700 dark:text-emerald-300">
                      Phone: <span className="font-mono font-bold">{createdResult.worker.phone_number}</span>
                    </p>
                    <p className="text-emerald-700 dark:text-emerald-300">
                      Temporary Password: <span className="font-mono font-bold">{createdResult.default_password}</span>
                    </p>
                    <p className="text-emerald-700 dark:text-emerald-300">
                      Referral Code: <span className="font-mono font-bold">{createdResult.worker.referral_code}</span>
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-green-900 dark:text-night-200 mb-1">
                      WhatsApp Invitation Message:
                    </label>
                    <textarea
                      readOnly
                      rows={5}
                      value={createdResult.whatsapp_invite_text}
                      className="w-full p-3 rounded-xl border border-green-200 dark:border-night-700 bg-green-50/50 dark:bg-night-900 text-green-950 dark:text-white text-xs font-mono outline-none"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleCopyInvite}
                      className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all active:scale-[0.99] flex items-center justify-center gap-2"
                    >
                      {copiedInvite ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>{copiedInvite ? 'Copied to Clipboard!' : 'Copy WhatsApp Invite'}</span>
                    </button>
                    <button
                      onClick={() => setIsAddModalOpen(false)}
                      className="px-4 py-3 rounded-xl border border-green-200 dark:border-night-700 text-green-800 dark:text-night-300 font-bold text-xs"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Reject Payout Reason Modal ── */}
      <AnimatePresence>
        {rejectPayoutId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-3xl w-full max-w-sm p-5 space-y-3 border border-green-100 dark:border-night-700 shadow-xl"
            >
              <h3 className="font-bold text-sm text-green-950 dark:text-white">
                Reason for Rejecting Payout
              </h3>
              <textarea
                rows={3}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Account name mismatch or suspicious activity"
                className="w-full p-3 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-900 text-green-950 dark:text-white text-xs outline-none focus:border-rose-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRejectPayoutId(null)}
                  className="flex-1 py-2.5 rounded-xl border border-green-200 dark:border-night-700 text-xs font-bold text-green-800 dark:text-night-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!rejectReason.trim() || rejectPayoutMutation.isPending}
                  onClick={() =>
                    rejectPayoutMutation.mutate({
                      payoutId: rejectPayoutId,
                      reason: rejectReason.trim(),
                    })
                  }
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md"
                >
                  Confirm Reject
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
