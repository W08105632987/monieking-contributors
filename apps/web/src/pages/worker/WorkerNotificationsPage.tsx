import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Bell, CheckCheck, Wallet,
  Megaphone, Info, X, Clock,
  Briefcase, ShieldAlert, CheckCircle2
} from 'lucide-react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { useNotificationsStore } from '@/store/notifications.store'
import { WorkerHeader } from '@/components/worker/WorkerHeader'
import { formatDateTime, cn } from '@/lib/utils'
import type { AppNotification } from '@/types'

function NotifIcon({ type, title }: { type: string; title: string }) {
  const lower = title.toLowerCase()
  const isJob = lower.includes('job') || lower.includes('claim') || lower.includes('assigned')
  const isDispute = lower.includes('dispute') || lower.includes('rejected') || lower.includes('failed')
  const isEarnings = lower.includes('earning') || lower.includes('commission') || lower.includes('payout') || lower.includes('paid')
  const isBroadcast = type === 'broadcast' || lower.includes('broadcast') || lower.includes('announcement')

  if (isDispute) {
    return (
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400">
        <ShieldAlert className="w-5 h-5" />
      </div>
    )
  }
  if (isEarnings) {
    return (
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
        <Wallet className="w-5 h-5" />
      </div>
    )
  }
  if (isJob) {
    return (
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300">
        <Briefcase className="w-5 h-5" />
      </div>
    )
  }
  if (isBroadcast) {
    return (
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300">
        <Megaphone className="w-5 h-5" />
      </div>
    )
  }
  if (type === 'success') {
    return (
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-300">
        <CheckCircle2 className="w-5 h-5" />
      </div>
    )
  }
  return (
    <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 bg-green-50 dark:bg-night-700 text-green-700 dark:text-night-200">
      <Info className="w-5 h-5" />
    </div>
  )
}

export default function WorkerNotificationsPage() {
  const navigate = useNavigate()
  const { setNotifications, markRead, markAllRead, unreadCount } = useNotificationsStore()
  const qc = useQueryClient()
  const [selectedNotif, setSelectedNotif] = useState<AppNotification | null>(null)
  const [tab, setTab] = useState<'all' | 'jobs' | 'disputes' | 'earnings' | 'broadcasts'>('all')

  const PAGE_SIZE = 30
  const {
    data: pages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['worker-notifications'],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<AppNotification[]>('/notifications', {
        params: { page: pageParam, page_size: PAGE_SIZE },
      })
      return data
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined,
  })

  const notifications = pages?.pages.flat() ?? []

  useEffect(() => {
    setNotifications(notifications)
  }, [notifications.length, setNotifications])

  const markAllMutation = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => {
      markAllRead()
      qc.invalidateQueries({ queryKey: ['worker-notifications'] })
      toast.success('All marked as read')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const markOneMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: (_, id) => {
      markRead(id)
      qc.invalidateQueries({ queryKey: ['worker-notifications'] })
    },
  })

  const handleOpenNotif = (notif: AppNotification) => {
    setSelectedNotif(notif)
    if (!notif.is_read) {
      markOneMutation.mutate(notif.id)
    }
  }

  // Filter based on tab
  const filteredNotifs = notifications.filter((n) => {
    const text = (n.title + ' ' + n.body).toLowerCase()
    if (tab === 'jobs') {
      return text.includes('job') || text.includes('service') || text.includes('assigned') || text.includes('completed')
    }
    if (tab === 'disputes') {
      return text.includes('dispute') || text.includes('rejected') || text.includes('failed')
    }
    if (tab === 'earnings') {
      return text.includes('earning') || text.includes('payout') || text.includes('commission') || text.includes('paid')
    }
    if (tab === 'broadcasts') {
      return n.type === 'broadcast' || text.includes('broadcast') || text.includes('announcement') || text.includes('director')
    }
    return true
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <WorkerHeader title="Notifications" subtitle="Job updates, disputes & payouts" />

      <main className="flex-1 px-4 py-4 max-w-lg mx-auto w-full pb-safe-nav">
        {/* Header Actions */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 rounded-xl bg-white dark:bg-night-700 border border-green-100 dark:border-night-600 flex items-center justify-center text-green-900 dark:text-white"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-lg font-black text-green-950 dark:text-white">
              Notification Center
            </h1>
          </div>

          {unreadCount > 0 && (
            <button
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
              className="text-xs font-bold text-green-700 dark:text-amber-400 hover:underline flex items-center gap-1"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </div>

        {/* Tab Filters */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-3">
          {[
            { id: 'all', label: 'All' },
            { id: 'jobs', label: 'Jobs' },
            { id: 'disputes', label: 'Disputes' },
            { id: 'earnings', label: 'Earnings' },
            { id: 'broadcasts', label: 'Broadcasts' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={cn(
                'px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors',
                tab === t.id
                  ? 'bg-green-700 text-white dark:bg-copper-500 shadow-sm'
                  : 'bg-white dark:bg-night-700 text-green-800 dark:text-night-200 border border-green-100 dark:border-night-600 hover:border-green-300'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* List of Notifications */}
        {isLoading ? (
          <div className="space-y-2 mt-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filteredNotifs.length === 0 ? (
          <div className="text-center py-16 px-4 bg-white/60 dark:bg-night-700/60 rounded-3xl border border-green-100 dark:border-night-600 mt-2">
            <div className="w-12 h-12 rounded-2xl bg-green-100 dark:bg-night-600 flex items-center justify-center mx-auto mb-3 text-green-800 dark:text-night-200">
              <Bell className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-green-950 dark:text-white">No notifications yet</p>
            <p className="text-xs text-green-600 dark:text-night-300 mt-1 max-w-xs mx-auto">
              Completed jobs, payout updates, disputes, and Director broadcasts will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredNotifs.map((notif) => (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => handleOpenNotif(notif)}
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-2xl cursor-pointer transition-all active:scale-[0.99] border',
                  notif.is_read
                    ? 'bg-white dark:bg-night-700 border-green-100 dark:border-night-600 shadow-sm'
                    : 'bg-green-50/90 dark:bg-night-600 border-green-300 dark:border-copper-500/50 shadow-md ring-1 ring-green-400/20'
                )}
              >
                <NotifIcon type={notif.type} title={notif.title} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        'text-xs leading-tight truncate',
                        notif.is_read
                          ? 'text-green-950 dark:text-white font-semibold'
                          : 'text-green-950 dark:text-white font-black'
                      )}
                    >
                      {notif.title}
                    </p>
                    {!notif.is_read && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 mt-1" />
                    )}
                  </div>
                  <p className="text-xs text-green-700 dark:text-night-200 line-clamp-2 mt-1">
                    {notif.body}
                  </p>
                  <p className="text-[10px] text-green-500 dark:text-night-400 mt-1.5 flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3" />
                    {formatDateTime(notif.created_at)}
                  </p>
                </div>
              </motion.div>
            ))}

            {hasNextPage && (
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full py-2.5 mt-2 bg-white dark:bg-night-700 border border-green-200 dark:border-night-600 rounded-xl text-xs font-bold text-green-800 dark:text-night-100"
              >
                {isFetchingNextPage ? 'Loading more…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </main>

      {/* Notification Detail Modal */}
      <AnimatePresence>
        {selectedNotif && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedNotif(null)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 24, stiffness: 260 }}
              className="bg-white dark:bg-night-800 rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-5 pb-8 max-h-[85vh] overflow-y-auto border border-green-100 dark:border-night-600 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-green-200 dark:bg-night-600 rounded-full mx-auto mb-4" />
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <NotifIcon type={selectedNotif.type} title={selectedNotif.title} />
                  <div>
                    <h3 className="text-sm font-black text-green-950 dark:text-white leading-tight">
                      {selectedNotif.title}
                    </h3>
                    <p className="text-[10px] text-green-600 dark:text-night-300 mt-0.5">
                      {formatDateTime(selectedNotif.created_at)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNotif(null)}
                  className="w-8 h-8 rounded-full bg-green-50 dark:bg-night-700 flex items-center justify-center text-green-800 dark:text-night-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-green-50/60 dark:bg-night-700/60 rounded-2xl p-4 border border-green-100 dark:border-night-600 text-xs text-green-900 dark:text-night-100 leading-relaxed whitespace-pre-wrap">
                {selectedNotif.body}
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setSelectedNotif(null)}
                  className="flex-1 py-2.5 bg-green-700 dark:bg-copper-500 text-white text-xs font-bold rounded-xl shadow"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
