import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Clock, Pencil, Ban, MapPin, Plus, Trash2, Users, Calendar } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatDate, nairaToKobo, koboToNaira } from '@/lib/utils'
import type { SystemConfigItem, PendingRateChange, RateChangePreview, Zone } from '@/types'

const DEFERRED_KEYS = new Set(['food_card_rate_kobo'])
const MONTHLY_KEYS  = new Set(['monthly_sms_fee_kobo'])
const DATE_KEYS     = new Set(['food_card_open_from', 'food_card_open_until'])
const SW_KEYS       = new Set(['service_worker_job_timeout_minutes', 'service_worker_referral_hold_minutes', 'service_worker_default_commission_percent'])

const KEY_LABELS: Record<string, string> = {
  food_card_rate_kobo:                 'Food Card daily rate',
  wallet_instant_withdrawal_fee_kobo:  'Wallet instant withdrawal fee',
  max_instant_withdrawal_kobo:         'Max instant withdrawal per day',
  monthly_sms_fee_kobo:                'Monthly SMS Alert Fee',
}

function humanizeKey(key: string): string {
  return key
    .replace(/_kobo$/, '')
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function labelFor(key: string): string {
  return KEY_LABELS[key] ?? humanizeKey(key)
}

// ── Confirm modal for deferred changes ──────────────────────────
function RateChangeConfirmModal({
  preview, onConfirm, onClose, isPending,
}: {
  preview: RateChangePreview
  onConfirm: () => void
  onClose: () => void
  isPending: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 dark:bg-night-900/60 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
        className="relative bg-white dark:bg-night-700 rounded-3xl w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-12 bg-amber-50 dark:bg-amber-500 rounded-2xl flex items-center justify-center mb-4">
          <Clock className="w-6 h-6 text-amber-500 dark:text-amber-300" />
        </div>
        <h2 className="text-green-900 dark:text-white font-extrabold text-lg mb-2">This change won't apply right away</h2>
        <p className="text-green-600 dark:text-night-200 text-sm mb-4">
          To avoid disrupting anyone already contributing, this takes effect on{' '}
          <span className="font-bold text-green-900 dark:text-white">{formatDate(preview.effective_date)}</span>{' '}
          — in {preview.days_until_effective} days.
        </p>
        <div className="bg-green-50 dark:bg-night-600 rounded-2xl p-4 mb-4 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-green-600 dark:text-night-200">Current rate</span>
            <span className="text-green-900 dark:text-white font-semibold">{formatNaira(preview.current_value_kobo)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-green-600 dark:text-night-200">New rate</span>
            <span className="text-green-900 dark:text-white font-bold">{formatNaira(preview.new_value_kobo)}</span>
          </div>
        </div>
        <p className="text-green-400 dark:text-night-300 text-xs mb-5">
          All customers will be automatically notified on {formatDate(preview.customers_will_be_notified_on)}, the day before it takes effect. You can edit or cancel this any time before then.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-sm rounded-full py-3">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 bg-green-900 dark:bg-night-100 text-white font-bold text-sm rounded-full py-3 disabled:opacity-50"
          >
            {isPending ? 'Scheduling…' : 'Confirm'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Pending change countdown card ───────────────────────────────
function PendingChangeCard({ change }: { change: PendingRateChange }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [newValue, setNewValue] = useState(String(koboToNaira(change.new_value_kobo)))

  const editMutation = useMutation({
    mutationFn: () => api.patch(`/settings/rate-changes/${change.id}`, { new_value_kobo: nairaToKobo(newValue) }),
    onSuccess: () => { toast.success('Pending change updated'); qc.invalidateQueries({ queryKey: ['rate-changes'] }); setEditing(false) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.delete(`/settings/rate-changes/${change.id}`),
    onSuccess: () => { toast.success('Pending change cancelled'); qc.invalidateQueries({ queryKey: ['rate-changes'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div className="bg-amber-50 dark:bg-amber-500 border-2 border-amber-200 dark:border-amber-500 rounded-2xl p-4 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-amber-600 dark:text-amber-300" />
        <p className="text-amber-700 dark:text-amber-300 font-bold text-xs uppercase tracking-wide">
          {labelFor(change.setting_key)} — scheduled change
        </p>
      </div>

      {editing ? (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-green-600 dark:text-night-200 text-sm">₦</span>
          <input
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            type="number"
            className="flex-1 border border-amber-300 dark:border-amber-500 rounded-xl px-3 py-2 text-sm text-green-900 dark:text-white"
          />
        </div>
      ) : (
        <p className="text-green-900 dark:text-white font-extrabold text-lg mb-1">
          → {formatNaira(change.new_value_kobo)}/day
        </p>
      )}

      <p className="text-amber-700 dark:text-amber-300 text-sm font-semibold mb-1">
        Takes effect in {change.days_until_effective} day{change.days_until_effective === 1 ? '' : 's'} ({formatDate(change.effective_date)})
      </p>
      {change.notified_at && (
        <p className="text-red-500 dark:text-red-300 text-xs mb-2">Customers already notified — this can no longer be cancelled.</p>
      )}

      <div className="flex gap-2 mt-3">
        {editing ? (
          <>
            <button onClick={() => setEditing(false)} className="flex-1 border border-amber-300 dark:border-amber-500 text-amber-700 dark:text-amber-300 text-xs font-bold rounded-full py-2">Cancel edit</button>
            <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending} className="flex-1 bg-amber-500 dark:bg-amber-400 text-white text-xs font-bold rounded-full py-2">
              {editMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="flex-1 min-w-0 flex items-center justify-center gap-1 border border-amber-300 dark:border-amber-500 text-amber-700 dark:text-amber-300 text-xs font-bold rounded-full py-2">
              <Pencil className="w-3 h-3 shrink-0" /> Edit
            </button>
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={!!change.notified_at || cancelMutation.isPending}
              className="flex-1 min-w-0 flex items-center justify-center gap-1 border border-red-200 dark:border-red-900 text-red-500 dark:text-red-300 text-xs font-bold rounded-full py-2 disabled:opacity-40"
            >
              <Ban className="w-3 h-3 shrink-0" /> {cancelMutation.isPending ? 'Cancelling…' : 'Cancel'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Setting row ──────────────────────────────────────────────────
function SettingRow({ setting, pendingChange }: { setting: SystemConfigItem; pendingChange?: PendingRateChange }) {
  const qc = useQueryClient()
  const isDeferred = DEFERRED_KEYS.has(setting.key)
  const [editValue, setEditValue] = useState(String(koboToNaira(Number(setting.value))))
  const [preview, setPreview] = useState<RateChangePreview | null>(null)

  const previewMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<RateChangePreview>('/settings/rate-changes/preview', {
        setting_key: setting.key,
        new_value_kobo: nairaToKobo(editValue),
      })
      return data
    },
    onSuccess: (data) => setPreview(data),
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const createChangeMutation = useMutation({
    mutationFn: () => api.post('/settings/rate-changes', {
      setting_key: setting.key,
      new_value_kobo: nairaToKobo(editValue),
    }),
    onSuccess: () => {
      toast.success('Rate change scheduled')
      qc.invalidateQueries({ queryKey: ['rate-changes'] })
      setPreview(null)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const immediateMutation = useMutation({
    mutationFn: () => api.patch(`/settings/${setting.key}`, { value: String(nairaToKobo(editValue)) }),
    onSuccess: () => { toast.success('Setting updated'); qc.invalidateQueries({ queryKey: ['settings'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const hasChanges = editValue !== String(koboToNaira(Number(setting.value)))

  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-3">
      <p className="text-green-900 dark:text-white font-bold text-sm mb-1">{labelFor(setting.key)}</p>
      {setting.description && <p className="text-green-400 dark:text-night-300 text-xs mb-3">{setting.description}</p>}

      {pendingChange && <PendingChangeCard change={pendingChange} />}

      {!pendingChange && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-green-600 dark:text-night-200 text-sm">₦</span>
            <input
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              type="number"
              className="flex-1 border border-green-200 dark:border-night-500 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <span className="text-green-400 dark:text-night-300 text-xs">{MONTHLY_KEYS.has(setting.key) ? '/month' : '/day'}</span>
          </div>

          {isDeferred ? (
            <button
              onClick={() => previewMutation.mutate()}
              disabled={!hasChanges || previewMutation.isPending}
              className="w-full bg-green-900 dark:bg-night-100 text-white font-bold text-sm rounded-full py-3 disabled:opacity-40"
            >
              {previewMutation.isPending ? 'Checking…' : 'Schedule change'}
            </button>
          ) : (
            <button
              onClick={() => immediateMutation.mutate()}
              disabled={!hasChanges || immediateMutation.isPending}
              className="w-full bg-green-900 dark:bg-night-100 text-white font-bold text-sm rounded-full py-3 disabled:opacity-40"
            >
              {immediateMutation.isPending ? 'Saving…' : 'Save — applies immediately'}
            </button>
          )}
        </>
      )}

      <AnimatePresence>
        {preview && (
          <RateChangeConfirmModal
            preview={preview}
            isPending={createChangeMutation.isPending}
            onConfirm={() => createChangeMutation.mutate()}
            onClose={() => setPreview(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
// ── Zones ────────────────────────────────────────────────────────
function ZonesSection() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { data: zones = [], isLoading } = useQuery({
    queryKey: ['zones'],
    queryFn: async () => { const { data } = await api.get<Zone[]>('/zones'); return data },
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/zones', { name: name.trim(), description: description.trim() || null }),
    onSuccess: () => {
      toast.success('Zone created')
      qc.invalidateQueries({ queryKey: ['zones'] })
      setName(''); setDescription(''); setShowAdd(false)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: (zoneId: string) => api.delete(`/zones/${zoneId}`),
    onSuccess: () => {
      toast.success('Zone deleted')
      qc.invalidateQueries({ queryKey: ['zones'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const handleDelete = (zone: Zone) => {
    const msg = zone.officer_count > 0
      ? `${zone.officer_count} officer(s) are currently assigned to "${zone.name}" — they'll become unassigned, not deleted. Continue?`
      : `Delete zone "${zone.name}"?`
    if (window.confirm(msg)) deleteMutation.mutate(zone.id)
  }

  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-green-600 dark:text-night-200" />
          <p className="text-green-900 dark:text-white font-bold text-sm">Zones</p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1 text-green-700 dark:text-night-100 text-xs font-bold"
        >
          <Plus className="w-3.5 h-3.5" /> {showAdd ? 'Cancel' : 'Add zone'}
        </button>
      </div>
      <p className="text-green-400 dark:text-night-300 text-xs mb-3">
        Officers are assigned one of these zones when a director registers them.
      </p>

      {showAdd && (
        <div className="bg-green-50 dark:bg-night-600 rounded-xl p-3 mb-3 space-y-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Zone name (e.g. Lagos Mainland)"
            className="w-full border border-green-200 dark:border-night-500 rounded-lg px-3 py-2 text-sm text-green-900 dark:text-white bg-white dark:bg-night-700"
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full border border-green-200 dark:border-night-500 rounded-lg px-3 py-2 text-sm text-green-900 dark:text-white bg-white dark:bg-night-700"
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
            className="w-full bg-green-900 dark:bg-night-100 text-white font-bold text-xs rounded-lg py-2.5 disabled:opacity-40"
          >
            {createMutation.isPending ? 'Creating…' : 'Create zone'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="h-16 bg-green-50 dark:bg-night-600 rounded-xl animate-pulse" />
      ) : zones.length === 0 ? (
        <p className="text-green-400 dark:text-night-300 text-xs text-center py-3">No zones yet — add one above.</p>
      ) : (
        <div className="space-y-2">
          {zones.map(zone => (
            <div key={zone.id} className="flex items-center justify-between bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-green-900 dark:text-white text-sm font-semibold truncate">{zone.name}</p>
                <div className="flex items-center gap-1 text-green-400 dark:text-night-300 text-xs">
                  <Users className="w-3 h-3" />
                  {zone.current_officer_name ? (
                    <span className="truncate">{zone.current_officer_name}</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-300">Uncovered</span>
                  )}
                  {zone.description && <span className="truncate"> · {zone.description}</span>}
                </div>
              </div>
              <button
                onClick={() => handleDelete(zone)}
                disabled={deleteMutation.isPending}
                className="text-red-400 dark:text-red-300 flex-shrink-0 ml-2 disabled:opacity-40"
                aria-label={`Delete ${zone.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Food Card Enrollment Date Window ──────────────────────────────
function FoodCardDateWindowSection({ settings }: { settings: SystemConfigItem[] }) {
  const qc = useQueryClient()
  const fromSetting = settings.find(s => s.key === 'food_card_open_from')
  const untilSetting = settings.find(s => s.key === 'food_card_open_until')

  const initialFrom = fromSetting?.value || '2026-01-01'
  const initialUntil = untilSetting?.value || '2026-11-30'

  const [openFrom, setOpenFrom] = useState(initialFrom)
  const [openUntil, setOpenUntil] = useState(initialUntil)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (fromSetting?.value) setOpenFrom(fromSetting.value)
    if (untilSetting?.value) setOpenUntil(untilSetting.value)
  }, [fromSetting?.value, untilSetting?.value])

  const todayStr = new Date().toISOString().split('T')[0]
  const isOpenNow = (!openFrom || todayStr >= openFrom) && (!openUntil || todayStr <= openUntil)

  const hasChanges = openFrom !== (fromSetting?.value || initialFrom) || openUntil !== (untilSetting?.value || initialUntil)

  const handleSave = async () => {
    if (openFrom && openUntil && openFrom > openUntil) {
      toast.error('Opening date must be on or before the closing date')
      return
    }
    setIsSaving(true)
    try {
      await Promise.all([
        api.patch('/settings/food_card_open_from', { value: openFrom }),
        api.patch('/settings/food_card_open_until', { value: openUntil }),
      ])
      toast.success('Food card enrollment window updated')
      qc.invalidateQueries({ queryKey: ['settings'] })
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-green-600 dark:text-night-200" />
          <p className="text-green-900 dark:text-white font-bold text-sm">Food Card Enrollment Window</p>
        </div>
        <span
          className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
            isOpenNow
              ? 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300'
              : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
          }`}
        >
          {isOpenNow ? 'Enrollment Active' : 'Enrollment Closed'}
        </span>
      </div>
      <p className="text-green-500 dark:text-night-300 text-xs mb-4">
        Dates during which customers can create and begin contributing toward annual holiday food packages.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-green-700 dark:text-night-200 text-xs font-semibold mb-1">
            Opening Date (From)
          </label>
          <input
            type="date"
            value={openFrom}
            onChange={e => setOpenFrom(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-sm text-green-900 dark:text-white bg-green-50 dark:bg-night-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-green-700 dark:text-night-200 text-xs font-semibold mb-1">
            Closing Date (Until)
          </label>
          <input
            type="date"
            value={openUntil}
            onChange={e => setOpenUntil(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-sm text-green-900 dark:text-white bg-green-50 dark:bg-night-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={!hasChanges || isSaving}
        className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-2.5 disabled:opacity-40 transition-opacity"
      >
        {isSaving ? 'Saving Window…' : 'Save Enrollment Dates'}
      </button>
    </div>
  )
}

// ── Service Worker Pool Timers Window ─────────────────────────────
function ServiceWorkerSettingsSection({ settings }: { settings: SystemConfigItem[] }) {
  const qc = useQueryClient()
  const timeoutSetting = settings.find(s => s.key === 'service_worker_job_timeout_minutes')
  const referralHoldSetting = settings.find(s => s.key === 'service_worker_referral_hold_minutes')

  const [timeoutMins, setTimeoutMins] = useState(timeoutSetting?.value || '30')
  const [referralHoldMins, setReferralHoldMins] = useState(referralHoldSetting?.value || '30')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (timeoutSetting?.value) setTimeoutMins(timeoutSetting.value)
    if (referralHoldSetting?.value) setReferralHoldMins(referralHoldSetting.value)
  }, [timeoutSetting?.value, referralHoldSetting?.value])

  const hasChanges =
    timeoutMins !== (timeoutSetting?.value || '30') ||
    referralHoldMins !== (referralHoldSetting?.value || '30')

  const handleSave = async () => {
    const t = parseInt(timeoutMins, 10)
    const r = parseInt(referralHoldMins, 10)
    if (isNaN(t) || t < 5 || t > 1440) {
      toast.error('SLA processing timeout must be between 5 and 1440 minutes')
      return
    }
    if (isNaN(r) || r < 1 || r > 1440) {
      toast.error('Referral hold window must be between 1 and 1440 minutes')
      return
    }
    setIsSaving(true)
    try {
      await Promise.all([
        api.patch('/settings/service_worker_job_timeout_minutes', { value: String(t) }),
        api.patch('/settings/service_worker_referral_hold_minutes', { value: String(r) }),
      ])
      toast.success('Service Worker timers updated')
      qc.invalidateQueries({ queryKey: ['settings'] })
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-green-600 dark:text-night-200" />
          <p className="text-green-900 dark:text-white font-bold text-sm">Service Worker Pool Timers</p>
        </div>
      </div>
      <p className="text-green-500 dark:text-night-300 text-xs mb-4">
        Configure how long workers have to complete claimed jobs before SLA reclamation, and how long referred jobs are held exclusively before falling back to the open pool.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-green-700 dark:text-night-200 text-xs font-semibold mb-1">
            SLA Processing Timeout (Minutes)
          </label>
          <input
            type="number"
            min={5}
            max={1440}
            value={timeoutMins}
            onChange={e => setTimeoutMins(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-sm text-green-900 dark:text-white bg-green-50 dark:bg-night-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <p className="text-[10px] text-green-400 dark:text-night-400 mt-1">
            Timeout before job is returned to open pool (default: 30)
          </p>
        </div>
        <div>
          <label className="block text-green-700 dark:text-night-200 text-xs font-semibold mb-1">
            Referral Hold Window (Minutes)
          </label>
          <input
            type="number"
            min={1}
            max={1440}
            value={referralHoldMins}
            onChange={e => setReferralHoldMins(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-sm text-green-900 dark:text-white bg-green-50 dark:bg-night-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <p className="text-[10px] text-green-400 dark:text-night-400 mt-1">
            Exclusive pre-claim period for referred worker (default: 30)
          </p>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={!hasChanges || isSaving}
        className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-2.5 disabled:opacity-40 transition-opacity"
      >
        {isSaving ? 'Saving Timers…' : 'Save Worker Timers'}
      </button>
    </div>
  )
}

export default function BusinessSettingsPage() {
  const navigate = useNavigate()

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => { const { data } = await api.get<SystemConfigItem[]>('/settings'); return data },
  })

  const { data: rateChanges = [] } = useQuery({
    queryKey: ['rate-changes'],
    queryFn: async () => { const { data } = await api.get<PendingRateChange[]>('/settings/rate-changes'); return data },
  })

  const pendingByKey = new Map(
    rateChanges.filter(c => c.status === 'scheduled').map(c => [c.setting_key, c])
  )

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Business Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <p className="text-green-500 dark:text-night-200 text-sm mb-4">
          Control the rates and fees that drive the whole platform. Food Card rate changes are deferred to the next January 1st to protect customers already contributing.
        </p>

        <ZonesSection />

        <FoodCardDateWindowSection settings={settings} />

        <ServiceWorkerSettingsSection settings={settings} />

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-32 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}
          </div>
        ) : (
          settings
            .filter(setting => !DATE_KEYS.has(setting.key) && !SW_KEYS.has(setting.key))
            .map(setting => (
              <SettingRow key={setting.key} setting={setting} pendingChange={pendingByKey.get(setting.key)} />
            ))
        )}
      </div>

    </div>
  )
}
