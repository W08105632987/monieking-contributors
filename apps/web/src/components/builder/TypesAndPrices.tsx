import { useState } from 'react'
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react'
import type { TemplateSchema } from '@/lib/templateRules'
import {
  updateSelectorLabel, updateSelectorOption, parseNaira, isDefaultRule, updateRule, deleteRule, moveRule,
  addRule, describeRule, type PriceRule,
} from '@/lib/templateBuilder'
import { koboToNaira } from '@/lib/utils'
import { inputCls, labelCls, cardCls, smallBtn } from './builderUi'

function nairaText(kobo: number): string {
  return koboToNaira(kobo).toLocaleString('en-NG', { maximumFractionDigits: 2 })
}

/** A price box that keeps what you type and only commits a valid positive amount (never a made-up number). */
function PriceInput({ kobo, onCommit }: { kobo: number; onCommit: (k: number) => void }) {
  const [text, setText] = useState(nairaText(kobo))
  const [bad, setBad] = useState(false)
  return (
    <div>
      <div className="flex items-center gap-1">
        <span className="font-bold text-green-800 dark:text-night-100">₦</span>
        <input
          inputMode="decimal" value={text} aria-invalid={bad}
          className={`${inputCls} font-mono w-36 ${bad ? 'border-red-400' : ''}`}
          onChange={(e) => {
            setText(e.target.value)
            const k = parseNaira(e.target.value)
            setBad(k === null)
            if (k !== null) onCommit(k)
          }}
          onBlur={() => { if (bad) { setText(nairaText(kobo)); setBad(false) } }}
        />
      </div>
      {bad && <p className="text-[11px] text-red-600 mt-0.5">Enter an amount above ₦0 (max 2 decimals).</p>}
    </div>
  )
}

export function TypesEditor({ schema, onChange, locked }: { schema: TemplateSchema; onChange: (s: TemplateSchema) => void; locked: boolean }) {
  void locked   // labels and descriptions stay editable even on provider-connected services
  if (!schema.selectors.length) {
    return <p className="text-sm text-green-700 dark:text-night-200">This service has one form and one price. There are no types to choose between.</p>
  }
  return (
    <div className="space-y-4">
      {schema.selectors.map((sel) => (
        <div key={sel.key} className={cardCls}>
          <label className={labelCls}>Question shown to the customer</label>
          <input className={inputCls} value={sel.label} onChange={(e) => onChange(updateSelectorLabel(schema, sel.key, e.target.value))} />
          <div className="mt-3 space-y-3">
            {sel.options.map((o) => (
              <div key={o.value} className="rounded-xl bg-green-50/60 dark:bg-night-600/50 p-3 space-y-2">
                <input className={inputCls} value={o.label} aria-label="Option name"
                  onChange={(e) => onChange(updateSelectorOption(schema, sel.key, o.value, { label: e.target.value }))} />
                <input className={inputCls} value={o.description ?? ''} placeholder="Short description (optional)"
                  onChange={(e) => onChange(updateSelectorOption(schema, sel.key, o.value, { description: e.target.value }))} />
                <p className="text-[11px] text-green-500 dark:text-night-400">Permanent id: <code>{o.value}</code></p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-green-600 dark:text-night-300 mt-3">Adding or removing types isn't available yet. You can rename them and change their prices.</p>
        </div>
      ))}
    </div>
  )
}

export function PriceRulesEditor({
  schema, rules, onChange, hasQuantity,
}: { schema: TemplateSchema; rules: PriceRule[]; onChange: (r: PriceRule[]) => void; hasQuantity: boolean }) {
  const [pick, setPick] = useState<Record<string, string[]>>({})
  const [newPrice, setNewPrice] = useState('')
  const parsed = parseNaira(newPrice)
  const hasPick = Object.values(pick).some((v) => v.length)

  const toggle = (dim: string, v: string) =>
    setPick((p) => ({ ...p, [dim]: p[dim]?.includes(v) ? p[dim].filter((x) => x !== v) : [...(p[dim] ?? []), v] }))

  return (
    <div className="space-y-3">
      <p className="text-xs text-green-700 dark:text-night-200">
        The first rule that matches an order sets its price. The last rule is the default and always applies when nothing above it does.
      </p>
      {rules.map((r, i) => (
        <div key={`${i}:${JSON.stringify(r.when)}`} className={cardCls}>
          <p className="text-sm font-bold text-green-950 dark:text-white mb-2">{describeRule(schema, r)}</p>
          <div className="flex flex-wrap items-start gap-3">
            <PriceInput kobo={r.price_kobo} onCommit={(k) => onChange(updateRule(rules, i, { price_kobo: k }))} />
            {hasQuantity && (
              <label className="flex items-center gap-2 text-xs font-bold text-green-800 dark:text-night-100 mt-3">
                <input type="checkbox" checked={r.per === 'bulk_count'}
                  onChange={(e) => onChange(updateRule(rules, i, { per: e.target.checked ? 'bulk_count' : 'flat' }))} />
                Price is per item (multiplied by how many)
              </label>
            )}
          </div>
          {!isDefaultRule(r) && (
            <div className="flex gap-2 mt-3">
              <button className={smallBtn} onClick={() => onChange(moveRule(rules, i, -1))} aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button className={smallBtn} onClick={() => onChange(moveRule(rules, i, 1))} aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
              <button className={`${smallBtn} ml-auto text-red-600 border-red-200`} onClick={() => { if (window.confirm('Remove this price rule? Orders it matched will fall to a later rule.')) onChange(deleteRule(rules, i)) }}>
                <Trash2 className="inline w-3.5 h-3.5 mr-1" />Remove
              </button>
            </div>
          )}
        </div>
      ))}

      {schema.selectors.length > 0 && (
        <div className={cardCls}>
          <p className={labelCls}>Add a price for specific types</p>
          {schema.selectors.map((sel) => (
            <div key={sel.key} className="mb-2">
              <p className="text-xs font-bold text-green-800 dark:text-night-100 mb-1">{sel.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {sel.options.map((o) => {
                  const on = pick[sel.key]?.includes(o.value)
                  return (
                    <button key={o.value} type="button" onClick={() => toggle(sel.key, o.value)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold border ${on ? 'bg-green-700 text-white border-green-700' : 'border-green-200 dark:border-night-500 text-green-800 dark:text-night-100'}`}>
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-3">
            <span className="font-bold text-green-800 dark:text-night-100">₦</span>
            <input className={`${inputCls} font-mono w-36`} inputMode="decimal" placeholder="Price" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
            <button className={smallBtn} disabled={!hasPick || parsed === null}
              onClick={() => { onChange(addRule(rules, pick, parsed!, 'flat')); setPick({}); setNewPrice('') }}>
              <Plus className="inline w-3.5 h-3.5 mr-1" />Add price
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
