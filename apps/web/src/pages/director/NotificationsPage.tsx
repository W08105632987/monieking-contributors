import { useState, useEffect } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell, CheckCheck, Wallet, CreditCard,
  ArrowUpRight, Megaphone, AlertCircle, Info, X, Clock,
} from 'lucide-react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useNotificationsStore } from '@/store/notifications.store'
import { BottomNav } from '@/components/layout/BottomNav'
import { timeAgo, formatDateTime, groupByDateBucket } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { AppNotification } from '@/types'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

// ── Icon per notification type ────────────────────────────────────
function NotifIcon({ type, title }: { type: string; title: string }) {
  const isWallet     = title.toLowerCase().includes('wallet') || title.toLowerCase().includes('fund')
  const isWithdrawal = title.toLowerCase().includes('withdrawal')
  const isCard       = title.toLowerCase().includes('card')
  const isBroadcast  = type === 'broadcast'

  const Icon = isWallet     ? Wallet
    : isWithdrawal          ? ArrowUpRight
    : isCard                ? CreditCard
    : isBroadcast           ? Megaphone
    : type === 'success'    ? CheckCheck
    : type === 'error'      ? AlertCircle
    : Info

  const colors: Record<string, string> = {
    success:   'bg-green-100 text-green-600',
    error:     'bg-red-50 text-red-400',
    warning:   'bg-amber-50 text-amber-500',
    broadcast: 'bg-blue-50 text-blue-500',
    info:      'bg-green-50 text-green-500',
  }

  return (
    <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0', colors[type] ?? colors.info)}>
      <Icon className="w-5 h-5" />
    </div>
  )
}

// ── Single notification item ──────────────────────────────────────
function NotifItem({ notif, onOpen }: { notif: AppNotification; onOpen: (notif: AppNotification) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      onClick={() => onOpen(notif)}
      className={cn(
        'flex items-start gap-3 p-4 rounded-2xl mb-2 cursor-pointer transition-all active:scale-99',
        notif.is_read
          ? 'bg-white dark:bg-night-700 border border-green-100 dark:border-night-600'
          : 'bg-green-50 dark:bg-night-600 border border-green-200 dark:border-night-500',
      )}
    >
      <NotifIcon type={notif.type} title={notif.title} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={cn('text-sm leading-tight truncate', notif.is_read ? 'text-green-700 dark:text-night-100 font-medium' : 'text-green-900 dark:text-white font-bold')}>
            {notif.title}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-green-400 dark:text-night-300 text-xs whitespace-nowrap">{timeAgo(notif.created_at)}</span>
            {!notif.is_read && (
              <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
            )}
          </div>
        </div>
        <p className="text-green-500 dark:text-night-200 text-xs leading-relaxed mt-0.5 truncate">{notif.body}</p>
      </div>
    </motion.div>
  )
}

// ── Notification detail sheet ───────────────────────────────────────
function NotifDetailSheet({ notif, onClose }: { notif: AppNotification; onClose: () => void }) {
  const typeLabel: Record<string, string> = {
    success: 'Success', error: 'Error', warning: 'Warning', broadcast: 'Announcement', info: 'Info',
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 22, stiffness: 260, mass: 0.9 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        <button onClick={onClose} className="absolute top-5 right-5 w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center text-green-700 dark:text-night-100">
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center text-center mb-6 pt-2">
          <div className="mb-3">
            <NotifIcon type={notif.type} title={notif.title} />
          </div>
          <p className="text-green-900 dark:text-white font-extrabold text-lg leading-snug">{notif.title}</p>
          <p className="text-green-500 dark:text-night-200 text-xs font-semibold mt-1">{typeLabel[notif.type] ?? 'Info'}</p>
        </div>

        <div className="bg-green-50 dark:bg-night-800 rounded-2xl p-4 mb-4">
          <p className="text-green-900 dark:text-white text-sm leading-relaxed">{notif.body}</p>
        </div>

        <div className="flex items-center gap-1.5 text-green-400 dark:text-night-300 text-xs">
          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
          {formatDateTime(notif.created_at)}
        </div>
      </motion.div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function DirectorNotificationsPage() {
  const navigate  = useNavigate()
  const { user }  = useAuthStore()
  const { setNotifications, markRead, markAllRead, unreadCount } = useNotificationsStore()
  const qc = useQueryClient()
  const [selectedNotif, setSelectedNotif] = useState<AppNotification | null>(null)

  const PAGE_SIZE = 30
  const {
    data: pages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['notifications'],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<AppNotification[]>('/notifications', {
        params: { page: pageParam, page_size: PAGE_SIZE },
      })
      return data
    },
    getNextPageParam: (lastPage, allPages) => lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined,
  })

  const notifications = pages?.pages.flat() ?? []
  useEffect(() => { setNotifications(notifications) }, [notifications.length])

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onMutate: (id) => {
      markRead(id)   // updates the Zustand store — this is what the bell badge reads, so it goes instant
      // The message list itself renders straight from THIS query's cache
      // (pages?.pages.flat() below), not from the Zustand store — so
      // marking it read there alone left the visible yellow dot stale
      // until invalidateQueries' refetch completed, "some seconds" later.
      // Writing directly into the query cache here makes the list item
      // update in the same instant as the badge.
      qc.setQueryData<{ pages: AppNotification[][] } | undefined>(['notifications'], (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) =>
            page.map((n) => (n.id === id ? { ...n, is_read: true } : n))
          ),
        }
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) => {
      // The tap already marked it read optimistically (onMutate above) —
      // if the server call actually failed, that local state is now
      // wrong. Re-fetch to correct it, and actually tell the person,
      // instead of silently leaving it looking read when it isn't.
      qc.invalidateQueries({ queryKey: ['notifications'] })
      toast.error(getErrorMessage(err))
    },
  })

  const markAllMutation = useMutation({
    mutationFn: () => api.patch('/notifications/mark-all-read'),
    onMutate: () => {
      markAllRead()
      qc.setQueryData<{ pages: AppNotification[][] } | undefined>(['notifications'], (old) => {
        if (!old) return old
        return { ...old, pages: old.pages.map((page) => page.map((n) => ({ ...n, is_read: true }))) }
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      toast.error(getErrorMessage(err))
    },
  })

  const handleOpen = (notif: AppNotification) => {
    if (!notif.is_read) markReadMutation.mutate(notif.id)
    setSelectedNotif(notif)
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <BrandBlobLogo height={36} />
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold bg-green-900 text-amber-400 px-2.5 py-1 rounded-full">Director</span>
          <button onClick={() => navigate('/director/profile')} className="rounded-full shadow-card">
          <Avatar name={user?.full_name ?? 'D'} avatarUrl={user?.avatar_url} size={40} />
        </button>
        </div>
      </header>

      {/* Page title */}
      <div className="px-4 mt-2 mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-green-900 dark:text-white text-2xl font-extrabold">Notifications</h1>
            {unreadCount > 0 && (
              <span className="bg-amber-400 text-green-900 text-xs font-extrabold px-2 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-green-500 dark:text-night-200 text-sm mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllMutation.mutate()}
            className="flex items-center gap-1.5 text-green-600 dark:text-night-100 text-xs font-bold bg-green-100 dark:bg-night-600 px-3 py-2 rounded-full active:scale-95 transition-all"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all read
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-40">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 flex gap-3">
                <div className="w-10 h-10 bg-green-100 dark:bg-night-600 rounded-2xl animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-green-100 dark:bg-night-600 rounded animate-pulse w-3/4" />
                  <div className="h-2 bg-green-50 dark:bg-night-500 rounded animate-pulse w-full" />
                  <div className="h-2 bg-green-50 dark:bg-night-500 rounded animate-pulse w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-night-700 rounded-3xl border border-green-100 dark:border-night-600 shadow-card text-center py-16 px-6 mt-4"
          >
            <div className="w-16 h-16 bg-green-50 dark:bg-night-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Bell className="w-8 h-8 text-green-300 dark:text-night-300" />
            </div>
            <p className="text-green-900 dark:text-white font-bold text-lg">No notifications yet</p>
            <p className="text-green-400 dark:text-night-300 text-sm mt-1 leading-relaxed">
              You'll receive updates here about contributions, withdrawals, and announcements.
            </p>
          </motion.div>
        ) : (
          <>
            {groupByDateBucket(notifications, n => n.created_at).map(group => (
              <div key={group.label} className="mb-4">
                <p className="text-green-400 dark:text-night-300 text-xs font-bold uppercase tracking-widest mb-2 px-1">{group.label}</p>
                <AnimatePresence>
                  {group.items.map(n => (
                    <NotifItem key={n.id} notif={n} onOpen={handleOpen} />
                  ))}
                </AnimatePresence>
              </div>
            ))}

            {hasNextPage && (
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full py-3 mb-4 text-green-600 dark:text-night-200 font-bold text-sm border-2 border-green-100 dark:border-night-600 rounded-xl disabled:opacity-60"
              >
                {isFetchingNextPage ? 'Loading...' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>

      <BottomNav />

      <AnimatePresence>
        {selectedNotif && <NotifDetailSheet notif={selectedNotif} onClose={() => setSelectedNotif(null)} />}
      </AnimatePresence>
    </div>
  )
}