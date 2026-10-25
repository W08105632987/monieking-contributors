import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveBrand, brandGradient, rgba } from '@/lib/billerBrand'
import type { BillerGroup } from '@/lib/billCatalog'
import { BillerLogo } from './BillerLogo'

/**
 * Logo grid for choosing a provider (DISCO, TV provider, exam body). The selected
 * card fills with the provider's own colours and glows; the rest stay quiet.
 * A search box appears automatically once the list is long.
 */
export function BillerPicker({ groups, selectedKey, onSelect, searchAfter = 8 }: {
  groups: BillerGroup[]
  selectedKey: string | null
  onSelect: (group: BillerGroup) => void
  searchAfter?: number
}) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? groups.filter(g => g.name.toLowerCase().includes(q)) : groups
  }, [groups, query])

  return (
    <div>
      {groups.length > searchAfter && (
        <div className="flex items-center gap-2 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-3.5 py-2.5 mb-3">
          <Search className="w-4 h-4 text-green-500 dark:text-night-300 shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${groups.length} providers`}
            className="flex-1 bg-transparent outline-none text-sm font-semibold text-green-950 dark:text-white placeholder:text-green-400"
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-green-500 dark:text-night-300 text-sm py-4 text-center">No provider matches “{query}”.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {shown.map((g, i) => {
            const brand = resolveBrand(g.name)
            const on = g.key === selectedKey
            return (
              <motion.button
                key={g.key}
                type="button"
                initial={{ opacity: 0, y: 14, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: Math.min(i, 12) * 0.035, type: 'spring', stiffness: 320, damping: 26 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => onSelect(g)}
                aria-pressed={on}
                className={cn(
                  'relative flex flex-col items-center gap-2 rounded-2xl border px-2 pt-3.5 pb-3 text-center overflow-hidden transition-colors',
                  on ? 'border-transparent' : 'bg-white dark:bg-night-700 border-green-100 dark:border-night-500',
                )}
                style={on ? { background: brandGradient(brand), boxShadow: `0 10px 28px ${rgba(brand.main, 0.45)}` } : undefined}
              >
                {on && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: `radial-gradient(circle at 50% 0%, ${rgba('#ffffff', 0.28)}, transparent 60%)` }}
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <BillerLogo brand={brand} size={52} glow={on} />
                <span
                  className={cn('relative text-[11px] font-bold leading-tight line-clamp-2', on ? '' : 'text-green-900 dark:text-white')}
                  style={on ? { color: brand.on } : undefined}
                >
                  {brand.key.startsWith('x-') ? g.name : brand.label}
                </span>
                {on && (
                  <motion.span
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white flex items-center justify-center"
                  >
                    <Check className="w-3 h-3" style={{ color: brand.deep }} strokeWidth={3.5} />
                  </motion.span>
                )}
              </motion.button>
            )
          })}
        </div>
      )}
    </div>
  )
}
