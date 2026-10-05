import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Bell, Edit3, Check, X, Archive, Package, Users, Plus, EyeOff, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'
import { FallbackError } from '@/components/ui/FallbackError'

interface OversightRow {
  id: string
  customer_id: string
  customer_name: string | null
  zone_name: string | null
  status: 'active' | 'used' | 'revoked' | 'expired'
  collected_at: string | null
  confirmed_by: string | null
}

interface PkgItem { id: string; name: string; icon: string | null; is_active: boolean }

interface Stats {
  total_qualified: number
  total_collected: number
  total_not_collected: number
  by_zone: { zone_name: string; collected: number }[]
  by_officer: { officer_name: string; collected: number }[]
}

const STATUS_LABEL: Record<string, string> = { active: 'Not collected', used: 'Collected', revoked: 'Revoked', expired: 'Expired' }
const STATUS_COLOR: Record<string, string> = {
  active: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  used: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  revoked: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
  expired: 'bg-gray-100 text-gray-600 dark:bg-night-600 dark:text-night-300',
}

export default function FoodOversightPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'all' | 'collected' | 'not_collected'>('all')
  const [editingAnnouncement, setEditingAnnouncement] = useState(false)
  const [announcementDraft, setAnnouncementDraft] = useState('')
  const [showPackageItems, setShowPackageItems] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [newItemIcon, setNewItemIcon] = useState('')

  const { data: stats } = useQuery({
    queryKey: ['food-oversight-stats'],
    queryFn: async () => (await api.get<Stats>('/food-collections/oversight/stats')).data,
  })

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['food-oversight', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = { page: '1', page_size: '50' }
      if (statusFilter !== 'all') params.status = statusFilter
      const { data } = await api.get<{ items: OversightRow[]; total: number }>('/food-collections/oversight', { params })
      return data
    },
  })

  const { data: announcement } = useQuery({
    queryKey: ['food-announcement'],
    queryFn: async () => (await api.get<{ text: string }>('/food-collections/announcement')).data,
  })

  const { data: packageItems } = useQuery({
    queryKey: ['food-package-items-all-director'],
    queryFn: async () => (await api.get<PkgItem[]>('/food-collections/package-items', { params: { active_only: false } })).data,
    enabled: showPackageItems,
  })

  const addItemMutation = useMutation({
    mutationFn: () => api.post('/food-collections/package-items', { name: newItemName, icon: newItemIcon || null }),
    onSuccess: () => {
      setNewItemName(''); setNewItemIcon('')
      qc.invalidateQueries({ queryKey: ['food-package-items-all-director'] })
      toast.success('Item added')
    },
    onError: () => toast.error('Could not add item'),
  })

  const toggleItemMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/food-collections/package-items/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['food-package-items-all-director'] }),
    onError: () => toast.error('Could not update item'),
  })

  const pingMutation = useMutation({
    mutationFn: (customerId: string) => api.post(`/food-collections/oversight/${customerId}/ping`),
    onSuccess: () => toast.success('Reminder sent'),
    onError: () => toast.error('Could not send reminder'),
  })

  const saveAnnouncementMutation = useMutation({
    mutationFn: (text: string) => api.patch('/food-collections/announcement', { text }),
    onSuccess: () => {
      toast.success('Announcement updated')
      setEditingAnnouncement(false)
      qc.invalidateQueries({ queryKey: ['food-announcement'] })
    },
    onError: () => toast.error('Could not save announcement'),
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg flex-1">Food Collection Oversight</h1>
        <button
          onClick={() => navigate('/director/food/archives')}
          className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all"
          title="Past closed years"
        >
          <Archive className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav space-y-4">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-2.5">
            <StatCard label="Qualified" value={stats.total_qualified} />
            <StatCard label="Collected" value={stats.total_collected} accent="text-green-700 dark:text-green-400" />
            <StatCard label="Not yet" value={stats.total_not_collected} accent="text-amber-600 dark:text-amber-400" />
          </div>
        )}

        {/* Announcement template */}
        <div className="bg-white dark:bg-night-700 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-green-900 dark:text-white font-bold text-sm">Distribution Announcement</p>
            {!editingAnnouncement && (
              <button
                onClick={() => { setAnnouncementDraft(announcement?.text || ''); setEditingAnnouncement(true) }}
                className="text-green-600 dark:text-night-200"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            )}
          </div>
          {editingAnnouncement ? (
            <div className="space-y-2">
              <textarea
                value={announcementDraft}
                onChange={e => setAnnouncementDraft(e.target.value)}
                rows={4}
                className="w-full bg-green-50 dark:bg-night-600 rounded-xl p-3 text-sm text-green-900 dark:text-white resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveAnnouncementMutation.mutate(announcementDraft)}
                  disabled={saveAnnouncementMutation.isPending}
                  className="flex-1 bg-green-800 text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
                <button
                  onClick={() => setEditingAnnouncement(false)}
                  className="flex-1 bg-green-50 dark:bg-night-600 text-green-700 dark:text-night-200 text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-green-600 dark:text-night-200 text-xs leading-relaxed">{announcement?.text}</p>
          )}
        </div>

        {/* Package items management */}
        <div className="bg-white dark:bg-night-700 rounded-2xl p-4">
          <button onClick={() => setShowPackageItems(s => !s)} className="w-full flex items-center justify-between">
            <span className="text-green-900 dark:text-white font-bold text-sm flex items-center gap-2">
              <Package className="w-4 h-4" /> Package Items
            </span>
            {showPackageItems ? <Eye className="w-4 h-4 text-green-400" /> : <EyeOff className="w-4 h-4 text-green-400" />}
          </button>
          {showPackageItems && (
            <div className="mt-3 space-y-2">
              {(packageItems || []).map(item => (
                <div key={item.id} className="flex items-center justify-between gap-2 bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2">
                  <span className={cn('text-sm flex items-center gap-2', !item.is_active && 'opacity-40 line-through')}>
                    <span>{item.icon || '🍽️'}</span>
                    <span className="text-green-900 dark:text-white font-semibold">{item.name}</span>
                  </span>
                  <button
                    onClick={() => toggleItemMutation.mutate({ id: item.id, is_active: !item.is_active })}
                    className="text-green-500 dark:text-night-200 text-xs font-bold shrink-0"
                  >
                    {item.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <input
                  value={newItemIcon}
                  onChange={e => setNewItemIcon(e.target.value)}
                  placeholder="🍚"
                  className="w-12 bg-green-50 dark:bg-night-600 rounded-lg px-2 py-2 text-sm text-center"
                />
                <input
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  placeholder="New item name"
                  className="flex-1 bg-green-50 dark:bg-night-600 rounded-lg px-3 py-2 text-sm text-green-900 dark:text-white"
                />
                <button
                  onClick={() => newItemName.trim() && addItemMutation.mutate()}
                  disabled={!newItemName.trim() || addItemMutation.isPending}
                  className="w-9 h-9 bg-green-800 text-white rounded-lg flex items-center justify-center shrink-0 disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          {(['all', 'not_collected', 'collected'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                'flex-1 py-2 rounded-xl text-xs font-bold transition-all',
                statusFilter === f ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900' : 'bg-white dark:bg-night-700 text-green-600 dark:text-night-200',
              )}
            >
              {f === 'all' ? 'All' : f === 'not_collected' ? 'Not collected' : 'Collected'}
            </button>
          ))}
        </div>

        {/* Table */}
        {isError ? (
          <FallbackError title="Couldn't load the oversight list" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading ? (
          <div className="space-y-2.5">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl p-8 text-center">
            <Users className="w-10 h-10 text-green-200 dark:text-night-500 mx-auto mb-2" />
            <p className="text-green-500 dark:text-night-200 text-sm font-semibold">No qualified contributors yet this cycle</p>
          </div>
        ) : (
          <div className="space-y-2 pb-4">
            {data.items.map(row => (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-night-700 rounded-2xl p-3.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-green-900 dark:text-white font-bold text-sm truncate">{row.customer_name}</p>
                    {row.zone_name && <span className="shrink-0 text-[10px] text-green-400 dark:text-night-300">{row.zone_name}</span>}
                  </div>
                  <span className={cn('inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold', STATUS_COLOR[row.status])}>
                    {STATUS_LABEL[row.status]}
                  </span>
                  {row.collected_at && <p className="text-green-300 dark:text-night-400 text-[10px] mt-1">{formatDateTime(row.collected_at)} · {row.confirmed_by}</p>}
                </div>
                {row.status === 'active' && (
                  <button
                    onClick={() => pingMutation.mutate(row.customer_id)}
                    disabled={pingMutation.isPending}
                    className="shrink-0 w-9 h-9 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-xl flex items-center justify-center active:scale-95 transition-all"
                    title="Send reminder"
                  >
                    <Bell className="w-4 h-4" />
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* Close year action */}
        <button
          onClick={() => navigate('/director/food/close-year')}
          className="w-full flex items-center justify-center gap-2 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm py-3.5 rounded-xl active:scale-95 transition-all mb-4"
        >
          <Package className="w-4 h-4" /> Close This Year's Distribution
        </button>
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl p-3 text-center">
      <p className={cn('text-xl font-extrabold', accent || 'text-green-900 dark:text-white')}>{value}</p>
      <p className="text-green-400 dark:text-night-300 text-[10px] font-semibold mt-0.5">{label}</p>
    </div>
  )
}
