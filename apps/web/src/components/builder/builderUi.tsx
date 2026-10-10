import type { ReactNode } from 'react'
import { X, AlertTriangle, Info } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import type { TemplateSchema } from '@/lib/templateRules'
import { describeSelections, type Analysis } from '@/lib/templateBuilderApi'

export const inputCls =
  'w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-3 py-2.5 text-sm font-medium text-green-950 dark:text-white outline-none focus:border-green-500 transition-colors'
export const labelCls = 'block text-[11px] font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1'
export const cardCls = 'bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4'
export const smallBtn =
  'px-3 py-1.5 rounded-xl border border-green-200 dark:border-night-500 text-green-800 dark:text-night-100 text-xs font-bold disabled:opacity-40'
export const primaryBtn =
  'px-4 py-3 rounded-2xl bg-green-700 dark:bg-copper-500 text-white text-sm font-extrabold disabled:opacity-40'

/** Bottom sheet that scrolls (the shared Modal can't hold long content and has no dark mode). */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-green-950/60" onClick={onClose} />
      <div className="relative w-full md:max-w-lg max-h-[88dvh] overflow-y-auto bg-white dark:bg-night-800 rounded-t-3xl md:rounded-3xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-green-900 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-full bg-green-50 dark:bg-night-600 text-green-600 dark:text-night-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Errors (block), warnings (acknowledge) and price changes (confirm) from the server. */
export function ChangeSummary({
  analysis, schema, ack, onAck, confirm, onConfirm,
}: {
  analysis: Analysis; schema: TemplateSchema
  ack: boolean; onAck: (v: boolean) => void; confirm: boolean; onConfirm: (v: boolean) => void
}) {
  const nothing = !analysis.errors?.length && !analysis.warnings?.length && !analysis.price_changes?.length &&
    !analysis.added_fields?.length && !analysis.removed_fields?.length
  return (
    <div className="space-y-3 text-sm">
      {!!analysis.errors?.length && (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3">
          <p className="font-bold text-red-700 dark:text-red-300 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Fix these first</p>
          <ul className="list-disc pl-5 mt-1 text-red-700 dark:text-red-200 space-y-0.5">{analysis.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {!!analysis.price_changes?.length && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3">
          <p className="font-bold text-amber-800 dark:text-amber-200">Customers will pay a different price</p>
          <ul className="mt-1 space-y-1">
            {analysis.price_changes.map((c, i) => (
              <li key={i} className="flex justify-between gap-3 text-amber-900 dark:text-amber-100">
                <span>{describeSelections(schema, c.selections)}</span>
                <span className="font-mono font-bold shrink-0">
                  {c.before_kobo == null ? 'new' : formatNaira(c.before_kobo)} → {c.after_kobo == null ? 'removed' : formatNaira(c.after_kobo)}
                  {c.per_item_changed ? ' (per item)' : ''}
                </span>
              </li>
            ))}
          </ul>
          {analysis.price_changes_total > analysis.price_changes.length && (
            <p className="text-xs mt-1">…and {analysis.price_changes_total - analysis.price_changes.length} more.</p>
          )}
          <label className="flex items-start gap-2 mt-3 font-bold text-amber-900 dark:text-amber-100">
            <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => onConfirm(e.target.checked)} />
            <span>I understand the new prices go live for new orders immediately.</span>
          </label>
        </div>
      )}
      {!!analysis.warnings?.length && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 dark:bg-night-700 dark:border-night-500 p-3">
          <p className="font-bold text-amber-800 dark:text-amber-200">Please double-check</p>
          <ul className="list-disc pl-5 mt-1 text-amber-900 dark:text-night-100 space-y-0.5">{analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          <label className="flex items-start gap-2 mt-3 font-bold text-amber-900 dark:text-amber-100">
            <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => onAck(e.target.checked)} />
            <span>I've checked these and want to continue.</span>
          </label>
        </div>
      )}
      {!!analysis.added_fields?.length && (
        <p className="text-green-800 dark:text-night-100"><Info className="inline w-4 h-4 mr-1" />New fields: {analysis.added_fields.join(', ')}</p>
      )}
      {nothing && <p className="text-green-700 dark:text-night-200">No price changes. Nothing needs confirming.</p>}
    </div>
  )
}
