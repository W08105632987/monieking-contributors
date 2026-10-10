import { useState } from 'react'
import { ArrowUp, ArrowDown, Trash2, ChevronDown, ChevronUp, Lock, Plus } from 'lucide-react'
import type { TemplateField, TemplateSchema, VisibilityRule } from '@/lib/templateRules'
import {
  ADDABLE_FIELD_TYPES, addField, removeField, updateField, moveField, dependents,
  optionsFromText, optionsToText, hasPlainOptions, conditionCandidates, setConditions,
} from '@/lib/templateBuilder'
import { inputCls, labelCls, cardCls, smallBtn } from './builderUi'

const TYPE_NAME: Record<string, string> = {
  text: 'Short text', textarea: 'Long text', phone: 'Phone', email: 'Email', date: 'Date',
  select: 'Dropdown', digits: 'Digits', file: 'File upload', nin_list: 'NIN list',
}

function conditionText(schema: TemplateSchema, f: TemplateField): string | null {
  if (!f.visible_when?.length) return null
  const label = (key: string) => schema.selectors.find((s) => s.key === key)?.label ?? schema.fields.find((x) => x.key === key)?.label ?? key
  const val = (key: string, v: string) => schema.selectors.find((s) => s.key === key)?.options.find((o) => o.value === v)?.label ?? v
  return f.visible_when
    .map((c) => `${label(c.field)} ${c.not_in ? 'is not' : 'is'} ${(c.in ?? c.not_in ?? []).map((v) => val(c.field, v)).join(' or ')}`)
    .join(' and ')
}


/** "Show this field only when…": ties a field to a type question or a dropdown (rules are ANDed). */
function ConditionsEditor({
  field, schema, locked, onChange,
}: { field: TemplateField; schema: TemplateSchema; locked: boolean; onChange: (conds: VisibilityRule[]) => void }) {
  const conds = field.visible_when ?? []
  const choices = conditionCandidates(schema, field.key)
  if (locked) {
    const text = conditionText(schema, field)
    return text ? <p className="text-xs text-green-700 dark:text-night-200 bg-green-50 dark:bg-night-600 rounded-xl p-2">Shown only when: {text}</p> : null
  }
  if (!conds.length && !choices.length) return null
  const update = (i: number, next: VisibilityRule) => onChange(conds.map((c, j) => (j === i ? next : c)))
  const toggleValue = (i: number, c: VisibilityRule, v: string) => {
    const mode: 'in' | 'not_in' = c.in ? 'in' : 'not_in'
    const list = (c[mode] ?? []) as string[]
    const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
    if (!next.length) return                       // keep at least one value; use "Remove rule" to drop the rule
    update(i, { field: c.field, [mode]: next } as VisibilityRule)
  }
  return (
    <div className="rounded-xl bg-green-50 dark:bg-night-600 p-3 space-y-2">
      <p className={labelCls}>Show this field only when…</p>
      {!conds.length && <p className="text-xs text-green-700 dark:text-night-200">Always shown.</p>}
      {conds.map((c, i) => {
        const choice = choices.find((x) => x.key === c.field)
        const mode: 'in' | 'not_in' = c.in ? 'in' : 'not_in'
        const chosen = (c[mode] ?? []) as string[]
        return (
          <div key={i} className="rounded-xl bg-white dark:bg-night-700 p-2 space-y-2">
            <div className="flex gap-2">
              <select className={inputCls} value={c.field}
                onChange={(e) => {
                  const first = choices.find((x) => x.key === e.target.value)?.options[0]?.value
                  update(i, { field: e.target.value, [mode]: first ? [first] : [] } as VisibilityRule)
                }}>
                {!choice && <option value={c.field}>{c.field}</option>}
                {choices.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              <select className={`${inputCls} w-28`} value={mode}
                onChange={(e) => update(i, { field: c.field, [e.target.value]: chosen } as VisibilityRule)}>
                <option value="in">is</option><option value="not_in">is not</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(choice?.options ?? []).map((o) => {
                const on = chosen.includes(o.value)
                return (
                  <button key={o.value} type="button" onClick={() => toggleValue(i, c, o.value)}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold border ${on ? 'bg-green-700 text-white border-green-700' : 'border-green-200 dark:border-night-500 text-green-800 dark:text-night-100'}`}>
                    {o.label}
                  </button>
                )
              })}
            </div>
            <button type="button" className={`${smallBtn} text-red-600 border-red-200`} onClick={() => onChange(conds.filter((_, j) => j !== i))}>Remove rule</button>
          </div>
        )
      })}
      {choices.length > 0 && (
        <button type="button" className={smallBtn}
          onClick={() => {
            const first = choices[0].options[0]?.value
            if (first) onChange([...conds, { field: choices[0].key, in: [first] }])
          }}>
          <Plus className="inline w-3.5 h-3.5 mr-1" />Add a rule
        </button>
      )}
    </div>
  )
}

function FieldCard({
  field, schema, locked, onChange, onConditions, onMove, onRemove,
}: {
  field: TemplateField; schema: TemplateSchema; locked: boolean
  onChange: (key: string, patch: Parameters<typeof updateField>[2]) => void
  onConditions: (key: string, conds: VisibilityRule[]) => void
  onMove: (key: string, dir: -1 | 1) => void
  onRemove: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const cond = conditionText(schema, field)
  const canHint = !['select', 'file', 'date'].includes(field.type)
  return (
    <div className={cardCls}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-2 text-left">
        <div className="min-w-0">
          <p className="font-bold text-sm text-green-950 dark:text-white truncate">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </p>
          <p className="text-[11px] text-green-600 dark:text-night-300">
            {TYPE_NAME[field.type] ?? field.type}{field.width && field.width !== 'full' ? ` · ${field.width} width` : ''}
            {cond ? ' · conditional' : ''}
          </p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-green-50 dark:border-night-600 pt-3">
          <div>
            <label className={labelCls}>Label</label>
            <input className={inputCls} value={field.label} onChange={(e) => onChange(field.key, { label: e.target.value })} />
          </div>
          {canHint && (
            <div>
              <label className={labelCls}>Hint inside the box</label>
              <input className={inputCls} value={field.placeholder ?? ''} placeholder="e.g. John" maxLength={120}
                onChange={(e) => onChange(field.key, { placeholder: e.target.value })} />
            </div>
          )}
          <div>
            <label className={labelCls}>Help text under the box</label>
            <input className={inputCls} value={field.help ?? ''} maxLength={300}
              onChange={(e) => onChange(field.key, { help: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Width</label>
              <select className={inputCls} value={field.width ?? 'full'} onChange={(e) => onChange(field.key, { width: e.target.value as TemplateField['width'] })}>
                <option value="full">Full</option><option value="half">Half</option><option value="third">Third</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Section title</label>
              <input className={inputCls} value={field.section ?? ''} onChange={(e) => onChange(field.key, { section: e.target.value })} />
            </div>
          </div>
          {!locked && (
            <label className="flex items-center gap-2 text-sm font-bold text-green-900 dark:text-white">
              <input type="checkbox" checked={!!field.required} onChange={(e) => onChange(field.key, { required: e.target.checked })} />
              Customer must fill this in
            </label>
          )}
          {field.type === 'select' && (
            hasPlainOptions(field) && !locked ? (
              <div>
                <label className={labelCls}>Choices (one per line)</label>
                <textarea rows={5} className={inputCls} defaultValue={optionsToText(field.options)}
                  onBlur={(e) => { const o = optionsFromText(e.target.value); if (o.length) onChange(field.key, { options: o }) }} />
              </div>
            ) : (
              <p className="text-xs text-green-600 dark:text-night-300 flex items-center gap-1"><Lock className="w-3 h-3" /> The choices for this dropdown are managed by the system.</p>
            )
          )}
          <ConditionsEditor field={field} schema={schema} locked={locked} onChange={(c) => onConditions(field.key, c)} />
          <p className="text-[11px] text-green-500 dark:text-night-400 flex items-center gap-1"><Lock className="w-3 h-3" /> Permanent id: <code>{field.key}</code>{field.sensitive ? ' · private (masked for workers)' : ''}</p>
          <div className="flex items-center gap-2">
            <button type="button" className={smallBtn} onClick={() => onMove(field.key, -1)} aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
            <button type="button" className={smallBtn} onClick={() => onMove(field.key, 1)} aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
            {!locked && (
              <button type="button" className={`${smallBtn} ml-auto text-red-600 border-red-200`} onClick={() => onRemove(field.key)}>
                <Trash2 className="inline w-3.5 h-3.5 mr-1" />Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function FieldsEditor({
  schema, onChange, locked,
}: { schema: TemplateSchema; onChange: (s: TemplateSchema) => void; locked: boolean }) {
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<TemplateField['type']>('text')

  const remove = (key: string) => {
    const deps = dependents(schema, key)
    const f = schema.fields.find((x) => x.key === key)
    const msg = `Remove "${f?.label}"? New orders won't ask for it; older orders keep their answers.` +
      (deps.length ? `\n\n${deps.join(', ')} only show when this field has a value, so they will always be visible afterwards.` : '')
    if (window.confirm(msg)) onChange(removeField(schema, key))
  }

  // group consecutive fields by section for display
  const groups: Array<{ title: string | null; fields: TemplateField[] }> = []
  for (const f of schema.fields) {
    const t = f.section ?? null
    const last = groups[groups.length - 1]
    if (last && last.title === t) last.fields.push(f)
    else groups.push({ title: t, fields: [f] })
  }

  return (
    <div className="space-y-4">
      {groups.map((g, i) => (
        <div key={`${g.title}-${i}`} className="space-y-2">
          {g.title && <p className={labelCls}>{g.title}</p>}
          {g.fields.map((f) => (
            <FieldCard key={f.key} field={f} schema={schema} locked={locked}
              onChange={(k, p) => onChange(updateField(schema, k, p))}
              onConditions={(k, c) => onChange(setConditions(schema, k, c))}
              onMove={(k, d) => onChange(moveField(schema, k, d))}
              onRemove={remove} />
          ))}
        </div>
      ))}
      {!locked && (
        <div className={cardCls}>
          <p className={labelCls}>Add a field</p>
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Label, e.g. Mother's name" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <select className={`${inputCls} w-40`} value={newType} onChange={(e) => setNewType(e.target.value as TemplateField['type'])}>
              {ADDABLE_FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </div>
          <button type="button" disabled={!newLabel.trim()} className={`${smallBtn} mt-3`}
            onClick={() => { onChange(addField(schema, newType, newLabel).schema); setNewLabel('') }}>
            <Plus className="inline w-3.5 h-3.5 mr-1" />Add field
          </button>
        </div>
      )}
    </div>
  )
}
