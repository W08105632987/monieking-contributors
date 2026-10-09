import axios from 'axios'
import type { TemplateSchema } from './templateRules'
import type { PriceRule } from './templateBuilder'

export interface AdminTemplate {
  service_code: string
  title: string
  kind: 'manual' | 'api'
  is_enabled: boolean
  version_id: string
  version: number
  schema: TemplateSchema
  price_rules: PriceRule[]
  schema_errors: string[]
  price_errors: string[]
  price_warnings: string[]
  versions: Array<{ id: string; version: number; note: string | null; created_at: string | null }>
}

export interface PriceChange {
  selections: Record<string, string>
  before_kobo: number | null
  after_kobo: number | null
  per_item_changed: boolean
}

/** What the server says about a draft (preview) or a refused publish. */
export interface Analysis {
  errors: string[]
  warnings: string[]
  price_changes: PriceChange[]
  price_changes_total: number
  added_fields: string[]
  removed_fields: string[]
  needs_price_confirmation: boolean
}

export interface PreviewResult extends Analysis {
  current_version: number
  draft_price_matrix: Array<{ selections: Record<string, string>; price_kobo: number }>
}

export interface TemplateListRow {
  service_code: string
  title: string
  kind: 'manual' | 'api'
  is_enabled: boolean
  live: boolean
  archived: boolean
  version: number | null
  updated_at: string | null
}

/** The structured `detail` of a refused publish: { code, message, ...analysis } (or null for other errors). */
export function apiDetail(err: unknown): (Partial<Analysis> & { code?: string; message?: string; current_version?: number }) | null {
  if (!axios.isAxiosError(err)) return null
  const d = (err.response?.data as any)?.detail
  return d && typeof d === 'object' && !Array.isArray(d) ? d : null
}

/** 'Validation Type: SIM Validation' for a selection, or 'Standard price' when nothing is selected. */
export function describeSelections(schema: TemplateSchema, selections: Record<string, string>): string {
  const parts = Object.entries(selections).map(([dim, v]) => {
    const sel = schema.selectors.find((s) => s.key === dim)
    return sel?.options.find((o) => o.value === v)?.label ?? v
  })
  return parts.length ? parts.join(' · ') : 'Standard price'
}
