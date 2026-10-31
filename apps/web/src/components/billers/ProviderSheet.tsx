import { sheetMotion } from '@/lib/motion'
import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronRight, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveBrand, rgba, type BillerBrand } from '@/lib/billerBrand'
import type { BillerGroup } from '@/lib/billCatalog'
import { BillerLogo } from './BillerLogo'

/**
 * "Select provider" — a single field that opens a full list in a bottom sheet (the way banking
 * apps do it), instead of a wall of cards on the page. Works for DISCOs, TV providers, exam bodies.
 */
export function ProviderSheet({ title = 'Select provider', placeholder = 'Choose a provider', groups, selectedKey, onSelect, emptyText = 'No providers available.', disabled, fallbackIcon }: {
  title?: string
  placeholder?: string
  groups: BillerGroup[]
  selectedKey: string | null
  onSelect: (group: BillerGroup) => void
  emptyText?: string
  disabled?: boolean
  fallbackIcon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = groups.find(g => g.key === selectedKey)
  const brand: BillerBrand | null = selected ? resolveBrand(selected.name) : null

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? groups.filter(g => g.name.toLowerCase().includes(q)) : groups
  }, [groups, query])

  function close() { setOpen(false); setQuery('') }

  return (
    <>
      <motion.button
        type="button" whileTap={{ scale: 0.985 }} disabled={disabled}
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 rounded-2xl border bg-white dark:bg-night-700 px-4 py-3.5 text-left disabled:opacity-50 border-green-100 dark:border-night-500"
        style={brand ? { borderColor: rgba(brand.main, 0.6), boxShadow: `0 6px 20px ${rgba(brand.main, 0.18)}` } : undefined}
      >
        {brand ? (
          <BillerLogo brand={brand} size={40} />
        ) : (
          <span className="w-10 h-10 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center text-green-600 dark:text-night-200">{fallbackIcon}</span>
        )}
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-green-500 dark:text-night-300">{title}</span>
          <span className={cn('block text-sm font-bold truncate', selected ? 'text-green-950 dark:text-white' : 'text-green-400 dark:text-night-300')}>
            {selected ? selected.name : placeholder}
          </span>
        </span>
        <ChevronRight className="w-4 h-4 text-green-500 dark:text-night-300 shrink-0" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-green-950/60" onClick={close} />
            <motion.div
              {...sheetMotion}
              className="relative bg-white dark:bg-night-800 rounded-t-3xl w-full max-w-lg max-h-[85dvh] flex flex-col"
            >
              <div className="px-5 pt-3 pb-3">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-green-100 dark:bg-night-500" />
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="flex-1 text-green-950 dark:text-white font-extrabold text-base">{title}</h2>
                  <button onClick={close} aria-label="Close" className="w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
                    <X className="w-4 h-4 text-green-600 dark:text-night-200" />
                  </button>
                </div>
                {groups.length > 6 && (
                  <div className="flex items-center gap-2 bg-green-50 dark:bg-night-700 rounded-xl px-3 py-2.5">
                    <Search className="w-4 h-4 text-green-500 dark:text-night-300" />
                    <input
                      value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${groups.length} providers`} autoFocus
                      className="flex-1 bg-transparent outline-none text-sm font-semibold text-green-950 dark:text-white placeholder:text-green-400"
                    />
                  </div>
                )}
              </div>

              <div className="overflow-y-auto px-3 pb-8">
                {groups.length === 0 && <p className="text-sm text-green-500 dark:text-night-300 text-center py-8">{emptyText}</p>}
                {groups.length > 0 && shown.length === 0 && <p className="text-sm text-green-500 dark:text-night-300 text-center py-8">Nothing matches “{query}”.</p>}
                {shown.map((g, i) => {
                  const b = resolveBrand(g.name)
                  const on = g.key === selectedKey
                  return (
                    <motion.button
                      key={g.key}
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
                      whileTap={{ scale: 0.985 }}
                      onClick={() => { onSelect(g); close() }}
                      className="w-full flex items-center gap-3 rounded-2xl px-3 py-3 text-left"
                      style={on ? { background: rgba(b.main, 0.12) } : undefined}
                    >
                      <BillerLogo brand={b} size={42} glow={on} />
                      <span className="flex-1 min-w-0 text-sm font-bold text-green-950 dark:text-white">{g.name}</span>
                      {on ? <Check className="w-5 h-5 shrink-0" style={{ color: b.main }} strokeWidth={3} /> : <ChevronRight className="w-4 h-4 text-green-300 dark:text-night-400 shrink-0" />}
                    </motion.button>
                  )
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
