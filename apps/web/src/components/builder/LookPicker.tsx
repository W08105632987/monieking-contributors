import { Check } from 'lucide-react'
import { LOOKS, normalizeLook, setLook, type LookId } from '@/lib/templateLooks'
import type { TemplateSchema } from '@/lib/templateRules'
import { cardCls, labelCls } from './builderUi'

/** Tiny drawings so the director can see the difference at a glance. */
function Sketch({ id }: { id: LookId }) {
  const bar = 'rounded bg-green-200 dark:bg-night-500'
  if (id === 'compact') {
    return (
      <div className="space-y-1" aria-hidden>
        <div className="flex gap-1"><span className="h-2.5 w-8 rounded-full bg-green-600" /><span className="h-2.5 w-8 rounded-full bg-green-200 dark:bg-night-500" /></div>
        <div className="border-t border-green-200 dark:border-night-500 pt-1 space-y-1"><div className={`h-2 ${bar}`} /><div className={`h-2 ${bar}`} /><div className={`h-2 ${bar}`} /></div>
      </div>
    )
  }
  if (id === 'guided') {
    return (
      <div className="space-y-1" aria-hidden>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-600" /><span className={`h-2 flex-1 ${bar}`} /></div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-100 dark:bg-night-600" /><span className={`h-2 flex-1 ${bar}`} /></div>
        <div className="rounded border border-green-200 dark:border-night-500 p-1 space-y-1"><div className={`h-2 ${bar}`} /><div className="h-2.5 rounded bg-green-600" /></div>
      </div>
    )
  }
  return (
    <div className="space-y-1.5" aria-hidden>
      <div className="rounded-lg border border-green-300 dark:border-night-400 p-1.5 space-y-1"><div className={`h-2 ${bar}`} /><div className={`h-2 ${bar}`} /></div>
      <div className="rounded-lg border border-green-300 dark:border-night-400 p-1.5 space-y-1"><div className={`h-2 ${bar}`} /><div className={`h-2 ${bar}`} /></div>
    </div>
  )
}

export function LookPicker({ schema, onChange }: { schema: TemplateSchema; onChange: (s: TemplateSchema) => void }) {
  const current = normalizeLook(schema.look)
  return (
    <div className={cardCls}>
      <p className={labelCls}>Look of the order form</p>
      <p className="text-xs text-green-700 dark:text-night-200 mb-3">
        Only changes how the form is laid out for customers. What is asked and what is charged stay exactly the same.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Look of the order form">
        {LOOKS.map((l) => {
          const on = l.id === current
          return (
            <button
              key={l.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(setLook(schema, l.id))}
              className={`text-left rounded-2xl border-2 p-3 transition-colors ${on ? 'border-green-600 bg-green-50 dark:bg-night-600' : 'border-green-100 dark:border-night-600 hover:border-green-300'}`}
            >
              <div className="mb-2"><Sketch id={l.id} /></div>
              <p className="text-sm font-bold text-green-950 dark:text-white flex items-center gap-1">{l.name}{on && <Check className="w-4 h-4 text-green-600" />}</p>
              <p className="text-[11px] text-green-700 dark:text-night-300 mt-0.5">{l.blurb}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
