import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, ChevronRight } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { PromoBanner } from '@/types'

const PRESETS = [
  { from: '#052E16', to: '#D97706', label: 'Forest → Copper' },
  { from: '#1E3A8A', to: '#3B82F6', label: 'Deep Blue' },
  { from: '#7C2D12', to: '#EA580C', label: 'Ember' },
  { from: '#4C1D95', to: '#A855F7', label: 'Royal Purple' },
]

function LivePreview({ title, subtitle, from, to }: { title: string; subtitle: string; from: string; to: string }) {
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

export default function PromoBannersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [gradientFrom, setGradientFrom] = useState(PRESETS[0].from)
  const [gradientTo, setGradientTo] = useState(PRESETS[0].to)
  const [audience, setAudience] = useState<'all' | 'customer' | 'officer'>('all')

  const { data: banners = [], isLoading } = useQuery({
    queryKey: ['promo-banners'],
    queryFn: async () => { const { data } = await api.get<PromoBanner[]>('/promo-banners'); return data },
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/promo-banners', {
      title, subtitle: subtitle || null,
      gradient_from: gradientFrom, gradient_to: gradientTo,
      link_type: 'none', target_roles: audience,
    }),
    onSuccess: () => {
      toast.success('Banner created')
      qc.invalidateQueries({ queryKey: ['promo-banners'] })
      setShowCreate(false); setTitle(''); setSubtitle(''); setAudience('all')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/promo-banners/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['promo-banners'] }),
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/promo-banners/${id}`),
    onSuccess: () => { toast.success('Banner deleted'); qc.invalidateQueries({ queryKey: ['promo-banners'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white border border-green-100 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700" />
        </button>
        <h1 className="text-green-900 font-extrabold text-lg">Promo Banners</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center justify-center gap-2 bg-amber-400 text-green-900 font-bold text-sm rounded-2xl py-3.5 active:scale-95 transition-all mb-5"
          >
            <Plus className="w-4 h-4" /> New Banner
          </button>
        ) : (
          <div className="bg-white rounded-2xl border border-green-100 shadow-card p-4 mb-5">
            <p className="text-green-900 font-bold text-sm mb-3">New banner</p>

            <LivePreview title={title} subtitle={subtitle} from={gradientFrom} to={gradientTo} />

            <div className="mt-4 space-y-3">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title, e.g. Refer a friend"
                className="w-full border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-900" />
              <input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Subtitle (optional)"
                className="w-full border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-900" />

              <div className="flex gap-2">
                {PRESETS.map(p => (
                  <button key={p.label} onClick={() => { setGradientFrom(p.from); setGradientTo(p.to) }}
                    className={cn('flex-1 h-9 rounded-lg border-2', gradientFrom === p.from ? 'border-green-900' : 'border-transparent')}
                    style={{ background: `linear-gradient(115deg, ${p.from}, ${p.to})` }}
                    title={p.label}
                  />
                ))}
              </div>

              <div>
                <label className="text-green-700 text-xs font-bold uppercase tracking-wide block mb-1.5">Show to</label>
                <div className="flex gap-2">
                  {(['all', 'customer', 'officer'] as const).map(a => (
                    <button key={a} onClick={() => setAudience(a)}
                      className={cn('flex-1 py-2 rounded-xl text-xs font-bold',
                        audience === a ? 'bg-green-900 text-white' : 'bg-green-50 text-green-600')}
                    >
                      {a === 'all' ? 'Everyone' : a === 'customer' ? 'Customers' : 'Officers'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="flex-1 border border-green-200 text-green-700 font-bold text-sm rounded-full py-3">
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!title.trim() || createMutation.isPending}
                className="flex-1 bg-green-900 text-white font-bold text-sm rounded-full py-3 disabled:opacity-40"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        <p className="text-green-900 font-bold text-sm mb-3">All banners</p>
        {isLoading ? (
          <div className="h-24 bg-white rounded-2xl border border-green-100 animate-pulse" />
        ) : banners.length === 0 ? (
          <div className="bg-white rounded-2xl border border-green-100 shadow-card text-center py-10 px-6">
            <p className="text-green-500 text-sm">No banners yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {banners.map(b => (
              <div key={b.id} className="bg-white rounded-2xl border border-green-100 shadow-card p-3">
                <div className="rounded-xl overflow-hidden mb-2">
                  <LivePreview title={b.title} subtitle={b.subtitle ?? ''} from={b.gradient_from} to={b.gradient_to} />
                </div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleMutation.mutate({ id: b.id, is_active: !b.is_active })}
                    disabled={toggleMutation.isPending && toggleMutation.variables?.id === b.id}
                    className={cn('text-xs font-bold px-3 py-1.5 rounded-full disabled:opacity-60', b.is_active ? 'bg-green-100 text-green-700' : 'bg-green-50 text-green-400')}
                  >
                    {toggleMutation.isPending && toggleMutation.variables?.id === b.id
                      ? 'Updating…'
                      : b.is_active ? 'Active' : 'Inactive'}
                  </button>
                  <span className="text-green-400 text-xs capitalize">
                    {b.target_roles === 'all' ? 'Everyone' : `${b.target_roles}s only`}
                  </span>
                  <button
                    onClick={() => deleteMutation.mutate(b.id)}
                    disabled={deleteMutation.isPending && deleteMutation.variables === b.id}
                    className="flex items-center gap-1.5 text-xs font-bold text-red-500 bg-red-50 px-3 py-1.5 rounded-full disabled:opacity-60"
                  >
                    {deleteMutation.isPending && deleteMutation.variables === b.id ? (
                      'Removing…'
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
