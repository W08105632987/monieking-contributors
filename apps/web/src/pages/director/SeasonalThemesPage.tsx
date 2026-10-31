import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import toast from '@/lib/notify'
import { getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSeasonalConfig, useUpdateSeasonal } from '@/hooks/useSeasonal'
import { activeSeason, DEFAULT_SEASONAL, SEASON_DECOR, seasonGreeting, type SeasonalConfig } from '@/lib/seasonal'

function Toggle({ on, busy, onChange, label, hint, emoji, sub }: {
  on: boolean; busy: boolean; onChange: (v: boolean) => void; label: string; hint: string; emoji: string; sub?: boolean
}) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={() => onChange(!on)}
      className={cn('w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left bg-white dark:bg-night-700 border-green-100 dark:border-night-500', sub && 'ml-6 w-[calc(100%-1.5rem)]')}>
      <span className="text-2xl">{emoji}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-green-950 dark:text-white">{label}</span>
        <span className="block text-[11px] text-green-600 dark:text-night-300">{hint}</span>
      </span>
      <span className={cn('relative h-6 w-11 rounded-full transition-colors', on ? 'bg-green-600' : 'bg-zinc-300 dark:bg-night-500')}>
        <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }} className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow" style={{ left: on ? 22 : 2 }} />
      </span>
    </button>
  )
}

export default function SeasonalThemesPage() {
  const nav = useNavigate()
  const { data } = useSeasonalConfig()
  const save = useUpdateSeasonal()
  const cfg = data ?? DEFAULT_SEASONAL
  const season = activeSeason(cfg)

  const set = (patch: Partial<SeasonalConfig>) =>
    save.mutate(patch, { onSuccess: () => toast.success('Theme updated — customers see it now'), onError: (e) => toast.error(getErrorMessage(e)) })

  return (
    <div className="min-h-dvh bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => nav(-1)} aria-label="Back" className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Seasonal themes</h1>
      </header>
      <div className="px-4 space-y-3 pb-32">
        <p className="text-xs text-green-700 dark:text-night-200">Switch a theme on and every screen gets light seasonal decoration. Only one shows at a time.</p>
        <Toggle emoji="🎄" label="Christmas" hint="Santa cap on the logo, twinkling lights, gentle snow, gifts and ornaments" on={cfg.christmas} busy={save.isPending} onChange={(v) => set({ christmas: v })} />
        <Toggle sub emoji="🎆" label="New Year (from 1 January)" hint="While Christmas is on, swaps to fireworks and confetti once January starts" on={cfg.new_year} busy={save.isPending || !cfg.christmas} onChange={(v) => set({ new_year: v })} />
        <Toggle emoji="🐣" label="Easter" hint="Bunting, painted eggs, chicks and flowers. Takes priority when on" on={cfg.easter} busy={save.isPending} onChange={(v) => set({ easter: v })} />

        <div className="rounded-2xl bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 p-4 text-center">
          <p className="text-[11px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">Showing right now</p>
          <p className="mt-1 text-sm font-bold text-green-950 dark:text-white">{season ? seasonGreeting(season) : 'Default look — no theme'}</p>
          {season && <p className="mt-0.5 text-[11px] text-green-600 dark:text-night-300">{SEASON_DECOR[season].hint}</p>}
          <p className="mt-2 text-[10px] text-green-500 dark:text-night-400">Optional artwork goes in public/seasonal/ (see docs/seasonal-image-prompts.md). Missing files are skipped. Decoration pauses for people who prefer reduced motion.</p>
        </div>
      </div>
    </div>
  )
}
