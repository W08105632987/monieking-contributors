import { useState, useEffect, useMemo } from 'react'
import { ask } from '@/lib/dialog'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Clock, Pencil, Ban, MapPin, Plus, Trash2, Users, Search, ChevronDown, Info,
  AlertTriangle, ExternalLink, CreditCard, Wallet, Briefcase, Scale, ShieldCheck, MessageSquare,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatDate, nairaToKobo, koboToNaira } from '@/lib/utils'
import type { PendingRateChange, RateChangePreview, Zone } from '@/types'

function labelFor(key: string): string {
  if (key === 'food_card_rate_kobo') return 'Food Card daily rate'
  return key.replace(/_kobo$/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// ── What the server sends (GET /settings/registry) ──────────────
interface RegLink { label: string; path: string; note: string }
type Kind = 'money' | 'percent' | 'duration' | 'count' | 'days' | 'date'
interface RegSetting {
  key: string; group: string; label: string; kind: Kind; value: string; default: string
  min: number | null; max: number | null; deferred: boolean; what: string; effect: string
  links: RegLink[]; updated_at: string | null
}
interface RegGroup { id: string; label: string; blurb: string }
interface Registry { groups: RegGroup[]; settings: RegSetting[]; retired: { key: string; why: string }[] }

const GROUP_ICONS: Record<string, LucideIcon> = {
  contributions: CreditCard, wallet: Wallet, workers: Briefcase, disputes: Scale,
  verification: ShieldCheck, sms: MessageSquare, zones: MapPin,
}

// ── Formatting: whole numbers only, time always as hours + minutes ──
function formatDuration(total: number): string {
  const h = Math.floor(total / 60), m = total % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h} hour${h === 1 ? '' : 's'}`
  return `${m} minute${m === 1 ? '' : 's'}`
}

function formatValue(s: RegSetting, raw: string = s.value): string {
  const n = Number(raw)
  switch (s.kind) {
    case 'money': return formatNaira(n)
    case 'percent': return `${n}%`
    case 'duration': return formatDuration(n)
    case 'days': return n === 0 ? 'Off' : `${n} day${n === 1 ? '' : 's'}`
    case 'date': return formatDate(raw)
    default: return String(n)
  }
}

const PER_DAY_KEYS = new Set(['food_card_rate_kobo', 'min_regular_card_rate_kobo', 'max_instant_withdrawal_kobo'])
const unitFor = (s: RegSetting) =>
  s.kind === 'money' ? (PER_DAY_KEYS.has(s.key) ? '/day' : '') : s.kind === 'percent' ? '%' : s.kind === 'count' ? (s.key.includes('food_cards') ? 'cards' : '') : s.kind === 'days' ? 'days' : ''

// ── Draft handling ──────────────────────────────────────────────
interface Draft { a: string; b: string }   // a: main box (or hours), b: minutes
function toDraft(s: RegSetting): Draft {
  const n = Number(s.value)
  if (s.kind === 'duration') return { a: String(Math.floor(n / 60)), b: String(n % 60) }
  if (s.kind === 'money') return { a: String(Math.round(n / 100)), b: '' }
  return { a: s.value, b: '' }
}

function fromDraft(s: RegSetting, d: Draft): { value?: string; error?: string } {
  const whole = (t: string) => /^\d+$/.test(t.trim())
  const range = (n: number) => {
    if (s.min !== null && n < s.min || s.max !== null && n > s.max) {
      const lo = s.min !== null ? formatValue(s, String(s.min)) : null
      const hi = s.max !== null ? formatValue(s, String(s.max)) : null
      return lo && hi ? `Must be between ${lo} and ${hi}.` : lo ? `Must be at least ${lo}.` : `Must be at most ${hi}.`
    }
    return null
  }
  if (s.kind === 'date') return d.a ? { value: d.a } : { error: 'Pick a date.' }
  if (s.kind === 'duration') {
    const h = d.a.trim() === '' ? '0' : d.a, m = d.b.trim() === '' ? '0' : d.b
    if (!whole(h) || !whole(m)) return { error: 'Use whole numbers only, with no decimals.' }
    if (Number(m) > 59) return { error: 'Minutes go from 0 to 59. Use the hours box for more.' }
    const total = Number(h) * 60 + Number(m)
    return range(total) ? { error: range(total)! } : { value: String(total) }
  }
  if (!whole(d.a)) return { error: 'Use whole numbers only, with no decimals.' }
  const n = s.kind === 'money' ? Number(d.a) * 100 : Number(d.a)
  const err = range(n)
  return err ? { error: err } : { value: String(n) }
}

const inputCls = 'w-full border border-green-200 dark:border-night-500 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white bg-green-50 dark:bg-night-600 focus:outline-none focus:ring-2 focus:ring-green-500'
const digits = (t: string) => t.replace(/\D/g, '')

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
      <div className="absolute inset-0 bg-green-950/60 dark:bg-night-900/60" />
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

  const handleDelete = async (zone: Zone) => {
    const msg = zone.officer_count > 0
      ? `${zone.officer_count} officer(s) are currently assigned to "${zone.name}" — they'll become unassigned, not deleted. Continue?`
      : `Delete zone "${zone.name}"?`
    if (await ask(msg, { title: 'Delete this zone?', tone: 'danger', confirmLabel: 'Delete zone' })) deleteMutation.mutate(zone.id)
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


// ── One setting ──────────────────────────────────────────────────
function SettingCard({ s, pending, isOpen, onToggle, allSettings }: {
  s: RegSetting; pending?: PendingRateChange; isOpen: boolean; onToggle: () => void; allSettings: RegSetting[]
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft>(() => toDraft(s))
  const [preview, setPreview] = useState<RateChangePreview | null>(null)
  useEffect(() => { setDraft(toDraft(s)) }, [s.value])   // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = fromDraft(s, draft)
  const changed = parsed.value !== undefined && parsed.value !== s.value
  const refresh = () => { qc.invalidateQueries({ queryKey: ['settings-registry'] }); qc.invalidateQueries({ queryKey: ['settings'] }) }

  const save = useMutation({
    mutationFn: () => api.patch(`/settings/${s.key}`, { value: parsed.value }),
    onSuccess: () => { toast.success(`${s.label} updated`); refresh() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const previewMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<RateChangePreview>('/settings/rate-changes/preview', { setting_key: s.key, new_value_kobo: Number(parsed.value) })
      return data
    },
    onSuccess: setPreview,
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  const createChange = useMutation({
    mutationFn: () => api.post('/settings/rate-changes', { setting_key: s.key, new_value_kobo: Number(parsed.value) }),
    onSuccess: () => { toast.success('Rate change scheduled'); qc.invalidateQueries({ queryKey: ['rate-changes'] }); setPreview(null) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const onSave = async () => {
    if (!changed) return
    if (s.deferred) { previewMutation.mutate(); return }
    if (s.links.length) {
      const msg = s.links.map(l => `${l.label}: ${l.note}`).join('\n\n')
      const ok = await ask(`${msg}\n\nChange it from ${formatValue(s)} to ${formatValue(s, parsed.value)}?`,
        { title: 'This also changes somewhere else', tone: 'danger', confirmLabel: 'Yes, change it' })
      if (!ok) return
    }
    save.mutate()
  }

  // Enrollment dates: show whether sign-ups are open under the values in the boxes right now.
  const today = new Date().toISOString().split('T')[0]
  const dateOf = (k: string, mine: string) => (k === s.key ? mine : allSettings.find(x => x.key === k)?.value ?? '')
  const enrollmentOpen = s.kind === 'date'
    ? (() => { const f = dateOf('food_card_open_from', draft.a), u = dateOf('food_card_open_until', draft.a); return (!f || today >= f) && (!u || today <= u) })()
    : null

  return (
    <div className={`bg-white dark:bg-night-700 rounded-2xl border shadow-card mb-3 overflow-hidden transition-colors ${isOpen ? 'border-green-400 dark:border-green-600' : 'border-green-100 dark:border-night-500'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left" aria-expanded={isOpen}>
        <div className="flex-1 min-w-0">
          <p className="text-green-900 dark:text-white font-bold text-sm leading-snug">{s.label}</p>
          <p className="text-green-500 dark:text-night-300 text-xs mt-0.5 line-clamp-1">{s.what}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="px-2.5 py-1 rounded-full bg-green-100 dark:bg-night-600 text-green-800 dark:text-white text-xs font-extrabold">
            {formatValue(s)}{unitFor(s) && s.kind === 'money' ? <span className="font-semibold text-green-500 dark:text-night-300">{unitFor(s)}</span> : null}
          </span>
          {pending && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-300 flex items-center gap-1"><Clock className="w-3 h-3" />Change scheduled</span>}
          {!pending && s.links.length > 0 && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-300 flex items-center gap-1"><ExternalLink className="w-3 h-3" />Also set elsewhere</span>}
        </div>
        <ChevronDown className={`w-4 h-4 text-green-400 dark:text-night-300 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-3">
              <div className="rounded-xl bg-green-50 dark:bg-night-600 p-3.5 space-y-2.5">
                <div className="flex gap-2">
                  <Info className="w-4 h-4 text-green-600 dark:text-night-200 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-green-800 dark:text-white text-xs font-bold mb-0.5">What this is</p>
                    <p className="text-green-700 dark:text-night-100 text-xs leading-relaxed">{s.what}</p>
                  </div>
                </div>
                <div className="pl-6">
                  <p className="text-green-800 dark:text-white text-xs font-bold mb-0.5">When you change it</p>
                  <p className="text-green-700 dark:text-night-100 text-xs leading-relaxed">{s.effect}</p>
                </div>
              </div>

              {s.links.map(l => (
                <div key={l.path} className="rounded-xl border border-amber-200 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-500/10 p-3.5">
                  <div className="flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-amber-800 dark:text-amber-200 text-xs font-bold mb-0.5">Also controlled in {l.label}</p>
                      <p className="text-amber-700 dark:text-amber-200/90 text-xs leading-relaxed">{l.note}</p>
                      <button onClick={() => navigate(l.path)} className="mt-2 text-amber-800 dark:text-amber-200 text-xs font-bold underline underline-offset-2">Open {l.label}</button>
                    </div>
                  </div>
                </div>
              ))}

              {pending ? (
                <PendingChangeCard change={pending} />
              ) : (
                <div>
                  {s.kind === 'duration' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block"><span className="block text-green-700 dark:text-night-200 text-xs font-semibold mb-1">Hours</span>
                        <input inputMode="numeric" value={draft.a} onChange={e => setDraft({ ...draft, a: digits(e.target.value) })} placeholder="0" className={inputCls} /></label>
                      <label className="block"><span className="block text-green-700 dark:text-night-200 text-xs font-semibold mb-1">Minutes</span>
                        <input inputMode="numeric" value={draft.b} onChange={e => setDraft({ ...draft, b: digits(e.target.value) })} placeholder="0" className={inputCls} /></label>
                    </div>
                  ) : s.kind === 'date' ? (
                    <input type="date" value={draft.a} onChange={e => setDraft({ ...draft, a: e.target.value })} className={inputCls} />
                  ) : (
                    <div className="flex items-center gap-2">
                      {s.kind === 'money' && <span className="text-green-700 dark:text-night-100 font-bold">₦</span>}
                      <input inputMode="numeric" value={draft.a} onChange={e => setDraft({ ...draft, a: digits(e.target.value) })} className={inputCls} />
                      {unitFor(s) && <span className="text-green-500 dark:text-night-300 text-xs font-semibold shrink-0">{unitFor(s)}</span>}
                    </div>
                  )}
                  {parsed.error ? (
                    <p className="text-red-500 dark:text-red-300 text-xs mt-1.5">{parsed.error}</p>
                  ) : s.kind === 'duration' && parsed.value ? (
                    <p className="text-green-500 dark:text-night-300 text-xs mt-1.5">= {formatDuration(Number(parsed.value))}</p>
                  ) : null}
                  {enrollmentOpen !== null && (
                    <p className={`text-xs font-semibold mt-1.5 ${enrollmentOpen ? 'text-green-600 dark:text-green-300' : 'text-amber-600 dark:text-amber-300'}`}>
                      With these dates, Food Card enrollment is {enrollmentOpen ? 'open today' : 'closed today'}.
                    </p>
                  )}
                  <p className="text-green-400 dark:text-night-400 text-[11px] mt-1.5">Default: {formatValue(s, s.default)}</p>
                  <button
                    onClick={onSave}
                    disabled={!changed || !!parsed.error || save.isPending || previewMutation.isPending}
                    className="w-full mt-3 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3 disabled:opacity-40 transition-opacity"
                  >
                    {s.deferred ? (previewMutation.isPending ? 'Checking…' : 'Schedule change')
                      : save.isPending ? 'Saving…' : 'Save — applies immediately'}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {preview && <RateChangeConfirmModal preview={preview} isPending={createChange.isPending} onConfirm={() => createChange.mutate()} onClose={() => setPreview(null)} />}
      </AnimatePresence>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────
export default function BusinessSettingsPage() {
  const navigate = useNavigate()
  const [group, setGroup] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)

  const { data: registry, isLoading } = useQuery({
    queryKey: ['settings-registry'],
    queryFn: async () => { const { data } = await api.get<Registry>('/settings/registry'); return data },
  })
  const { data: rateChanges = [] } = useQuery({
    queryKey: ['rate-changes'],
    queryFn: async () => { const { data } = await api.get<PendingRateChange[]>('/settings/rate-changes'); return data },
  })
  const pendingByKey = new Map(rateChanges.filter(c => c.status === 'scheduled').map(c => [c.setting_key, c]))

  const groups = useMemo(() => [...(registry?.groups ?? []), { id: 'zones', label: 'Officer Zones', blurb: 'The areas officers are assigned to.' }], [registry])
  const q = query.trim().toLowerCase()
  const visible = (registry?.settings ?? []).filter(s =>
    (group === 'all' || group === s.group) && (!q || `${s.label} ${s.what}`.toLowerCase().includes(q)))
  const showZones = (group === 'all' || group === 'zones') && (!q || 'zones officer areas'.includes(q))

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center" aria-label="Back">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Business Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        <p className="text-green-500 dark:text-night-200 text-sm mb-3">
          Tap any setting to see what it does and what changes in the app when you edit it. Settings that can also be changed from another screen are marked, and you are warned before you save.
        </p>

        <div className="relative mb-3">
          <Search className="w-4 h-4 text-green-400 dark:text-night-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings" className={`${inputCls} pl-10 bg-white dark:bg-night-700`} />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 no-scrollbar">
          {[{ id: 'all', label: 'All' }, ...groups].map(g => (
            <button key={g.id} onClick={() => setGroup(g.id)}
              className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-bold border transition-colors ${group === g.id
                ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900 border-transparent'
                : 'bg-white dark:bg-night-700 text-green-700 dark:text-night-100 border-green-100 dark:border-night-500'}`}>
              {g.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}</div>
        ) : (
          <>
            {groups.map(g => {
              const items = visible.filter(s => s.group === g.id)
              const isZones = g.id === 'zones'
              if (isZones ? !showZones : items.length === 0) return null
              const Icon = GROUP_ICONS[g.id] ?? Info
              return (
                <section key={g.id} className="mb-5">
                  <div className="flex items-center gap-2.5 mb-2.5 px-1">
                    <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center"><Icon className="w-4 h-4 text-green-700 dark:text-night-100" /></div>
                    <div>
                      <h2 className="text-green-900 dark:text-white font-extrabold text-sm leading-tight">{g.label}</h2>
                      <p className="text-green-500 dark:text-night-300 text-[11px]">{g.blurb}</p>
                    </div>
                  </div>
                  {isZones ? <ZonesSection /> : items.map(s => (
                    <SettingCard key={s.key} s={s} allSettings={registry!.settings} pending={pendingByKey.get(s.key)}
                      isOpen={openKey === s.key} onToggle={() => setOpenKey(openKey === s.key ? null : s.key)} />
                  ))}
                </section>
              )
            })}
            {visible.length === 0 && !showZones && <p className="text-green-400 dark:text-night-300 text-sm text-center py-8">No settings match “{query}”.</p>}

            {(registry?.retired.length ?? 0) > 0 && group === 'all' && !q && (
              <div className="rounded-2xl border border-dashed border-green-200 dark:border-night-500 p-4 mb-6">
                <p className="text-green-800 dark:text-white text-xs font-bold mb-2">Removed because they had no effect</p>
                {registry!.retired.map(r => (
                  <p key={r.key} className="text-green-500 dark:text-night-300 text-xs leading-relaxed mb-1.5"><span className="font-semibold text-green-700 dark:text-night-100">{labelFor(r.key)}.</span> {r.why}</p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
