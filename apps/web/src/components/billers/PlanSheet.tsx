import { sheetMotion } from '@/lib/motion'
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn, formatNaira } from '@/lib/utils'
import { brandGradient, rgba, type BillerBrand } from '@/lib/billerBrand'
import type { Biller } from '@/types'
import { BillerLogo } from './BillerLogo'

/**
 * "Pick one" control for long product lists (TV bouquets, education packages,
 * meter types). Shows the current choice as a tappable card; tapping opens a
 * bottom sheet with search and the whole list.
 */
export function PlanSheet({ title, placeholder, brand, plans, selectedId, onSelect }: {
  title: string
  placeholder: string
  brand: BillerBrand
  plans: Biller[]
  selectedId: string | null
  onSelect: (plan: Biller) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = plans.find(p => p.id === selectedId)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? plans.filter(p => p.product_name.toLowerCase().includes(q)) : plans
  }, [plans, query])

  function close() { setOpen(false); setQuery('') }

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left bg-white dark:bg-night-700 border-green-100 dark:border-night-500"
        style={selected ? { borderColor: rgba(brand.main, 0.7), boxShadow: `0 6px 22px ${rgba(brand.main, 0.22)}` } : undefined}
      >
        <BillerLogo brand={brand} size={38} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-green-500 dark:text-night-300">{title}</p>
          <p className={cn('text-sm font-bold truncate', selected ? 'text-green-950 dark:text-white' : 'text-green-400 dark:text-night-300')}>
            {selected ? selected.product_name : placeholder}
          </p>
        </div>
        {selected?.price_kobo != null && <span className="text-sm font-extrabold text-green-800 dark:text-night-100 shrink-0">{formatNaira(selected.price_kobo)}</span>}
        <ChevronDown className="w-4 h-4 text-green-500 dark:text-night-300 shrink-0" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-green-950/60" onClick={close}
            />
            <motion.div
              {...sheetMotion}
              className="relative bg-white dark:bg-night-800 rounded-t-3xl w-full max-w-lg max-h-[82dvh] flex flex-col"
            >
              <div className="px-5 pt-5 pb-3" style={{ background: `linear-gradient(180deg, ${rgba(brand.main, 0.16)}, transparent)` }}>
                <div className="flex items-center gap-3 mb-3">
                  <BillerLogo brand={brand} size={36} glow />
                  <h2 className="flex-1 text-green-950 dark:text-white font-extrabold text-base">{title}</h2>
                  <button onClick={close} aria-label="Close" className="w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
                    <X className="w-4 h-4 text-green-600 dark:text-night-200" />
                  </button>
                </div>
                {plans.length > 6 && (
                  <div className="flex items-center gap-2 bg-green-50 dark:bg-night-700 rounded-xl px-3 py-2.5">
                    <Search className="w-4 h-4 text-green-500 dark:text-night-300" />
                    <input
                      value={query} onChange={e => setQuery(e.target.value)} placeholder="Search"
                      className="flex-1 bg-transparent outline-none text-sm font-semibold text-green-950 dark:text-white"
                    />
                  </div>
                )}
              </div>
              <div className="overflow-y-auto px-4 pb-8 space-y-2">
                {shown.length === 0 && <p className="text-sm text-green-500 dark:text-night-300 text-center py-6">Nothing matches “{query}”.</p>}
                {shown.map((p, i) => {
                  const on = p.id === selectedId
                  return (
                    <motion.button
                      key={p.id}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 10) * 0.025 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => { onSelect(p); close() }}
                      className={cn('w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left',
                        on ? 'border-transparent' : 'bg-white dark:bg-night-700 border-green-100 dark:border-night-500')}
                      style={on ? { background: brandGradient(brand), color: brand.on } : undefined}
                    >
                      <span className={cn('flex-1 text-sm font-bold', on ? '' : 'text-green-900 dark:text-white')}>{p.product_name}</span>
                      {p.price_kobo != null && <span className={cn('text-sm font-extrabold shrink-0', on ? '' : 'text-green-700 dark:text-night-200')}>{formatNaira(p.price_kobo)}</span>}
                      {on && <Check className="w-4 h-4 shrink-0" strokeWidth={3} />}
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
