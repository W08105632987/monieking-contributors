import { X } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { TIER_LABEL, type SlipOption, type SlipTier } from '@/lib/verification'

interface Props {
  options: SlipOption[]
  busyTier: SlipTier | null
  onPick: (o: SlipOption) => void
  onClose: () => void
}

/** Bottom sheet: pick a slip type. Prices come from the server; owned tiers re-download free. */
export function SlipChooser({ options, busyTier, onPick, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full bg-white dark:bg-night-700 rounded-t-3xl p-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Choose a slip"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-green-900 dark:text-white font-bold text-base">Choose a slip</h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-green-100 dark:bg-night-600 flex items-center justify-center">
            <X className="w-4 h-4 text-green-700 dark:text-night-100" />
          </button>
        </div>
        <div className="space-y-2.5">
          {options.map(o => (
            <button
              key={o.tier}
              disabled={busyTier !== null}
              onClick={() => onPick(o)}
              className="w-full flex items-center justify-between rounded-2xl border-2 border-green-100 dark:border-night-500 px-4 py-3.5 text-left disabled:opacity-50"
            >
              <span className="text-green-900 dark:text-white font-semibold text-sm">{TIER_LABEL[o.tier]} slip</span>
              <span className="text-green-700 dark:text-night-100 font-bold text-sm">
                {busyTier === o.tier ? 'Please wait…' : o.owned ? 'Download again (free)' : `Pay ${formatNaira(o.price)} & download`}
              </span>
            </button>
          ))}
        </div>
        <p className="text-green-500 dark:text-night-300 text-[11px] mt-3">Charged separately from the check itself. A slip you have bought can be downloaded again for free while the result is kept.</p>
      </div>
    </div>
  )
}
