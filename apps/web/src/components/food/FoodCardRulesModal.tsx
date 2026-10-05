import { useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, X } from 'lucide-react'
import { api } from '@/lib/api'

interface FoodCardRulesModalProps {
  isOpen: boolean
  onClose: () => void
  onAccept: () => void
}

interface PackageItem {
  id: string
  name: string
  description: string | null
  icon: string | null
}

// Fallback used only if the fetch fails or hasn't resolved yet — the
// real source of truth is now /food-collections/package-items, director/
// admin-editable, shared with the year-end cost-entry step.
const FALLBACK_ITEMS: PackageItem[] = [
  { id: 'rice', name: '50kg Bag of Premium Rice', description: 'Long grain, stone-free polished rice', icon: '🌾' },
  { id: 'oil', name: '25L Pure Vegetable Cooking Oil', description: 'Heart-friendly refined cooking oil', icon: '🛢️' },
]

export function FoodCardRulesModal({ isOpen, onClose, onAccept }: FoodCardRulesModalProps) {
  const [hasAgreed, setHasAgreed] = useState(false)

  const { data: items } = useQuery({
    queryKey: ['food-package-items'],
    queryFn: async () => {
      const { data } = await api.get<PackageItem[]>('/food-collections/package-items')
      return data
    },
    enabled: isOpen,
    staleTime: 1000 * 60 * 10,
  })
  const condimentItems = items && items.length > 0 ? items : FALLBACK_ITEMS

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/70 backdrop-blur-md" />

      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-green-100 dark:border-night-600 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 dark:bg-amber-400/20 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl">
              🍱
            </div>
            <div>
              <h2 className="text-green-950 dark:text-white font-extrabold text-lg">Food Card Terms & Rules</h2>
              <p className="text-green-600 dark:text-night-200 text-xs">Compulsory rules for all food card contributors</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center text-green-700 dark:text-night-200 hover:bg-green-100 dark:hover:bg-night-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body content with smooth scroll */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 text-left">
          {/* Notice Banner */}
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-900 dark:text-amber-200 text-xs leading-relaxed">
              Please review these five compulsory conditions carefully. Starting a Food Contribution Card binds your contributions to the holiday food distribution policy.
            </p>
          </div>

          {/* Rule 1: Condiments list */}
          <div className="bg-green-50/70 dark:bg-night-800/60 rounded-2xl p-4 border border-green-100 dark:border-night-600">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-green-600 text-white font-bold text-xs flex items-center justify-center">1</span>
              <h3 className="text-green-950 dark:text-white font-bold text-sm">Designated Condiments Package</h3>
            </div>
            <p className="text-green-700 dark:text-night-200 text-xs mb-3">
              The food condiments distributed by MonieKing for this calendar year are as listed below:
            </p>
            <div className="space-y-2">
              {condimentItems.map((item) => (
                <div key={item.id} className="flex items-start gap-2.5 bg-white dark:bg-night-700 p-2.5 rounded-xl border border-green-100/80 dark:border-night-600">
                  <span className="text-lg">{item.icon || '🍽️'}</span>
                  <div>
                    <p className="text-green-900 dark:text-white font-bold text-xs">{item.name}</p>
                    {item.description && <p className="text-green-600 dark:text-night-300 text-[11px]">{item.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rule 2: Fixed Rate */}
          <div className="bg-green-50/70 dark:bg-night-800/60 rounded-2xl p-4 border border-green-100 dark:border-night-600">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-green-600 text-white font-bold text-xs flex items-center justify-center">2</span>
              <h3 className="text-green-950 dark:text-white font-bold text-sm">Fixed Daily Rate (₦1,000 / day)</h3>
            </div>
            <p className="text-green-700 dark:text-night-200 text-xs leading-relaxed">
              The food card contribution rate is non-adjustable and remains strictly fixed at <strong className="text-green-900 dark:text-white">₦1,000 per day</strong> for the entire duration of the cycle.
            </p>
          </div>

          {/* Rule 3: November 30 Deadline */}
          <div className="bg-green-50/70 dark:bg-night-800/60 rounded-2xl p-4 border border-green-100 dark:border-night-600">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-green-600 text-white font-bold text-xs flex items-center justify-center">3</span>
              <h3 className="text-green-950 dark:text-white font-bold text-sm">Completion Deadline (November 30)</h3>
            </div>
            <p className="text-green-700 dark:text-night-200 text-xs leading-relaxed">
              All food card contributors must finish all 12 contribution months (372 logical days) on or before <strong className="text-amber-600 dark:text-amber-400">November 30th</strong>. Unfinished cards past this cutoff will automatically convert into a regular cash savings card and forfeit food condiment distribution.
            </p>
          </div>

          {/* Rule 4: December 10 Distribution */}
          <div className="bg-green-50/70 dark:bg-night-800/60 rounded-2xl p-4 border border-green-100 dark:border-night-600">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-green-600 text-white font-bold text-xs flex items-center justify-center">4</span>
              <h3 className="text-green-950 dark:text-white font-bold text-sm">Distribution Day (December 10)</h3>
            </div>
            <p className="text-green-700 dark:text-night-200 text-xs leading-relaxed">
              All qualified food condiments will be distributed simultaneously on <strong className="text-green-900 dark:text-white">December 10th</strong> at designated MonieKing collection hubs and partner stations.
            </p>
          </div>

          {/* Rule 5: Collection & Verification Protocol */}
          <div className="bg-green-50/70 dark:bg-night-800/60 rounded-2xl p-4 border border-green-100 dark:border-night-600">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-green-600 text-white font-bold text-xs flex items-center justify-center">5</span>
              <h3 className="text-green-950 dark:text-white font-bold text-sm">Secure In-Person QR Verification</h3>
            </div>
            <p className="text-green-700 dark:text-night-200 text-xs leading-relaxed">
              On collection day, you will be assigned a designated pickup hub. You will present your encrypted Food Entitlement QR code along with your confidential 4-digit Collection PIN. Our verified distribution officer will scan and validate your claim on-site.
            </p>
          </div>

          {/* Agreement Checkbox */}
          <label className="flex items-start gap-3 p-3.5 bg-green-100/60 dark:bg-night-600/50 rounded-2xl cursor-pointer hover:bg-green-100 dark:hover:bg-night-600 transition-colors">
            <input
              type="checkbox"
              checked={hasAgreed}
              onChange={e => setHasAgreed(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-green-800 dark:accent-green-500 rounded cursor-pointer"
            />
            <span className="text-green-900 dark:text-white text-xs font-semibold leading-relaxed">
              I understand and agree to all 5 compulsory MonieKing Food Card rules and the November 30th completion deadline.
            </span>
          </label>
        </div>

        {/* Action Footer */}
        <div className="p-5 border-t border-green-100 dark:border-night-600 bg-white dark:bg-night-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-200 font-bold text-sm rounded-full py-3.5 hover:bg-green-50 dark:hover:bg-night-600 active:scale-95 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onAccept}
            disabled={!hasAgreed}
            className="flex-1 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-card flex items-center justify-center gap-2"
          >
            Accept & Continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </div>
  )
}
