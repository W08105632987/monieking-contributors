import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Archive, ChevronRight, Eye,
  TrendingUp, MousePointerClick, BarChart2, Edit2, Check, X,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { PromoBanner } from '@/types'

/* ── CTA allowlist (mirrors real app routes from App.tsx) ──────────────────── */
const INTERNAL_ROUTES = [
  { path: '/customer/wallet',           label: 'Wallet / Fund wallet' },
  { path: '/customer/withdrawals/new',  label: 'Withdraw funds' },
  { path: '/customer/cards',            label: 'My cards' },
  { path: '/customer/services',         label: 'Manual services' },
  { path: '/customer/referrals',        label: 'Refer & earn' },
  { path: '/customer/food',             label: 'Food collection' },
  { path: '/customer/notifications',    label: 'Notifications' },
  { path: '/customer/profile',          label: 'Profile' },
] as const

/* Validate external URLs — https:// only, no javascript: / data: etc */
function isValidExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

/* ── Gradient presets ──────────────────────────────────────────────────────── */
const PRESETS = [
  { from: '#052E16', to: '#D97706',  label: 'Forest → Copper'  },
  { from: '#1E3A8A', to: '#3B82F6',  label: 'Deep Blue'        },
  { from: '#7C2D12', to: '#EA580C',  label: 'Ember'            },
  { from: '#4C1D95', to: '#A855F7',  label: 'Royal Purple'     },
  { from: '#134E4A', to: '#2DD4BF',  label: 'Teal Surge'       },
  { from: '#881337', to: '#F43F5E',  label: 'Valentine'        },
]

/* ── Starter content presets (3.5) ────────────────────────────────────────── */
const STARTERS = [
  { title: 'Refer a friend, earn ₦500', subtitle: 'Share your referral link today — both of you win.', preset: PRESETS[0], cta: '/customer/referrals' },
  { title: 'Fund your wallet now',      subtitle: 'Instant virtual account top-up, no charges.',        preset: PRESETS[1], cta: '/customer/wallet' },
  { title: 'Need a document verified?', subtitle: 'NIN, BVN, TIN & more — same-day turnaround.',        preset: PRESETS[2], cta: '/customer/services' },
  { title: 'Holiday food collection',   subtitle: 'Your condiments pass is ready — don\'t miss pickup.', preset: PRESETS[4], cta: '/customer/food' },
]

/* ── Live preview ──────────────────────────────────────────────────────────── */
function LivePreview({
  title, subtitle, from, to,
}: { title: string; subtitle: string; from: string; to: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5"
      style={{ background: `linear-gradient(115deg, ${from} 0%, ${to} 100%)`, minHeight: 100 }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.35) 35%, rgba(255,255,255,0.05) 50%, transparent 65%)',
          backgroundSize: '250% 250%',
          animation: 'promo-shine-preview 3.2s ease-in-out infinite',
        }}
      />
      <div className="relative z-10">
        <p className="text-white font-extrabold text-base">{title || 'Banner title'}</p>
        {subtitle && <p className="text-white/80 text-xs mt-1">{subtitle}</p>}
        <div className="flex items-center gap-1 mt-2.5 text-white text-xs font-bold">
          View <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>
      <style>{`@keyframes promo-shine-preview { 0% { background-position: 200% 200%; } 100% { background-position: -50% -50%; } }`}</style>
    </div>
  )
}

/* ── Status badge ─────────────────────────────────────────────────────────── */
function StatusBadge({ banner }: { banner: PromoBanner }) {
  const now = Date.now()
  const start = banner.start_at ? new Date(banner.start_at).getTime() : null
  const end   = banner.end_at   ? new Date(banner.end_at).getTime()   : null

  let label = 'Active'
  let cls   = 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'

  if (!banner.is_active) {
    label = 'Paused'; cls = 'bg-gray-100 dark:bg-night-600 text-gray-500 dark:text-night-300'
  } else if (start && now < start) {
    label = 'Scheduled'; cls = 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300'
  } else if (end && now > end) {
    label = 'Expired'; cls = 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
  }

  return (
    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', cls)}>{label}</span>
  )
}

/* ── Analytics mini-row ───────────────────────────────────────────────────── */
function AnalyticsRow({ banner }: { banner: PromoBanner }) {
  const ctr = banner.impressions > 0 ? ((banner.clicks / banner.impressions) * 100).toFixed(1) : '—'
  return (
    <div className="flex items-center gap-4 mt-2 text-[11px] text-green-500 dark:text-night-300">
      <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{banner.impressions.toLocaleString()}</span>
      <span className="flex items-center gap-1"><MousePointerClick className="w-3 h-3" />{banner.clicks.toLocaleString()}</span>
      <span className="flex items-center gap-1"><BarChart2 className="w-3 h-3" />CTR {ctr}%</span>
    </div>
  )
}

/* ── Archive confirmation modal ───────────────────────────────────────────── */
function ArchiveConfirmModal({
  banner, onCancel, onConfirm, isPending,
}: { banner: PromoBanner; onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white dark:bg-night-700 rounded-3xl p-6 max-w-xs w-full shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <Archive className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-green-900 dark:text-white font-extrabold text-center text-base mb-1">Archive banner?</p>
        <p className="text-green-500 dark:text-night-200 text-xs text-center mb-5">
          "{banner.title}" will be deactivated and hidden from dashboards. Analytics history is preserved.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 border border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-sm rounded-full py-2.5">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 bg-amber-500 text-white font-bold text-sm rounded-full py-2.5 disabled:opacity-50"
          >
            {isPending ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Inline edit row ──────────────────────────────────────────────────────── */
function BannerCard({ banner, onArchive }: { banner: PromoBanner; onArchive: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle]     = useState(banner.title)
  const [subtitle, setSub]    = useState(banner.subtitle ?? '')
  const qc = useQueryClient()

  const updateMutation = useMutation({
    mutationFn: (patch: object) => api.patch(`/promo-banners/${banner.id}`, patch),
    onSuccess: () => { toast.success('Updated'); qc.invalidateQueries({ queryKey: ['promo-banners'] }); setEditing(false) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const toggleMutation = useMutation({
    mutationFn: (is_active: boolean) => api.patch(`/promo-banners/${banner.id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['promo-banners'] }),
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-3">
      <div className="rounded-xl overflow-hidden mb-2">
        <LivePreview title={banner.title} subtitle={banner.subtitle ?? ''} from={banner.gradient_from} to={banner.gradient_to} />
      </div>

      {editing ? (
        <div className="space-y-2 mb-2">
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-sm text-green-900 dark:text-white bg-white dark:bg-night-600"
            placeholder="Title"
          />
          <input
            value={subtitle} onChange={e => setSub(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-sm text-green-900 dark:text-white bg-white dark:bg-night-600"
            placeholder="Subtitle (optional)"
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => updateMutation.mutate({ title: title.trim(), subtitle: subtitle.trim() || null })}
              disabled={!title.trim() || updateMutation.isPending}
              className="flex-1 flex items-center justify-center gap-1 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-xs rounded-full py-2 disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
            <button onClick={() => setEditing(false)} className="flex-1 flex items-center justify-center gap-1 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200 font-bold text-xs rounded-full py-2">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <StatusBadge banner={banner} />
            <span className="text-green-400 dark:text-night-300 text-[10px] capitalize">
              {banner.target_roles === 'all' ? 'Everyone' : `${banner.target_roles}s only`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 text-[11px] font-bold text-green-700 dark:text-night-100 hover:text-green-900"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
            <button
              onClick={() => toggleMutation.mutate(!banner.is_active)}
              disabled={toggleMutation.isPending}
              className={cn(
                'text-[11px] font-bold px-2.5 py-1 rounded-full disabled:opacity-60',
                banner.is_active
                  ? 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100'
                  : 'bg-green-50 dark:bg-night-600 text-green-400 dark:text-night-300',
              )}
            >
              {toggleMutation.isPending ? '…' : banner.is_active ? 'Pause' : 'Activate'}
            </button>
            <button
              onClick={() => onArchive(banner.id)}
              className="flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-300 hover:text-amber-800"
            >
              <Archive className="w-3 h-3" /> Archive
            </button>
          </div>
        </div>
      )}

      <AnalyticsRow banner={banner} />
    </div>
  )
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function PromoBannersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  // Create form state
  const [showCreate, setShowCreate]       = useState(false)
  const [title, setTitle]                 = useState('')
  const [subtitle, setSubtitle]           = useState('')
  const [gradientFrom, setGradientFrom]   = useState(PRESETS[0].from)
  const [gradientTo, setGradientTo]       = useState(PRESETS[0].to)
  const [audience, setAudience]           = useState<'all' | 'customer' | 'officer' | 'service_worker'>('all')
  const [linkType, setLinkType]           = useState<'none' | 'internal_route' | 'external_url'>('none')
  const [linkTarget, setLinkTarget]       = useState('')
  const [linkError, setLinkError]         = useState('')

  // Archive modal state
  const [archivingId, setArchivingId]     = useState<string | null>(null)

  // Tab state
  const [tab, setTab] = useState<'active' | 'all'>('active')

  const { data: banners = [], isLoading } = useQuery({
    queryKey: ['promo-banners'],
    queryFn: async () => { const { data } = await api.get<PromoBanner[]>('/promo-banners'); return data },
  })

  const archivingBanner = banners.find(b => b.id === archivingId) ?? null

  const activeBanners   = banners.filter(b => b.is_active)
  const displayed       = tab === 'active' ? activeBanners : banners

  const validateLink = (): boolean => {
    setLinkError('')
    if (linkType === 'none') return true
    if (!linkTarget.trim()) { setLinkError('Please enter a target'); return false }
    if (linkType === 'internal_route') {
      const allowed: string[] = INTERNAL_ROUTES.map(r => r.path)
      if (!allowed.includes(linkTarget)) { setLinkError('Select a valid internal route from the dropdown'); return false }
    }
    if (linkType === 'external_url') {
      if (!isValidExternalUrl(linkTarget)) { setLinkError('Only https:// URLs are allowed'); return false }
    }
    return true
  }

  const createMutation = useMutation({
    mutationFn: () => {
      if (!validateLink()) throw new Error('Invalid link')
      return api.post('/promo-banners', {
        title: title.trim(), subtitle: subtitle.trim() || null,
        gradient_from: gradientFrom, gradient_to: gradientTo,
        link_type: linkType, link_target: linkType !== 'none' ? linkTarget.trim() : null,
        target_roles: audience,
      })
    },
    onSuccess: () => {
      toast.success('Banner created')
      qc.invalidateQueries({ queryKey: ['promo-banners'] })
      setShowCreate(false); setTitle(''); setSubtitle('')
      setLinkType('none'); setLinkTarget(''); setLinkError(''); setAudience('all')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/promo-banners/${id}/archive`),
    onSuccess: () => { toast.success('Banner archived'); qc.invalidateQueries({ queryKey: ['promo-banners'] }); setArchivingId(null) },
    onError: (e) => { toast.error(getErrorMessage(e)); setArchivingId(null) },
  })

  const applyStarter = (s: typeof STARTERS[0]) => {
    setTitle(s.title); setSubtitle(s.subtitle)
    setGradientFrom(s.preset.from); setGradientTo(s.preset.to)
    setLinkType('internal_route'); setLinkTarget(s.cta)
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Promo Studio</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">

        {/* Create / Starter pickers */}
        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center justify-center gap-2 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-white font-bold text-sm rounded-2xl py-3.5 active:scale-95 transition-all mb-5"
          >
            <Plus className="w-4 h-4" /> New Banner
          </button>
        ) : (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-5 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-green-900 dark:text-white font-bold text-sm">New banner</p>
              <button onClick={() => setShowCreate(false)} className="text-green-400 dark:text-night-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live preview */}
            <LivePreview title={title} subtitle={subtitle} from={gradientFrom} to={gradientTo} />

            {/* Quick starters */}
            <div>
              <p className="text-green-600 dark:text-night-200 text-[11px] font-bold uppercase tracking-wide mb-1.5">Quick start</p>
              <div className="flex gap-2 flex-wrap">
                {STARTERS.map(s => (
                  <button key={s.title} onClick={() => applyStarter(s)}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-green-50 dark:bg-night-600 text-green-700 dark:text-night-100 hover:bg-green-100 dark:hover:bg-night-500 transition-colors"
                  >
                    {s.title.split(',')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Title + subtitle */}
            <div className="space-y-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (required)"
                className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-2.5 text-sm text-green-900 dark:text-white bg-white dark:bg-night-600" />
              <input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Subtitle (optional)"
                className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-2.5 text-sm text-green-900 dark:text-white bg-white dark:bg-night-600" />
            </div>

            {/* Gradient presets */}
            <div>
              <p className="text-green-600 dark:text-night-200 text-[11px] font-bold uppercase tracking-wide mb-1.5">Color</p>
              <div className="flex gap-2 flex-wrap">
                {PRESETS.map(p => (
                  <button key={p.label} onClick={() => { setGradientFrom(p.from); setGradientTo(p.to) }}
                    title={p.label}
                    className={cn('h-8 w-12 rounded-xl border-2 transition-all', gradientFrom === p.from ? 'border-green-900 dark:border-white scale-105' : 'border-transparent')}
                    style={{ background: `linear-gradient(115deg, ${p.from}, ${p.to})` }}
                  />
                ))}
              </div>
            </div>

            {/* Audience */}
            <div>
              <p className="text-green-600 dark:text-night-200 text-[11px] font-bold uppercase tracking-wide mb-1.5">Show to</p>
              <div className="flex gap-2 flex-wrap">
                {(['all', 'customer', 'officer', 'service_worker'] as const).map(a => (
                  <button key={a} onClick={() => setAudience(a)}
                    className={cn('px-3 py-1.5 rounded-xl text-xs font-bold transition-colors',
                      audience === a ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900' : 'bg-green-50 dark:bg-night-600 text-green-600 dark:text-night-200')}
                  >
                    {a === 'all' ? 'Everyone' : a === 'customer' ? 'Customers' : a === 'officer' ? 'Officers' : 'Service Workers'}
                  </button>
                ))}
              </div>
            </div>

            {/* CTA link */}
            <div>
              <p className="text-green-600 dark:text-night-200 text-[11px] font-bold uppercase tracking-wide mb-1.5">CTA / Link</p>
              <div className="flex gap-2 mb-2">
                {(['none', 'internal_route', 'external_url'] as const).map(t => (
                  <button key={t} onClick={() => { setLinkType(t); setLinkTarget(''); setLinkError('') }}
                    className={cn('flex-1 py-2 rounded-xl text-xs font-bold',
                      linkType === t ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900' : 'bg-green-50 dark:bg-night-600 text-green-600 dark:text-night-200')}
                  >
                    {t === 'none' ? 'No link' : t === 'internal_route' ? 'In-app page' : 'External URL'}
                  </button>
                ))}
              </div>
              {linkType === 'internal_route' && (
                <select
                  value={linkTarget} onChange={e => { setLinkTarget(e.target.value); setLinkError('') }}
                  className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-2.5 text-sm text-green-900 dark:text-white bg-white dark:bg-night-600"
                >
                  <option value="">Select page…</option>
                  {INTERNAL_ROUTES.map(r => (
                    <option key={r.path} value={r.path}>{r.label}</option>
                  ))}
                </select>
              )}
              {linkType === 'external_url' && (
                <input
                  value={linkTarget} onChange={e => { setLinkTarget(e.target.value); setLinkError('') }}
                  placeholder="https://example.com"
                  className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-2.5 text-sm text-green-900 dark:text-white bg-white dark:bg-night-600"
                />
              )}
              {linkError && <p className="text-red-500 text-xs mt-1">{linkError}</p>}
            </div>

            {/* Submit */}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowCreate(false)} className="flex-1 border border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-sm rounded-full py-3">
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!title.trim() || createMutation.isPending}
                className="flex-1 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3 disabled:opacity-40"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Analytics summary */}
        {banners.length > 0 && (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
            <p className="text-green-700 dark:text-night-100 font-bold text-xs uppercase tracking-wide mb-3">Overall stats</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-green-900 dark:text-white font-extrabold text-lg">{banners.reduce((s, b) => s + b.impressions, 0).toLocaleString()}</p>
                <p className="text-green-400 dark:text-night-300 text-[11px]">Impressions</p>
              </div>
              <div>
                <p className="text-green-900 dark:text-white font-extrabold text-lg">{banners.reduce((s, b) => s + b.clicks, 0).toLocaleString()}</p>
                <p className="text-green-400 dark:text-night-300 text-[11px]">Clicks</p>
              </div>
              <div>
                <p className="text-green-900 dark:text-white font-extrabold text-lg">
                  {(() => { const i = banners.reduce((s, b) => s + b.impressions, 0); const c = banners.reduce((s, b) => s + b.clicks, 0); return i > 0 ? `${((c/i)*100).toFixed(1)}%` : '—' })()}
                </p>
                <p className="text-green-400 dark:text-night-300 text-[11px]">Avg CTR</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab strip */}
        <div className="flex gap-2 mb-3">
          {(['active', 'all'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('flex-1 py-2 rounded-xl text-xs font-bold transition-colors',
                tab === t ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900' : 'bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 text-green-600 dark:text-night-200')}
            >
              {t === 'active' ? `Active (${activeBanners.length})` : `All (${banners.length})`}
            </button>
          ))}
        </div>

        {/* Banner list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-40 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}
          </div>
        ) : displayed.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card text-center py-12 px-6">
            <TrendingUp className="w-10 h-10 text-green-200 dark:text-night-500 mx-auto mb-3" />
            <p className="text-green-500 dark:text-night-200 text-sm">
              {tab === 'active' ? 'No active banners — create one above.' : 'No banners yet — create your first.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map(b => (
              <BannerCard key={b.id} banner={b} onArchive={setArchivingId} />
            ))}
          </div>
        )}
      </div>

      {/* Archive confirmation modal */}
      {archivingId && archivingBanner && (
        <ArchiveConfirmModal
          banner={archivingBanner}
          onCancel={() => setArchivingId(null)}
          onConfirm={() => archiveMutation.mutate(archivingId)}
          isPending={archiveMutation.isPending}
        />
      )}
    </div>
  )
}
