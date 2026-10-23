import { useState } from 'react'
import { BadgeCheck, CalendarClock, ChevronDown, HelpCircle, Lock } from 'lucide-react'
import { post, useCoopAction } from '../api'
import { BigButton, Card, Field, Pill, SectionTitle, Sheet, Skel, dShort, inputCls } from '../ui'
import { showValue, useAdmin, type AccountantPending, type SettingItem } from './dapi'

const toStored = (s: SettingItem, v: string) => (s.kind === 'kobo' ? String(Math.round(Number(v) * 100)) : s.kind === 'bps' ? String(Math.round(Number(v) * 100)) : v)
const fromStored = (s: SettingItem) => (s.kind === 'kobo' || s.kind === 'bps' ? String(Number(s.value) / 100) : s.value)

export default function SettingsTab() {
  const { data } = useAdmin<{ groups: string[]; settings: SettingItem[]; accountant_pending: AccountantPending | null; guide?: { provisional: string; effects: Record<string, string> } }>('settings', '/coop/admin/settings')
  const acc = data?.accountant_pending ?? null
  const { data: dirs } = useAdmin<{ id: string; name: string; is_accountant: boolean }[]>('directors', '/coop/admin/directors')
  const { data: hist } = useAdmin<any[]>('history', '/coop/admin/settings/history')
  const [open, setOpen] = useState<string | null>('Loans')
  const [edit, setEdit] = useState<SettingItem | null>(null)
  const [onlyProv, setOnlyProv] = useState(false)
  const [guide, setGuide] = useState(false)
  const [helpOpen, setHelpOpen] = useState<string | null>(null)
  const [confirmFor, setConfirmFor] = useState<SettingItem | null>(null)
  const [val, setVal] = useState('')
  const [why, setWhy] = useState('')
  const propose = useCoopAction((v: { key: string; value: string; reason: string }) => post(`/coop/admin/settings/${v.key}/propose`, { value: v.value, reason: v.reason }), {
    success: 'Change proposed', onSuccess: () => { setEdit(null); setWhy('') },
  })
  const confirmAsIs = useCoopAction((key: string) => post(`/coop/admin/settings/${key}/propose`, { confirm: true, reason: why || 'Confirmed as it is' }), {
    success: 'Sent for approval as confirmed', onSuccess: () => { setConfirmFor(null); setWhy('') },
  })
  const vote = useCoopAction((v: { id: string; decision: string }) => post(`/coop/admin/settings/changes/${v.id}/vote`, { decision: v.decision }), { success: 'Vote recorded' })
  if (!data) return <Skel h="h-48" />
  const start = (s: SettingItem) => { setEdit(s); setVal(fromStored(s)); setWhy('') }
  const unit = (s: SettingItem) => (s.kind === 'kobo' ? '₦' : s.kind === 'bps' ? '%' : s.unit)

  return (
    <>
      <p className="mb-3 text-sm text-green-700 dark:text-night-200">Every rule lives here. A change needs the approval of directors, and each one is saved in the history below.</p>
      <Card className="mb-3">
        <button onClick={() => setGuide(!guide)} className="flex w-full items-center justify-between text-left"><span className="flex items-center gap-2 font-extrabold text-green-900 dark:text-white"><HelpCircle className="h-5 w-5 text-green-600" />Provisional or confirmed: what it means</span><ChevronDown className={`h-5 w-5 text-green-500 transition ${guide ? 'rotate-180' : ''}`} /></button>
        {guide && (
          <div className="mt-3 space-y-2 text-sm text-green-800 dark:text-night-100">
            <p>{data.guide?.provisional}</p>
            <p className="pt-1 text-xs font-bold uppercase text-green-600 dark:text-night-300">When a change starts working</p>
            {Object.entries(data.guide?.effects ?? {}).map(([k, v]) => <p key={k} className="text-xs"><b>{k === 'immediate' ? 'Immediately' : k === 'new_loans' ? 'New loans only' : 'Next accounting year'}:</b> {v}</p>)}
          </div>)}
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-green-900 dark:text-white"><input type="checkbox" checked={onlyProv} onChange={(e) => setOnlyProv(e.target.checked)} className="h-4 w-4 accent-green-600" />Show only rules still waiting for a decision ({data.settings.filter((s) => !s.confirmed && !s.readonly).length})</label>
      </Card>
      <div className="space-y-2">
        {data.groups.map((g) => {
          const items = data.settings.filter((s) => s.group === g && (!onlyProv || (!s.confirmed && !s.readonly)))
          if (!items.length) return null
          const prov = items.filter((s) => !s.confirmed).length
          return (
            <Card key={g} className="!p-0">
              <button onClick={() => setOpen(open === g ? null : g)} className="flex w-full items-center justify-between px-4 py-3.5 text-left">
                <span className="font-extrabold text-green-900 dark:text-white">{g}</span>
                <span className="flex items-center gap-2">{prov > 0 && <Pill tone="amber">{prov} awaiting Board</Pill>}<ChevronDown className={`h-5 w-5 text-green-500 transition ${open === g ? 'rotate-180' : ''}`} /></span>
              </button>
              {open === g && (
                <div className="divide-y divide-green-100 border-t border-green-100 dark:divide-night-500 dark:border-night-500">
                  {items.map((s) => (
                    <div key={s.key} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="text-sm font-bold text-green-900 dark:text-white">{s.label}</p>
                          <p className="mt-0.5 text-lg font-extrabold text-green-700 dark:text-green-300">{showValue(s)}{s.unit && s.kind !== 'int' ? <span className="ml-1 text-xs font-semibold text-green-600 dark:text-night-300">{s.unit}</span> : s.kind === 'int' && s.unit ? '' : null}</p></div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1"><Pill tone={s.confirmed ? 'green' : 'amber'}>{s.confirmed ? 'Confirmed' : 'Provisional'}</Pill>
                          {s.readonly ? <span className="flex items-center gap-1 text-[11px] text-green-500"><Lock className="h-3 w-3" />Locked</span> : <button onClick={() => start(s)} className="text-xs font-extrabold text-green-700 underline dark:text-night-100">Change</button>}</div>
                      </div>
                      <p className="mt-1 text-[11px] text-green-600 dark:text-night-300">Takes effect: {s.effect_label}</p>
                      {s.help?.what && <p className="mt-1 text-xs text-green-800 dark:text-night-100">{s.help.what}</p>}
                      {(s.help?.what || s.note) && <button onClick={() => setHelpOpen(helpOpen === s.key ? null : s.key)} className="mt-1 text-[11px] font-extrabold text-green-700 underline dark:text-night-200">{helpOpen === s.key ? 'Hide details' : 'What are my choices?'}</button>}
                      {helpOpen === s.key && (
                        <div className="mt-2 space-y-1.5 rounded-xl bg-green-100/70 p-3 text-xs text-green-900 dark:bg-night-600 dark:text-night-100">
                          {Object.entries(s.help?.options ?? {}).map(([o, d]) => <p key={o}><b>{o}:</b> {d}</p>)}
                          {s.help?.tip && <p><b>Think about:</b> {s.help.tip}</p>}
                          {!s.confirmed && <p><b>Why provisional:</b> {s.note || 'The Board has not decided this yet. It works with this value meanwhile.'}</p>}
                          {s.required_for_live && <p className="font-bold text-amber-800 dark:text-amber-300">Should be decided before live funds are switched on.</p>}
                          <p><b>Starts working:</b> {data.guide?.effects?.[s.effect] ?? s.effect_label}</p>
                        </div>)}
                      {!s.confirmed && !s.readonly && !s.pending && !s.key.endsWith('_user_id') && (
                        <button onClick={() => { setConfirmFor(s); setWhy('') }} className="mt-2 flex items-center gap-1.5 rounded-full border border-green-300 px-3 py-1.5 text-xs font-extrabold text-green-800 active:scale-95 dark:border-night-400 dark:text-night-100"><BadgeCheck className="h-4 w-4" />Confirm as it is ({showValue(s)})</button>)}
                      {s.pending && (
                        <div className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                          <p className="font-bold">Proposed: {showValue({ ...s, value: s.pending.new_value })} · {s.pending.approvals} of {s.pending.needed} approvals</p>
                          {s.pending.reason && <p>"{s.pending.reason}"</p>}
                          {!s.pending.you_voted && <div className="mt-2 flex gap-2"><button disabled={vote.isPending} onClick={() => vote.mutate({ id: s.pending!.id, decision: 'approve' })} className="rounded-lg bg-green-700 px-3 py-1.5 font-bold text-white">Approve</button><button disabled={vote.isPending} onClick={() => vote.mutate({ id: s.pending!.id, decision: 'reject' })} className="rounded-lg border border-amber-400 px-3 py-1.5 font-bold">Reject</button></div>}</div>)}
                      {s.scheduled && <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-blue-50 p-2 text-xs font-bold text-blue-800 dark:bg-blue-500/10 dark:text-blue-200"><CalendarClock className="h-3.5 w-3.5" />Becomes {showValue({ ...s, value: s.scheduled.new_value })} on {s.scheduled.effective_on ? dShort(s.scheduled.effective_on) : 'the next year'}</p>}
                      {s.key === 'approvals_dividend' && dirs && (
                        <div className="mt-3">
                          <Field label="Director with accountant duty"><select className={inputCls} disabled={!!acc} value={dirs.find((d) => d.is_accountant)?.id ?? ''} onChange={(e) => e.target.value && propose.mutate({ key: 'accountant_user_id', value: e.target.value, reason: 'Accountant duty assignment' })}>
                            <option value="">Not assigned</option>{dirs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
                          {acc && (
                            <div className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                              <p className="font-bold">Proposed accountant: {acc.new_name} · {acc.approvals} of {acc.needed} approvals</p>
                              {acc.you_voted
                                ? <p className="mt-1">You have voted. Another director must approve before this takes effect.</p>
                                : <div className="mt-2 flex gap-2"><button disabled={vote.isPending} onClick={() => vote.mutate({ id: acc.id, decision: 'approve' })} className="rounded-lg bg-green-700 px-3 py-1.5 font-bold text-white">Approve</button><button disabled={vote.isPending} onClick={() => vote.mutate({ id: acc.id, decision: 'reject' })} className="rounded-lg border border-amber-400 px-3 py-1.5 font-bold">Reject</button></div>}
                            </div>)}
                        </div>)}
                    </div>))}
                </div>)}
            </Card>)
        })}
      </div>

      <SectionTitle>Change history</SectionTitle>
      <div className="space-y-2 pb-2">{(hist ?? []).map((h) => (
        <Card key={h.id}><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-green-900 dark:text-white">{h.label}</p><p className="text-xs text-green-600 dark:text-night-300">{h.proposed_by} · {dShort(h.created_at)}</p></div>
          <Pill tone={h.status === 'applied' ? 'green' : h.status === 'rejected' ? 'red' : h.status === 'scheduled' ? 'blue' : 'amber'}>{h.status}</Pill></div>
          <p className="mt-1 text-xs text-green-700 dark:text-night-200">{h.old} → {h.new}{h.reason ? ` · "${h.reason}"` : ''}</p></Card>))}
        {hist && !hist.length && <p className="text-sm text-green-600 dark:text-night-300">No changes yet.</p>}</div>

      <Sheet open={!!confirmFor} onClose={() => setConfirmFor(null)} title="Confirm this rule as it is">
        {confirmFor && (
          <div className="space-y-3">
            <p className="text-sm text-green-800 dark:text-night-100"><b>{confirmFor.label}</b> stays at <b>{showValue(confirmFor)}</b>. Nothing changes for members. It stops being marked as provisional, and it is recorded that the directors decided it.</p>
            <Field label="Reason or Board reference (optional)"><input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} className={inputCls} placeholder="e.g. Board meeting 12 Oct" /></Field>
            <BigButton loading={confirmAsIs.isPending} onClick={() => confirmAsIs.mutate(confirmFor.key)}>Confirm as it is</BigButton>
            <p className="text-center text-[11px] text-green-600 dark:text-night-300">You count as the first approval. Another director must approve, like any rule change.</p>
          </div>)}
      </Sheet>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.label ?? ''}>
        {edit && (
          <div className="space-y-3">
            <p className="text-sm text-green-700 dark:text-night-200">Now: <b>{showValue(edit)}</b>. {edit.effect_label === 'Immediately' ? 'Takes effect as soon as enough directors approve.' : edit.effect_label === 'New loans only' ? 'Loans already created keep the rule they were approved with.' : 'Scheduled for the start of the next accounting year.'}</p>
            {edit.help?.what && <p className="rounded-xl bg-green-100/70 p-3 text-xs text-green-900 dark:bg-night-600 dark:text-night-100">{edit.help.what}</p>}
            {edit.kind === 'bool' ? (
              <div className="flex gap-2">{['true', 'false'].map((b) => <button key={b} onClick={() => setVal(b)} className={`flex-1 rounded-xl py-3 text-sm font-bold ${val === b ? 'bg-green-700 text-white' : 'border border-green-200 text-green-800 dark:border-night-400 dark:text-night-100'}`}>{b === 'true' ? 'On' : 'Off'}</button>)}</div>
            ) : edit.kind === 'enum' ? (
              <select className={inputCls} value={val} onChange={(e) => setVal(e.target.value)}>{edit.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            ) : (
              <Field label={`New value${unit(edit) ? ` (${unit(edit)})` : ''}`}><input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d.]/g, ''))} className={inputCls} autoFocus /></Field>
            )}
            {Object.keys(edit.help?.options ?? {}).length > 0 && <div className="space-y-1 text-xs text-green-800 dark:text-night-100">{Object.entries(edit.help!.options).map(([o, d]) => <p key={o}><b>{o}:</b> {d}</p>)}</div>}
            {edit.help?.tip && <p className="text-xs italic text-green-700 dark:text-night-200">{edit.help.tip}</p>}
            <Field label="Reason (kept in the record)"><input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} className={inputCls} placeholder="e.g. Board resolution of 12 Oct" /></Field>
            <BigButton loading={propose.isPending} disabled={!val || !why.trim() || val === fromStored(edit)} onClick={() => propose.mutate({ key: edit.key, value: toStored(edit, val), reason: why })}>Propose this change</BigButton>
            <p className="text-center text-[11px] text-green-600 dark:text-night-300">You count as the first approval. Another director must approve before it takes effect.</p>
          </div>)}
      </Sheet>
    </>
  )
}
