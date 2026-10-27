import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Plus, Upload, UserPlus, Undo2, Search, X } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { downloadFromApi } from '@/lib/download'
import { ask } from '@/lib/dialog'
import { cn } from '@/lib/utils'
import { ActionButton, Card, DirectorModal, Notice, PageShell } from '@/components/director/DirectorModal'
import toast from '@/lib/notify'

type Tab = 'excel' | 'single' | 'waiting' | 'history'
type Msg = { kind: 'ok' | 'error' | 'info'; text: string } | null
type CardForm = { card_type: string; rate_naira: string; days_contributed: string; days_withdrawn: string; notes: string }
type Account = { full_name: string; phone_number: string; zone: string; officer: string | null; cards: number; temporary_password: string }
type Failed = { full_name: string; phone_number: string; reason: string }
const blankCard = (): CardForm => ({ card_type: 'regular', rate_naira: '', days_contributed: '0', days_withdrawn: '0', notes: '' })
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
  const [f, setF] = useState({ full_name: '', phone_number: '', zone_id: '', handled_by: 'self' })
  const [cards, setCards] = useState<CardForm[]>([blankCard()])
  const [made, setMade] = useState<{ created: Account[]; failed: Failed[] } | null>(null)
  const setCard = (i: number, patch: Partial<CardForm>) => setCards((c) => c.map((x, k) => (k === i ? { ...x, ...patch } : x)))

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
    setMsg({ kind: 'ok', text: `${r.staged ?? pv?.ok ?? 0} cards added. Anyone who already has an account got their cards straight away. Officer-handled people now have an account under their zone's officer. The rest get their cards when they sign up with the same phone number.` })
    if (r.created_accounts?.length || r.failed_accounts?.length) setMade({ created: r.created_accounts ?? [], failed: r.failed_accounts ?? [] })
    setPv(null); setFile(null); refresh()
  })
  const addOne = (keepPerson = false) => run('single', async () => {
    const r = (await api.post('/zonal-customers/single', {
      ...f,
      cards: cards.map((c) => ({ card_type: c.card_type, rate_naira: Number(c.rate_naira), days_contributed: Number(c.days_contributed), days_withdrawn: Number(c.days_withdrawn), notes: c.notes.trim() || null })),
    })).data
    const n = cards.length
    const where = r.created_accounts?.length ? ' They now have an account under their zone’s officer.' : r.attached ? ` ${n > 1 ? 'Their cards are' : 'Their card is'} already on their account.` : ` ${n > 1 ? 'Their cards' : 'Their card'} will appear when they sign up with this phone number.`
    setMsg({ kind: 'ok', text: `${f.full_name} was added with ${n} card${n > 1 ? 's' : ''}.${where}` })
    if (r.created_accounts?.length || r.failed_accounts?.length) setMade({ created: r.created_accounts ?? [], failed: r.failed_accounts ?? [] })
    setCards([blankCard()])
    if (!keepPerson) setF({ ...f, full_name: '', phone_number: '' })
    refresh()
  })
  const makeAccounts = () => run('accounts', async () => {
    const r = (await api.post('/zonal-customers/officer-accounts')).data
    setMade({ created: r.created_accounts ?? [], failed: r.failed_accounts ?? [] })
    setMsg({ kind: r.failed_accounts?.length ? 'info' : 'ok', text: `${r.created_accounts?.length ?? 0} accounts created.${r.failed_accounts?.length ? ` ${r.failed_accounts.length} could not be created, see the list.` : ''}` })
    refresh()
  })
  const copyAll = async () => {
    const t = (made?.created ?? []).map((a) => `${a.full_name} | ${a.phone_number} | ${a.temporary_password}`).join('\n')
    try { await navigator.clipboard.writeText(t); toast.success('Copied') } catch { toast.error('Could not copy') }
  }
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
  const canSingle = f.full_name.trim().length > 1 && f.phone_number.trim().length >= 10 && !!f.zone_id && cards.every((c) => Number(c.rate_naira) > 0)
  const officerWaiting = (waiting.data ?? []).filter((p) => !p.claimed && p.handled_by === 'officer').length

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
          {cards.map((c, i) => (
            <div key={i} className="rounded-2xl border border-green-100 p-3 dark:border-night-500">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-extrabold text-green-900 dark:text-white">Card {i + 1}</p>
                {cards.length > 1 && <button onClick={() => setCards((x) => x.filter((_, k) => k !== i))} aria-label={`Remove card ${i + 1}`} className="text-red-500"><X className="h-4 w-4" /></button>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Daily amount (₦)<input className={input} inputMode="numeric" value={c.rate_naira} onChange={(e) => setCard(i, { rate_naira: e.target.value.replace(/\D/g, '') })} /></label>
                <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Card type
                  <select className={input} value={c.card_type} onChange={(e) => setCard(i, { card_type: e.target.value })}><option value="regular">Regular</option><option value="food">Food</option></select>
                </label>
                <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Days paid<input className={input} inputMode="numeric" value={c.days_contributed} onChange={(e) => setCard(i, { days_contributed: e.target.value.replace(/\D/g, '') })} /></label>
                <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Days withdrawn<input className={input} inputMode="numeric" value={c.days_withdrawn} onChange={(e) => setCard(i, { days_withdrawn: e.target.value.replace(/\D/g, '') })} /></label>
              </div>
            </div>
          ))}
          {cards.length < 10 && <button onClick={() => setCards((x) => [...x, blankCard()])} className="flex items-center gap-1 text-xs font-bold text-green-700 dark:text-night-100"><Plus className="h-3.5 w-3.5" /> This customer has another card</button>}
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Handled by
            <select className={input} value={f.handled_by} onChange={(e) => setF({ ...f, handled_by: e.target.value })}><option value="self">Self (saves on their own phone)</option><option value="officer">An officer (gets an account under the zone’s officer now)</option></select>
          </label>
          <ActionButton busy={busy === 'single'} disabled={!canSingle} onClick={() => addOne(false)}><UserPlus className="mr-1 inline h-4 w-4" />Add customer{cards.length > 1 ? ` with ${cards.length} cards` : ''}</ActionButton>
          <ActionButton tone="ghost" busy={busy === 'single'} disabled={!canSingle} onClick={() => addOne(true)}>Add, then add more cards for the same person</ActionButton>
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
          {officerWaiting > 0 && (
            <Card className="space-y-2">
              <p className="text-xs text-green-800 dark:text-night-100"><b>{officerWaiting}</b> officer-handled card{officerWaiting > 1 ? 's are' : ' is'} still only on the waiting list, so no officer can see them. Create their accounts now and they appear under their zone’s officer.</p>
              <ActionButton busy={busy === 'accounts'} onClick={makeAccounts}>Create accounts for officer customers</ActionButton>
            </Card>
          )}
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
      <DirectorModal open={!!made} title="Customer accounts" onClose={() => setMade(null)}>
        {made && (
          <div className="space-y-3">
            {made.created.length > 0 && (
              <>
                <p className="text-xs text-green-800 dark:text-night-100">{made.created.length} account{made.created.length > 1 ? 's' : ''} created under their zone’s officer. The temporary password is only shown now. Officer customers may never log in, but keep it if one asks.</p>
                <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                  {made.created.map((a) => (
                    <li key={a.phone_number} className="rounded-lg bg-green-50 px-2.5 py-1.5 dark:bg-night-800">
                      <b>{a.full_name}</b> · {a.phone_number} · {a.zone}<br />
                      {a.officer ? `Officer: ${a.officer}` : 'No officer assigned to this zone yet. They will show up for whoever is assigned.'} · {a.cards} card{a.cards === 1 ? '' : 's'}<br />
                      Password: <code className="font-bold">{a.temporary_password}</code>
                    </li>
                  ))}
                </ul>
                <ActionButton tone="ghost" onClick={copyAll}><Copy className="mr-1 inline h-4 w-4" />Copy all</ActionButton>
              </>
            )}
            {made.failed.length > 0 && (
              <Notice kind="error">{made.failed.map((x) => `${x.full_name} (${x.phone_number}): ${x.reason}`).join(' · ')}. Their cards are still on the waiting list, use “Create accounts” on the Customers tab to try again.</Notice>
            )}
          </div>
        )}
      </DirectorModal>
    </PageShell>
  )
}
