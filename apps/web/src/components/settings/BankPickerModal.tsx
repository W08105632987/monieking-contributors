import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, Check, Landmark } from 'lucide-react'
import { api } from '@/lib/api'

export interface Bank { name: string; code: string }

interface BankPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (bank: Bank) => void
  selectedCode?: string
}

/**
 * Full-page modal for picking a bank — not the browser's native <select>.
 * On open, shows nothing but a spinner + "Loading banks…" until the list
 * has fully arrived from the backend (which itself calls out to Monnify
 * live, so this can take a moment) — no skeleton rows, no partial list,
 * so there's never a half-loaded state to tap into by mistake.
 */
export function BankPickerModal({ open, onClose, onSelect, selectedCode }: BankPickerModalProps) {
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')

  const fetchBanks = useCallback(() => {
    setLoading(true)
    setError(false)
    api.get<Bank[]>('/users/banks')
      .then(({ data }) => setBanks([...data].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setBanks([])
    fetchBanks()
  }, [open, fetchBanks])

  const filtered = useMemo(() => {
    if (!query.trim()) return banks
    const q = query.trim().toLowerCase()
    return banks.filter(b => b.name.toLowerCase().includes(q))
  }, [banks, query])

  const grouped = useMemo(() => {
    const groups: Record<string, Bank[]> = {}
    for (const b of filtered) {
      const letter = /[A-Za-z]/.test(b.name[0] ?? '') ? b.name[0].toUpperCase() : '#'
      if (!groups[letter]) groups[letter] = []
      groups[letter].push(b)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-green-50 dark:bg-night-800 flex flex-col"
        >
          <header className="flex items-center gap-3 px-4 py-3 border-b border-green-100 dark:border-night-500 bg-white dark:bg-night-700 shrink-0">
            <button
              onClick={onClose}
              className="w-9 h-9 bg-green-50 dark:bg-night-600 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all"
            >
              <X className="w-5 h-5 text-green-700 dark:text-night-100" />
            </button>
            <div>
              <h1 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">Select your bank</h1>
              {!loading && !error && (
                <p className="text-green-400 dark:text-night-300 text-xs">{banks.length} banks available</p>
              )}
            </div>
          </header>

          {!loading && !error && banks.length > 0 && (
            <div className="px-4 py-3 bg-white dark:bg-night-700 border-b border-green-100 dark:border-night-500 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-green-400 dark:text-night-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search banks…"
                  className="w-full border-2 border-green-100 dark:border-night-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500 dark:focus:border-night-200 bg-green-50 dark:bg-night-800"
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-6">
                <div className="w-10 h-10 border-[3px] border-green-100 dark:border-night-500 border-t-green-700 dark:border-t-copper-400 rounded-full animate-spin" />
                <p className="text-green-700 dark:text-night-100 text-sm font-bold">Loading banks…</p>
                <p className="text-green-400 dark:text-night-300 text-xs text-center max-w-[220px]">
                  Fetching the current list from your bank partner — just a moment.
                </p>
              </div>
            )}

            {!loading && error && (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <Landmark className="w-10 h-10 text-green-200 dark:text-night-500" />
                <p className="text-green-900 dark:text-white font-bold text-sm">Couldn't load the bank list</p>
                <p className="text-green-400 dark:text-night-300 text-xs">Check your connection and try again.</p>
                <button
                  onClick={fetchBanks}
                  className="mt-2 bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-sm rounded-full px-6 py-2.5 active:scale-95 transition-all"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
                <Search className="w-8 h-8 text-green-200 dark:text-night-500" />
                <p className="text-green-500 dark:text-night-300 text-sm font-semibold">No banks match "{query}"</p>
              </div>
            )}

            {!loading && !error && grouped.map(([letter, list]) => (
              <div key={letter}>
                {/* Was `backdrop-blur-sm` on every one of these sticky
                    headers — sticky positioning ALREADY forces Chrome
                    to redo compositing work as each one crosses into
                    place during scroll; stacking a blur filter on top
                    of that is expensive per-frame work that compounds
                    with every group already scrolled past, which is
                    exactly why it got worse further down the
                    alphabet. A plain solid background costs the
                    compositor almost nothing by comparison — same
                    visual effect (opaque header row), none of the
                    per-frame blur recalculation. */}
                <div className="sticky top-0 z-10 bg-green-100 dark:bg-night-600 px-4 py-1.5 text-green-700 dark:text-night-100 text-xs font-extrabold">
                  {letter}
                </div>
                {list.map(bank => (
                  <button
                    key={bank.code}
                    onClick={() => { onSelect(bank); onClose() }}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-night-700 border-b border-green-50 dark:border-night-600 active:bg-green-50 dark:active:bg-white/5 transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-full bg-green-900 dark:bg-copper-400 flex items-center justify-center font-bold text-amber-400 dark:text-green-950 text-xs flex-shrink-0">
                      {bank.name.slice(0, 2).toUpperCase()}
                    </div>
                    <p className="flex-1 min-w-0 text-green-900 dark:text-white text-sm font-semibold truncate">{bank.name}</p>
                    {selectedCode === bank.code && <Check className="w-4 h-4 text-green-600 dark:text-green-300 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
