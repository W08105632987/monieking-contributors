import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock } from 'lucide-react'
import { api } from '@/lib/api'
import { FallbackError } from '@/components/ui/FallbackError'
import { TemplateForm, type TemplateData } from '@/components/manual-services/TemplateForm'
import { FieldsEditor } from '@/components/builder/FieldsEditor'
import { TypesEditor, PriceRulesEditor } from '@/components/builder/TypesAndPrices'
import { PublishSheet, type PublishMode } from '@/components/builder/PublishSheet'
import { cardCls, primaryBtn, smallBtn, labelCls } from '@/components/builder/builderUi'
import type { TemplateSchema } from '@/lib/templateRules'
import { sameJson, type PriceRule } from '@/lib/templateBuilder'
import type { AdminTemplate, PreviewResult } from '@/lib/templateBuilderApi'

type Tab = 'fields' | 'prices' | 'preview' | 'history'
const TABS: Array<[Tab, string]> = [['fields', 'Fields'], ['prices', 'Types & prices'], ['preview', 'Preview'], ['history', 'History']]

export default function ServiceBuilderEditPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['service-template-admin', code],
    queryFn: async () => (await api.get<AdminTemplate>(`/service-templates/${code}/admin`)).data,
  })

  const [schema, setSchema] = useState<TemplateSchema | null>(null)
  const [rules, setRules] = useState<PriceRule[]>([])
  const [tab, setTab] = useState<Tab>('fields')
  const [resetKey, setResetKey] = useState(0)
  const [sheet, setSheet] = useState<PublishMode | null>(null)

  // (Re)start from the saved version whenever a different version is live (first load, after publish/revert).
  useEffect(() => {
    if (data) {
      setSchema(data.schema)
      setRules(data.price_rules as PriceRule[])
      setResetKey((k) => k + 1)
    }
  }, [data?.version_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!data && !!schema && (!sameJson(schema, data.schema) || !sameJson(rules, data.price_rules))

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Preview tab: exact prices come from the same engine that charges (server), for the DRAFT.
  const draftHash = useMemo(() => JSON.stringify([schema, rules]), [schema, rules])
  const preview = useQuery({
    queryKey: ['service-template-preview', code, draftHash],
    enabled: tab === 'preview' && !!schema,
    retry: false,
    queryFn: async () => (await api.post<PreviewResult>(`/service-templates/${code}/admin/preview`, { form_schema: schema, price_rules: rules })).data,
  })

  const discard = () => {
    if (!data || !window.confirm('Throw away your unpublished edits?')) return
    setSchema(data.schema)
    setRules(data.price_rules as PriceRule[])
    setResetKey((k) => k + 1)
  }
  const leave = () => {
    if (dirty && !window.confirm('You have unpublished edits that will be lost. Leave anyway?')) return
    navigate('/director/service-builder')
  }
  const refreshAfterChange = () => {
    qc.invalidateQueries({ queryKey: ['service-template-admin', code] })
    qc.invalidateQueries({ queryKey: ['service-templates'] })
    qc.invalidateQueries({ queryKey: ['service-template', code] })   // customers' copy of the form
  }

  if (isError) {
    return <div className="min-h-dvh bg-green-50 dark:bg-night-800 p-4"><FallbackError title="Couldn't load this service" onRetry={() => refetch()} isRetrying={isFetching} /></div>
  }
  if (isLoading || !data || !schema) {
    return <div className="min-h-dvh bg-green-50 dark:bg-night-800 p-4"><div className="h-24 bg-white dark:bg-night-700 rounded-2xl animate-pulse" /></div>
  }

  const locked = data.kind === 'api'
  const previewTemplate: TemplateData = {
    service_code: data.service_code, title: data.title, description: null, is_enabled: true, live: true,
    version_id: 'preview', version: data.version, schema: schema as TemplateSchema,
    price_matrix: preview.data?.draft_price_matrix ?? [],
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={leave} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center" aria-label="Back">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div className="min-w-0">
          <h1 className="text-green-900 dark:text-white font-bold text-lg truncate">{data.title}</h1>
          <p className="text-[11px] text-green-600 dark:text-night-300">Live version {data.version}{dirty ? ' · unpublished edits' : ''}</p>
        </div>
      </header>

      {locked && (
        <p className="mx-4 mb-2 text-xs text-green-800 dark:text-night-100 bg-white dark:bg-night-700 rounded-xl p-3 flex gap-2">
          <Lock className="w-4 h-4 shrink-0" />This service is connected to an outside provider. You can change labels, order, width, hints and help text, and the prices.
        </p>
      )}

      <div className="px-4 flex gap-1.5 overflow-x-auto pb-2">
        {TABS.map(([k, name]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border ${tab === k ? 'bg-green-700 text-white border-green-700' : 'border-green-200 dark:border-night-500 text-green-800 dark:text-night-100'}`}>
            {name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-40 space-y-4" key={resetKey}>
        {tab === 'fields' && <FieldsEditor schema={schema} onChange={setSchema} locked={locked} />}

        {tab === 'prices' && (
          <>
            <TypesEditor schema={schema} onChange={setSchema} locked={locked} />
            <PriceRulesEditor schema={schema} rules={rules} onChange={setRules} hasQuantity={!!schema.quantity_from} />
          </>
        )}

        {tab === 'preview' && (
          <div className="space-y-3">
            <p className="text-xs text-green-700 dark:text-night-200">This is what a customer would see with your edits. Nothing is submitted from here.</p>
            {!!preview.data?.errors?.length && (
              <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-200">
                <p className="font-bold">Prices are hidden until these are fixed:</p>
                <ul className="list-disc pl-5">{preview.data.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            <div className={cardCls}>
              <TemplateForm key={JSON.stringify(schema.selectors)} template={previewTemplate} onChange={() => undefined} />
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-2">
            <p className="text-xs text-green-700 dark:text-night-200">Every publish makes a new version; nothing is ever overwritten. Going back publishes the old version again as a new one.</p>
            {data.versions.map((v) => (
              <div key={v.id} className={`${cardCls} flex items-center gap-3`}>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-green-950 dark:text-white">Version {v.version}{v.version === data.version ? ' (live)' : ''}</p>
                  <p className="text-[11px] text-green-600 dark:text-night-300">{v.created_at ? new Date(v.created_at).toLocaleString() : ''}</p>
                  {v.note && <p className="text-xs text-green-800 dark:text-night-100 mt-0.5">{v.note}</p>}
                </div>
                {v.version !== data.version && (
                  <button className={smallBtn} onClick={() => {
                    if (dirty && !window.confirm('Your unpublished edits will stay here but are not part of this change. Continue?')) return
                    setSheet({ kind: 'revert', version: v.version })
                  }}>Go back to this</button>
                )}
              </div>
            ))}
            <p className={`${labelCls} pt-2`}>Archive</p>
            <p className="text-xs text-green-700 dark:text-night-200">To hide this service, switch it off and archive it from the service list.</p>
          </div>
        )}
      </div>

      {dirty && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-night-800 border-t border-green-100 dark:border-night-600 p-3 flex gap-2 pb-safe">
          <button className={smallBtn} onClick={discard}>Discard</button>
          <button className={`${primaryBtn} flex-1`} onClick={() => setSheet({ kind: 'publish' })}>Review & publish</button>
        </div>
      )}

      <PublishSheet
        open={!!sheet} onClose={() => setSheet(null)} mode={sheet ?? { kind: 'publish' }} code={code}
        draftSchema={schema} draftRules={rules} currentSchema={data.schema} baseVersion={data.version}
        onDone={refreshAfterChange} onStale={refreshAfterChange}
      />
    </div>
  )
}
