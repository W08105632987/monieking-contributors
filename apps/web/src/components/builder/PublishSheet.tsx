import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import type { TemplateSchema } from '@/lib/templateRules'
import type { PriceRule } from '@/lib/templateBuilder'
import { apiDetail, type Analysis, type PreviewResult } from '@/lib/templateBuilderApi'
import { Sheet, ChangeSummary, inputCls, labelCls, primaryBtn, smallBtn } from './builderUi'

export type PublishMode = { kind: 'publish' } | { kind: 'revert'; version: number }

/**
 * One sheet for both "publish my edits" and "go back to version N".
 * Nothing is saved until the director has seen every error, warning and price change and ticked the boxes.
 */
export function PublishSheet({
  open, onClose, mode, code, draftSchema, draftRules, currentSchema, baseVersion, onDone, onStale,
}: {
  open: boolean; onClose: () => void; mode: PublishMode; code: string
  draftSchema: TemplateSchema; draftRules: PriceRule[]; currentSchema: TemplateSchema
  baseVersion: number; onDone: () => void; onStale: () => void
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [note, setNote] = useState('')
  const [ack, setAck] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const reset = () => { setAnalysis(null); setNote(''); setAck(false); setConfirm(false) }

  // Publish: look first (dry run). Revert: the server's first answer is the look.
  const preview = useMutation({
    mutationFn: async () => (await api.post<PreviewResult>(`/service-templates/${code}/admin/preview`, {
      form_schema: draftSchema, price_rules: draftRules, base_version: baseVersion,
    })).data,
    onSuccess: (d) => setAnalysis(d),
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  useEffect(() => {
    if (open) { reset(); if (mode.kind === 'publish') preview.mutate() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const send = useMutation({
    mutationFn: async () => {
      const flags = { acknowledge_warnings: ack, confirm_price_change: confirm, base_version: baseVersion }
      if (mode.kind === 'publish') {
        return (await api.post(`/service-templates/${code}/admin/publish`, {
          form_schema: draftSchema, price_rules: draftRules, note: note.trim() || null, ...flags,
        })).data
      }
      return (await api.post(`/service-templates/${code}/admin/revert`, {
        version: mode.version, note: note.trim() || null, ...flags,
      })).data
    },
    onSuccess: (d: { version: number }) => {
      toast.success(mode.kind === 'publish' ? `Published version ${d.version}. It is live for new orders.` : `Went back. Now live as version ${d.version}.`)
      onDone()
      onClose()
    },
    onError: (e) => {
      const d = apiDetail(e)
      if (d?.code === 'stale_version') { toast.error(d.message ?? 'Someone else published first.'); onStale(); onClose(); return }
      if (d?.code === 'confirm_required' || d?.code === 'invalid') { setAnalysis(d as Analysis); return }
      toast.error(getErrorMessage(e))
    },
  })

  const needsConfirm = !!analysis?.needs_price_confirmation
  const needsAck = !!analysis?.warnings?.length
  const blocked = !!analysis?.errors?.length
  const ready = !blocked && (mode.kind === 'revert' || !!analysis)
  const canSend = ready && !send.isPending && (!needsConfirm || confirm) && (!needsAck || ack)
  const title = mode.kind === 'publish' ? 'Review & publish' : `Go back to version ${mode.version}`

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {mode.kind === 'publish' && !analysis && (
        <p className="text-sm text-green-700 dark:text-night-200">{preview.isPending ? 'Checking your changes…' : 'Could not check the changes. Close and try again.'}</p>
      )}
      {mode.kind === 'revert' && !analysis && (
        <p className="text-sm text-green-800 dark:text-night-100 mb-3">
          This publishes version {mode.version}'s form and prices as a <strong>new</strong> version. Nothing is deleted, and you can switch again afterwards.
        </p>
      )}
      {analysis && (
        <ChangeSummary analysis={analysis} schema={mode.kind === 'publish' ? draftSchema : currentSchema}
          ack={ack} onAck={setAck} confirm={confirm} onConfirm={setConfirm} />
      )}
      {ready && (
        <div className="mt-4">
          <label className={labelCls}>Note (optional, for the history)</label>
          <input className={inputCls} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Raised price for name change" />
          <p className="text-[11px] text-green-600 dark:text-night-300 mt-2">
            Goes live for new orders straight away. Orders already placed keep the form and price they were placed with.
          </p>
          <div className="flex gap-2 mt-4">
            <button className={`${primaryBtn} flex-1`} disabled={!canSend} onClick={() => send.mutate()}>
              {send.isPending ? 'Saving…' : mode.kind === 'publish' ? 'Publish now' : 'Go back to this version'}
            </button>
            <button className={smallBtn} onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}
      {blocked && <button className={`${smallBtn} mt-4`} onClick={onClose}>Back to editing</button>}
    </Sheet>
  )
}
