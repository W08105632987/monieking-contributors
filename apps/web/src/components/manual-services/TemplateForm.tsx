import { useEffect, useMemo, useState } from 'react'
import type { ReactNode, SelectHTMLAttributes } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { FileUploadField } from './FileUploadField'
import { groupSections, normalizeLook, sectionDone, type LookId } from '@/lib/templateLooks'
import {
  visibleFields, missingRequired, stripHidden, parseNinList,
  type TemplateField, type TemplateSchema, type Answers,
} from '@/lib/templateRules'

/** What GET /service-templates/{code} returns for a service. */
export interface TemplateData {
  service_code: string
  title: string
  description: string | null
  is_enabled: boolean
  live: boolean
  version_id: string
  version: number
  schema: TemplateSchema
  price_matrix: Array<{ selections: Record<string, string>; price_kobo: number }>
}

/** Same shape the original forms hand to ManualServicePage, plus validation info. */
export interface TemplatePayload {
  service_type: string
  enrollment_bank?: string
  form_data: Record<string, any>
  uploaded_files: string[]
  bulk_count: number
  missing: string[]
  template_version_id: string
}

const inputBase =
  'w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 font-medium text-green-950 dark:text-white outline-none focus:border-green-500 transition-colors'
// The Classic strings are exactly what the form always used.
const INPUT: Record<LookId, string> = {
  classic: `${inputBase} px-4 py-3 text-sm`,
  compact: `${inputBase} px-3 py-2 text-[13px]`,
  guided: `${inputBase} px-4 py-3.5 text-base`,
}
const LABEL: Record<LookId, string> = {
  classic: 'block text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1.5',
  compact: 'block text-[10px] font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1',
  guided: 'block text-sm font-bold text-green-900 dark:text-night-100 mb-1.5',
}
const labelCls = LABEL.classic

const WIDTH_CLS: Record<string, string> = {
  full: 'col-span-6',
  half: 'col-span-6 md:col-span-3',
  third: 'col-span-6 md:col-span-2',
}

/** A dropdown with a visible arrow (the bare select hides the browser's own arrow). */
function SelectBox({ children, ic, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { ic: string }) {
  return (
    <div className="relative">
      <select {...props} className={`${ic} appearance-none pr-10`}>{children}</select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-600 dark:text-night-300" />
    </div>
  )
}

function priceFor(
  matrix: TemplateData['price_matrix'],
  selections: Record<string, string>,
): number | null {
  const hit = matrix.find((m) => Object.entries(selections).every(([k, v]) => m.selections[k] === v))
  return hit ? hit.price_kobo : null
}

function FieldInput({
  field, value, onChange, ic,
}: { field: TemplateField; value: unknown; onChange: (v: unknown) => void; ic: string }) {
  const inputCls = ic
  const str = typeof value === 'string' ? value : ''
  const ph = field.placeholder
  switch (field.type) {
    case 'textarea':
      return <textarea rows={3} value={str} placeholder={ph} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    case 'select':
      return (
        <SelectBox ic={ic} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(field.options ?? []).map((o) => {
            const v = typeof o === 'string' ? o : o.value
            const l = typeof o === 'string' ? o : o.label
            return <option key={v} value={v}>{l}</option>
          })}
        </SelectBox>
      )
    case 'date':
      return <input type="date" value={str} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    case 'phone':
      return <input type="tel" inputMode="tel" value={str} placeholder={ph} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    case 'email':
      return <input type="email" value={str} placeholder={ph} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    case 'digits':
      return (
        <input
          type="text" inputMode="numeric" maxLength={field.length} value={str} placeholder={ph}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          className={`${inputCls} font-mono`}
        />
      )
    case 'nin_list': {
      const text = Array.isArray(value) ? (value as string[]).join('\n') : str
      return (
        <textarea
          rows={6} value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph ?? 'One NIN per line, e.g.:\n12345678901\n98765432101'}
          className={`${inputCls} font-mono text-xs`}
        />
      )
    }
    case 'file':
      return (
        <FileUploadField
          label={field.label}
          helperText={field.help}
          required={!!field.required}
          value={str}
          onChange={(url) => onChange(url)}
          accept={field.accept ?? 'image/*,application/pdf'}
        />
      )
    default:
      return <input type="text" value={str} placeholder={ph} onChange={(e) => onChange(e.target.value)} className={inputCls} />
  }
}

export function TemplateForm({
  template, onChange,
}: { template: TemplateData; onChange: (payload: TemplatePayload) => void }) {
  const { schema, price_matrix: matrix } = template
  const look = normalizeLook(schema.look)
  const ic = INPUT[look]
  const lbl = LABEL[look]
  const [openStep, setOpenStep] = useState(0)

  // Every selector starts on its first option (the old forms did the same).
  const [answers, setAnswers] = useState<Answers>(() => {
    const init: Answers = {}
    for (const s of schema.selectors) init[s.key] = s.options[0]?.value ?? ''
    if (schema.fixed_service_type) init.service_type = schema.fixed_service_type
    return init
  })

  const set = (key: string, value: unknown) => setAnswers((prev) => ({ ...prev, [key]: value }))

  const shown = useMemo(() => visibleFields(schema, answers), [schema, answers])

  const ninCount = useMemo(() => {
    const q = schema.quantity_from
    if (!q) return 1
    const active = Object.entries(q.when).every(([k, v]) => String(answers[k]) === String(v))
    return active ? Math.max(1, parseNinList(answers[q.field]).length) : 1
  }, [schema, answers])

  useEffect(() => {
    const prepared: Answers = { ...answers }
    // nin_list fields travel as an array of valid NINs
    for (const f of schema.fields) {
      if (f.type === 'nin_list') prepared[f.key] = parseNinList(answers[f.key])
    }
    const missing = missingRequired(schema, prepared)
    const stripped = stripHidden(schema, prepared)
    const { service_type, enrollment_bank, ...rest } = stripped as Record<string, any>
    const files = (schema.uploaded_file_fields ?? []).map((k) => rest[k]).filter(Boolean) as string[]
    onChange({
      service_type: String(schema.fixed_service_type ?? service_type ?? ''),
      enrollment_bank: enrollment_bank ? String(enrollment_bank) : undefined,
      form_data: rest,
      uploaded_files: files,
      bulk_count: ninCount,
      missing,
      template_version_id: template.version_id,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, ninCount])

  // group the visible fields into titled sections, in the order the template lists them
  const sections = groupSections(shown)

  const optionPrice = (selKey: string, value: string): number | null => {
    const sels: Record<string, string> = {}
    for (const s of schema.selectors) sels[s.key] = String(answers[s.key] ?? '')
    sels[selKey] = value
    return priceFor(matrix, sels)
  }
  // Only show per-option prices when the choice actually changes the price.
  const pricesVary = (selKey: string): boolean => {
    const sel = schema.selectors.find((s) => s.key === selKey)
    if (!sel) return false
    const ps = new Set(sel.options.map((o) => optionPrice(selKey, o.value)))
    return ps.size > 1
  }

  const renderSelector = (sel: TemplateSchema['selectors'][number]) => {
    const showPrices = pricesVary(sel.key)
    const asDropdown = sel.key === 'enrollment_bank' || sel.options.length > 8
    const current = String(answers[sel.key] ?? '')
    const heading = (
      <p className={lbl}>{sel.label} {(sel.required ?? true) && <span className="text-red-500">*</span>}</p>
    )
    if (asDropdown) {
      return (
        <div key={sel.key} className="space-y-2">
          {heading}
          <SelectBox ic={ic} value={current} onChange={(e) => set(sel.key, e.target.value)}>
            {sel.options.map((o) => {
              const p = showPrices ? optionPrice(sel.key, o.value) : null
              return <option key={o.value} value={o.value}>{o.label}{p ? ` — ${formatNaira(p)}` : ''}</option>
            })}
          </SelectBox>
        </div>
      )
    }
    if (look === 'compact') {
      const chosenOpt = sel.options.find((o) => o.value === current)
      return (
        <div key={sel.key} className="space-y-1.5">
          {heading}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={sel.label}>
            {sel.options.map((o) => {
              const chosen = current === o.value
              const p = showPrices ? optionPrice(sel.key, o.value) : null
              return (
                <button
                  key={o.value} type="button" role="radio" aria-checked={chosen}
                  onClick={() => set(sel.key, o.value)}
                  className={`px-3 py-2 rounded-full border-2 text-[13px] font-bold transition-colors ${
                    chosen
                      ? 'border-green-600 bg-green-600 text-white'
                      : 'border-green-100 dark:border-night-600 bg-white dark:bg-night-700 text-green-900 dark:text-white hover:border-green-300'
                  }`}
                >
                  {o.label}{p ? <span className={`ml-1.5 font-extrabold ${chosen ? 'text-white' : 'text-green-700 dark:text-night-200'}`}>{formatNaira(p)}</span> : null}
                </button>
              )
            })}
          </div>
          {chosenOpt?.description && <p className="text-[11px] text-green-600 dark:text-night-300">{chosenOpt.description}</p>}
        </div>
      )
    }
    return (
      <div key={sel.key} className="space-y-2">
        {heading}
        {sel.options.map((o) => {
          const chosen = current === o.value
          const p = showPrices ? optionPrice(sel.key, o.value) : null
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => set(sel.key, o.value)}
              className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition-all ${
                chosen
                  ? 'border-green-600 bg-green-50 dark:bg-night-600 ring-1 ring-green-600'
                  : 'border-green-100 dark:border-night-600 bg-white dark:bg-night-700 hover:border-green-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] ${
                  chosen ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 dark:border-night-400'
                }`}>{chosen && '✓'}</span>
                <div>
                  <p className="text-sm font-bold text-green-950 dark:text-white">{o.label}</p>
                  {o.description && <p className="text-xs text-green-500 dark:text-night-300">{o.description}</p>}
                </div>
              </div>
              {p ? (
                <span className="text-sm font-extrabold text-green-700 dark:text-night-200 shrink-0 ml-2">
                  {formatNaira(p)}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    )
  }

  const renderFields = (fields: TemplateField[]) => (
    <div className={`grid grid-cols-6 ${look === 'compact' ? 'gap-2' : 'gap-3'}`}>
      {fields.map((f) => (
        <div key={f.key} className={WIDTH_CLS[f.width ?? 'full']}>
          {f.type !== 'file' && (
            <label className={lbl}>
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
          )}
          <FieldInput field={f} value={answers[f.key]} onChange={(v) => set(f.key, v)} ic={ic} />
          {f.type === 'nin_list' && (
            <p className="text-xs font-mono font-bold text-green-700 dark:text-night-300 mt-1">
              NINs entered: {parseNinList(answers[f.key]).length}{f.max_items ? ` / ${f.max_items} max` : ''}
            </p>
          )}
          {f.help && f.type !== 'file' && (
            <p className="text-[11px] text-green-600/80 dark:text-night-400 mt-1">{f.help}</p>
          )}
        </div>
      ))}
    </div>
  )

  // ── Compact: no boxes, a thin line between sections ──
  if (look === 'compact') {
    return (
      <div className="space-y-3">
        {schema.selectors.map(renderSelector)}
        {sections.map((sec, i) => (
          <div key={`${sec.title}-${i}`} className="border-t border-green-100 dark:border-night-600 pt-3 space-y-2">
            {sec.title && <p className="text-[11px] font-extrabold uppercase tracking-wider text-green-800 dark:text-night-100">{sec.title}</p>}
            {renderFields(sec.fields)}
          </div>
        ))}
      </div>
    )
  }

  // ── Step by step: one section open at a time. Every section stays mounted (hidden, not removed),
  //    so nothing a customer typed or uploaded is lost when they move on. ──
  if (look === 'guided') {
    type Step = { key: string; title: string; done: boolean; body: ReactNode }
    const steps: Step[] = []
    if (schema.selectors.length) {
      steps.push({
        key: 'choose', title: 'Choose an option', done: true,
        body: <div className="space-y-4">{schema.selectors.map(renderSelector)}</div>,
      })
    }
    sections.forEach((sec, i) => {
      steps.push({
        key: `${sec.title}-${i}`, title: sec.title ?? 'Details', done: sectionDone(sec.fields, answers),
        body: renderFields(sec.fields),
      })
    })
    const open = Math.min(openStep, Math.max(0, steps.length - 1))
    return (
      <div className="space-y-3">
        {steps.map((st, i) => {
          const isOpen = i === open
          return (
            <div key={st.key} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 overflow-hidden">
              <button
                type="button" onClick={() => setOpenStep(i)} aria-expanded={isOpen}
                className="w-full flex items-center gap-3 p-4 text-left"
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 ${
                  st.done && !isOpen ? 'bg-green-600 text-white' : 'bg-green-100 dark:bg-night-600 text-green-800 dark:text-night-100'
                }`}>{st.done && !isOpen ? <Check className="w-4 h-4" /> : i + 1}</span>
                <span className="flex-1 text-sm font-bold text-green-950 dark:text-white">{st.title}</span>
                <ChevronDown aria-hidden className={`w-4 h-4 text-green-600 dark:text-night-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className={isOpen ? 'px-4 pb-4 space-y-4' : 'hidden'}>
                {st.body}
                {i < steps.length - 1 && (
                  <button
                    type="button" onClick={() => setOpenStep(i + 1)}
                    className="w-full rounded-xl bg-green-600 text-white font-bold text-sm py-3"
                  >Next</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ── Classic: unchanged ──
  return (
    <div className="space-y-5">
      {schema.selectors.map(renderSelector)}

      {sections.map((sec, i) => (
        <div
          key={`${sec.title}-${i}`}
          className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4"
        >
          {sec.title && <p className={labelCls}>{sec.title}</p>}
          {renderFields(sec.fields)}
        </div>
      ))}
    </div>
  )
}
