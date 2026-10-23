import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload, UserPlus, Undo2, Search } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { downloadFromApi } from '@/lib/download'
import { ask } from '@/lib/dialog'
import { cn } from '@/lib/utils'
import { ActionButton, Card, Notice, PageShell } from '@/components/director/DirectorModal'

type Tab = 'excel' | 'single' | 'waiting' | 'history'
type Msg = { kind: 'ok' | 'error' | 'info'; text: string } | null
const input = 'mt-1 w-full rounded-xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2.5 text-sm text-green-950 dark:text-white'

export default function ZonalCustomersPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('excel')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [pv, setPv] = useState<any>(null)
  const [zoneFilter, setZoneFilter] = useState('')
  const [q, setQ] = useState('')
  const [f, setF] = useState({ full_name: '', phone_number: '', zone_id: '', card_type: 'regular', rate_naira: '', days_contributed: '0', days_withdrawn: '0', handled_by: 'self' })

  const zones = useQuery({ queryKey: ['zc-zones'], queryFn: async () => (await api.get('/zonal-customers/zones')).data as any[] })
  const waiting = useQuery({
    queryKey: ['zc-waiting', zoneFilter, q], enabled: tab === 'waiting',
    queryFn: async () => (await api.get('/zonal-customers/waiting', { params: { zone_id: zoneFilter || undefined, q: q || undefined } })).data as any[],
  })
  const batches = useQuery({ queryKey: ['zc-batches'], enabled: tab === 'history', queryFn: async () => (await api.get('/zonal-customers/batches')).data as any[] })

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(key); setMsg(null)
    try { await fn() } catch (e) { setMsg({ kind: 'error', text: getErrorMessage(e) }) } finally { setBusy(null) }
  }
  const refresh = () => { qc.invalidateQueries({ queryKey: ['zc-zones'] }); qc.invalidateQueries({ queryKey: ['zc-waiting'] }); qc.invalidateQueries({ queryKey: ['zc-batches'] }) }
  const form = (fl: File) => { const fd = new FormData(); fd.append('file', fl); return fd }
  const mp = { headers: { 'Content-Type': 'multipart/form-data' } }

  const doPreview = (fl: File) => run('preview', async () => { setFile(fl); setPv((await api.post('/zonal-customers/import/preview', form(fl), mp)).data) })
  const doCommit = () => run('commit', async () => {
    if (!file) return
    const r = (await api.post('/zonal-customers/import/commit', form(file), mp)).data
    setMsg({ kind: 'ok', text: `${r.rows ?? pv?.ok ?? 0} customers added. Anyone who already has an account got their card straight away. The rest get it when they sign up with the same phone number.` })
    setPv(null); setFile(null); refresh()
  })
  const addOne = () => run('single', async () => {
    const r = (await api.post('/zonal-customers/single', { ...f, rate_naira: Number(f.rate_naira), days_contributed: Number(f.days_contributed), days_withdrawn: Number(f.days_withdrawn) })).data
    setMsg({ kind: 'ok', text: `${f.full_name} was added.${r.attached ? ' Their card is already on their account.' : ' Their card will appear when they sign up with this phone number.'}` })
    setF({ ...f, full_name: '', phone_number: '', rate_naira: '', days_contributed: '0', days_withdrawn: '0' }); refresh()
  })
  const removeWaiting = (id: string, name: string) => run('rm' + id, async () => {
    if (!(await ask(`Remove ${name} from the waiting list? Their offline record is dropped.`, { tone: 'danger', confirmLabel: 'Remove' }))) return
    await api.delete(`/zonal-customers/waiting/${id}`); refresh()
  })
  const undo = (id: string) => run('undo' + id, async () => {
    if (!(await ask('Undo this import? People who have not signed up yet are removed, and cards already created from it are taken back.', { tone: 'danger', confirmLabel: 'Undo import' }))) return
    const r = (await api.post(`/zonal-customers/batches/${id}/undo`)).data
    setMsg({ kind: 'ok', text: `Import undone.${r.removed != null ? ` ${r.removed} records removed.` : ''}` }); refresh()
  })

  const tabs: [Tab, string][] = [['excel', 'From Excel'], ['single', 'Add one'], ['waiting', 'Customers'], ['history', 'Imports']]
  const canSingle = f.full_name.trim().length > 1 && f.phone_number.trim().length >= 10 && f.zone_id && Number(f.rate_naira) > 0

  return (
    <PageShell title="Zonal customers" onBack={() => nav(-1)}>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setMsg(null) }}
            className={cn('shrink-0 rounded-full px-3.5 py-2 text-xs font-bold', tab === k ? 'bg-green-900 text-white dark:bg-night-100 dark:text-night-900' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-700 dark:text-night-200')}>{label}</button>
        ))}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {tab === 'excel' && (
        <Card className="space-y-3">
          <p className="text-xs text-green-700 dark:text-night-200">Fill the template with people who already save offline: zone, card, days paid and any days already withdrawn. Their record joins their account when they sign up with the same phone number.</p>
          <ActionButton tone="ghost" onClick={() => downloadFromApi('/zonal-customers/template.xlsx', 'MonieKing-Offline-Customers-Template.xlsx', { label: 'Preparing the template' })}><Download className="mr-1 inline h-4 w-4" />Download template</ActionButton>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const fl = e.target.files?.[0]; if (fl) doPreview(fl); e.target.value = '' }} />
          <ActionButton tone="ghost" busy={busy === 'preview'} onClick={() => fileRef.current?.click()}><Upload className="mr-1 inline h-4 w-4" />Upload filled template</ActionButton>
          {pv && (
            <div className="space-y-2">
              <Notice kind={pv.bad ? 'error' : 'ok'}>{pv.ok} of {pv.total} rows are ready{pv.bad ? `. ${pv.bad} need fixing, nothing is saved until they are all fixed.` : '.'}</Notice>
              <ul className="max-h-64 overflow-y-auto space-y-1 text-xs">
                {pv.rows.map((r: any) => (
                  <li key={r.line} className={cn('rounded-lg px-2.5 py-1.5', r.ok ? 'bg-green-50 dark:bg-night-800 text-green-800 dark:text-night-100' : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300')}>
                    <b>Row {r.line}</b> · {r.full_name || '—'} · {r.phone_number || '—'}{r.existing_user ? ` (already registered as ${r.existing_user})` : ''}
                    {!r.ok && <span className="block">{r.errors.join('; ')}</span>}
                  </li>
                ))}
              </ul>
              <ActionButton busy={busy === 'commit'} disabled={pv.bad > 0 || pv.ok === 0} onClick={doCommit}>Add {pv.ok} customers</ActionButton>
            </div>
          )}
        </Card>
      )}

      {tab === 'single' && (
        <Card className="space-y-3">
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Full name<input className={input} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Phone number<input className={input} inputMode="tel" value={f.phone_number} onChange={(e) => setF({ ...f, phone_number: e.target.value })} /></label>
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Zone
            <select className={input} value={f.zone_id} onChange={(e) => setF({ ...f, zone_id: e.target.value })}><option value="">Choose a zone</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Daily amount (₦)<input className={input} inputMode="numeric" value={f.rate_naira} onChange={(e) => setF({ ...f, rate_naira: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Card type
              <select className={input} value={f.card_type} onChange={(e) => setF({ ...f, card_type: e.target.value })}><option value="regular">Regular</option><option value="food">Food</option></select>
            </label>
            <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Days paid<input className={input} inputMode="numeric" value={f.days_contributed} onChange={(e) => setF({ ...f, days_contributed: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Days withdrawn<input className={input} inputMode="numeric" value={f.days_withdrawn} onChange={(e) => setF({ ...f, days_withdrawn: e.target.value.replace(/\D/g, '') })} /></label>
          </div>
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Handled by
            <select className={input} value={f.handled_by} onChange={(e) => setF({ ...f, handled_by: e.target.value })}><option value="self">Self (saves on their own phone)</option><option value="officer">An officer</option></select>
          </label>
          <ActionButton busy={busy === 'single'} disabled={!canSingle} onClick={addOne}><UserPlus className="mr-1 inline h-4 w-4" />Add customer</ActionButton>
        </Card>
      )}

      {tab === 'waiting' && (
        <>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            <button onClick={() => setZoneFilter('')} className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs font-bold', !zoneFilter ? 'bg-green-700 text-white' : 'bg-white dark:bg-night-700 text-green-700 dark:text-night-200 border border-green-200 dark:border-night-500')}>All zones</button>
            {zones.data?.map((z) => (
              <button key={z.id} onClick={() => setZoneFilter(z.id)} className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs font-bold', zoneFilter === z.id ? 'bg-green-700 text-white' : 'bg-white dark:bg-night-700 text-green-700 dark:text-night-200 border border-green-200 dark:border-night-500')}>{z.name} · {z.customers}{z.waiting ? ` (+${z.waiting} waiting)` : ''}</button>
            ))}
          </div>
          <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-green-500" /><input className={cn(input, 'mt-0 pl-9')} placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Card className="divide-y divide-green-100 dark:divide-night-600 !p-0">
            {(waiting.data ?? []).map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-green-950 dark:text-white">{p.full_name}</p>
                  <p className="truncate text-[11px] text-green-600 dark:text-night-300">{p.phone_number} · {p.zone} · {p.card_type} · {p.days_contributed} days{p.days_withdrawn ? `, ${p.days_withdrawn} withdrawn` : ''} · {p.handled_by === 'self' ? 'Self' : 'Officer'}</p>
                </div>
                {p.claimed ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">Signed up</span>
                  : <button disabled={!!busy} onClick={() => removeWaiting(p.id, p.full_name)} className="text-[11px] font-bold text-red-600 disabled:opacity-40">Remove</button>}
              </div>
            ))}
            {waiting.data && waiting.data.length === 0 && <p className="px-4 py-6 text-center text-sm text-green-600 dark:text-night-300">Nobody here yet.</p>}
          </Card>
        </>
      )}

      {tab === 'history' && (
        <Card className="divide-y divide-green-100 dark:divide-night-600 !p-0">
          {(batches.data ?? []).map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-green-950 dark:text-white">{b.filename ?? (b.source === 'single' ? 'Single customer' : 'Import')}</p>
                <p className="text-[11px] text-green-600 dark:text-night-300">{b.row_count} customers · {new Date(b.created_at).toLocaleString()}</p>
              </div>
              {b.undone ? <span className="text-[11px] font-bold text-green-600">Undone</span>
                : <button disabled={!!busy} onClick={() => undo(b.id)} className="flex items-center gap-1 text-[11px] font-bold text-red-600 disabled:opacity-40"><Undo2 className="h-3.5 w-3.5" />Undo</button>}
            </div>
          ))}
          {batches.data && batches.data.length === 0 && <p className="px-4 py-6 text-center text-sm text-green-600 dark:text-night-300">No imports yet.</p>}
        </Card>
      )}
    </PageShell>
  )
}
