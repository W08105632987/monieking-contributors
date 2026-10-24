import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload, Eye, Trash2, RotateCcw, ShieldCheck } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { downloadFromApi } from '@/lib/download'
import { ActionButton, Card, DirectorModal, Notice, PageShell, PinField } from '@/components/director/DirectorModal'

type Msg = { kind: 'ok' | 'error' | 'info'; text: string } | null

export default function CleanupCentrePage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [dialog, setDialog] = useState<null | 'purge' | 'reset'>(null)
  const [phrase, setPhrase] = useState('')
  const [pin, setPin] = useState('')
  const [backup, setBackup] = useState(false)
  const [ack, setAck] = useState(false)
  const [recon, setRecon] = useState<any>(null)
  const [clearDisputes, setClearDisputes] = useState(true)

  const summary = useQuery({ queryKey: ['cleanup-summary'], queryFn: async () => (await api.get('/cleanup/summary')).data })

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(key); setMsg(null)
    try { await fn() } catch (e) { setMsg({ kind: 'error', text: getErrorMessage(e) }) } finally { setBusy(null) }
  }

  const upload = (f: File) => run('mark', async () => {
    const fd = new FormData(); fd.append('file', f)
    const r = (await api.post('/cleanup/mark', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data
    setMsg({ kind: 'ok', text: `Marked ${r.marked_test} as test and ${r.marked_real} as real.${r.problems?.length ? ' ' + r.problems.join(' ') : ''}` })
    setPreview(null)
    qc.invalidateQueries({ queryKey: ['cleanup-summary'] })
  })

  const loadPreview = () => run('preview', async () => { setPreview((await api.get('/cleanup/preview')).data) })
  const closeDialog = () => { if (busy) return; setDialog(null); setPhrase(''); setPin(''); setBackup(false); setAck(false) }

  const purge = () => run('purge', async () => {
    const r = (await api.post('/cleanup/purge', { confirm_phrase: phrase, pin, backup_confirmed: backup, acknowledge_value: ack }, { timeout: 300_000 })).data
    setDialog(null); setPhrase(''); setPin(''); setBackup(false); setAck(false); setPreview(null)
    setMsg({ kind: 'ok', text: `${r.message}. Their phone numbers can be registered again.` })
    qc.invalidateQueries({ queryKey: ['cleanup-summary'] })
  })
  const reset = () => run('reset', async () => {
    const r = (await api.post('/cleanup/reset-stats', { confirm_phrase: phrase, pin, disputes: clearDisputes }, { timeout: 120_000 })).data
    setDialog(null); setPhrase(''); setPin('')
    setMsg({ kind: 'ok', text: `${r.message}. Run the preview again.` })
  })
  const check = () => run('recon', async () => { setRecon((await api.get('/cleanup/reconcile')).data) })

  const needsAck = (preview?.value_users?.length ?? 0) > 0
  const purgeReady = phrase.trim() === (preview?.confirm_phrase ?? 'DELETE TEST ACCOUNTS') && pin.length >= 4 && backup && (!needsAck || ack)

  return (
    <PageShell title="Cleanup centre" onBack={() => nav(-1)}>
      <Card>
        <p className="text-sm text-green-800 dark:text-night-100">Remove test accounts completely and start the app's numbers fresh. Real customers are never touched.</p>
        <p className="mt-2 text-xs text-green-600 dark:text-night-300">
          {summary.data ? `${summary.data.real} real · ${summary.data.test} marked as test` : 'Loading…'}
        </p>
      </Card>

      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <Card className="space-y-3">
        <p className="text-sm font-bold text-green-950 dark:text-white">1. Review everyone in Excel</p>
        <p className="text-xs text-green-700 dark:text-night-200">Download the list, choose Real or Test in the first column, then upload it back. Uploading only marks people. Nothing is deleted yet.</p>
        <ActionButton tone="ghost" onClick={() => downloadFromApi('/cleanup/users.xlsx', 'MonieKing-Users-Review.xlsx', { label: 'Preparing the user list' })}><Download className="mr-1 inline h-4 w-4" />Download user list</ActionButton>
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        <ActionButton tone="ghost" busy={busy === 'mark'} onClick={() => fileRef.current?.click()}><Upload className="mr-1 inline h-4 w-4" />Upload the marked file</ActionButton>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-bold text-green-950 dark:text-white">2. Preview what would be removed</p>
        <ActionButton tone="ghost" busy={busy === 'preview'} onClick={loadPreview}><Eye className="mr-1 inline h-4 w-4" />Show preview</ActionButton>
        {preview && (
          <div className="space-y-2 text-xs text-green-800 dark:text-night-100">
            <p><b>{preview.users}</b> test accounts · <b>{preview.total_rows}</b> records in total.</p>
            {preview.people?.length > 0 && <ul className="max-h-40 overflow-y-auto rounded-xl bg-green-50 dark:bg-night-800 p-2 space-y-0.5">{preview.people.map((p: any) => <li key={p.phone_number}>{p.full_name} · {p.phone_number}</li>)}</ul>}
            {preview.conflicts?.length > 0 && (
              <div className="space-y-2">
                <Notice kind="error">Some records of test accounts are also tied to real customers, so nothing can be deleted yet. Here is exactly what is tangled:</Notice>
                <ul className="space-y-1 rounded-xl bg-red-50 p-2 text-[11px] text-red-800 dark:bg-red-950/30 dark:text-red-200">
                  {preview.conflicts.map((c: any, i: number) => (
                    <li key={i}><b>{c.rows}</b> record(s) in <b>{c.table.replace(/_/g, ' ')}</b> ({c.column.replace(/_/g, ' ')}): {c.reason}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-green-700 dark:text-night-200">Usual cause: a test account handled a real customer (for example a test officer who recorded real contributions) or a real customer used a test account. Un-mark that person as Test (set them to Real) and upload again, then delete the rest.</p>
              </div>
            )}
            {needsAck && <Notice kind="info">{preview.value_users.length} test account(s) still hold money. That money will disappear with them.</Notice>}
            <ActionButton tone="red" disabled={!preview.can_purge || preview.users === 0} onClick={() => setDialog('purge')}><Trash2 className="mr-1 inline h-4 w-4" />Delete test accounts…</ActionButton>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-bold text-green-950 dark:text-white">3. Start fresh</p>
        <p className="text-xs text-green-700 dark:text-night-200">Clears visit counts, banner views, notifications, broadcasts, health history and old disputes so the app starts like new. Customer money and cards are not affected. Do this before deleting test accounts: it also clears most of what blocks the delete.</p>
        <ActionButton tone="ghost" onClick={() => setDialog('reset')}><RotateCcw className="mr-1 inline h-4 w-4" />Restart statistics…</ActionButton>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-bold text-green-950 dark:text-white">Money check</p>
        <ActionButton tone="ghost" busy={busy === 'recon'} onClick={check}><ShieldCheck className="mr-1 inline h-4 w-4" />Check wallets and cards add up</ActionButton>
        {recon && (recon.clean ? <Notice kind="ok">All wallets and cards add up.</Notice> : (
          <ul className="space-y-1 text-xs text-red-700 dark:text-red-300">{recon.issues.map((i: any, n: number) => <li key={n}><b>{i.who}</b>: {i.detail}</li>)}</ul>
        ))}
      </Card>

      <DirectorModal open={dialog === 'purge'} title="Delete test accounts" onClose={closeDialog} busy={busy === 'purge'}>
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100">This permanently removes {preview?.users ?? 0} test accounts, their records and their logins. It cannot be undone.</p>
          <label className="flex items-start gap-2 text-xs text-green-800 dark:text-night-100"><input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} className="mt-0.5" />I have taken a database backup.</label>
          {needsAck && <label className="flex items-start gap-2 text-xs text-green-800 dark:text-night-100"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />I understand some test accounts still hold money.</label>}
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Type <b>{preview?.confirm_phrase ?? 'DELETE TEST ACCOUNTS'}</b>
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} className="mt-1 w-full rounded-xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2.5 text-sm text-green-950 dark:text-white" />
          </label>
          <PinField value={pin} onChange={setPin} />
          {msg?.kind === 'error' && <Notice kind="error">{msg.text}</Notice>}
          <ActionButton tone="red" busy={busy === 'purge'} disabled={!purgeReady} onClick={purge}>Delete for good</ActionButton>
        </div>
      </DirectorModal>

      <DirectorModal open={dialog === 'reset'} title="Restart statistics" onClose={closeDialog} busy={busy === 'reset'}>
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100">Visit counts, banner views, notifications, broadcasts and health history are cleared. Money, cards and customers stay exactly as they are.</p>
          <label className="flex items-start gap-2 text-xs text-green-800 dark:text-night-100"><input type="checkbox" className="mt-0.5" checked={clearDisputes} onChange={(e) => setClearDisputes(e.target.checked)} />Also delete all old disputes and their messages.</label>
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Type <b>RESET STATISTICS</b>
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} className="mt-1 w-full rounded-xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2.5 text-sm text-green-950 dark:text-white" />
          </label>
          <PinField value={pin} onChange={setPin} />
          {msg?.kind === 'error' && <Notice kind="error">{msg.text}</Notice>}
          <ActionButton tone="red" busy={busy === 'reset'} disabled={phrase.trim() !== 'RESET STATISTICS' || pin.length < 4} onClick={reset}>Restart statistics</ActionButton>
        </div>
      </DirectorModal>
    </PageShell>
  )
}
