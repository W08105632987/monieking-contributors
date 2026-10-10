import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FastForward, RotateCcw, XCircle } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { post, useCoopAction } from '../api'
import { BigButton, Card, CoopPage, Pill, SectionTitle, Skel, Stat, loanTone } from '../ui'
import { useAdmin } from './dapi'
import ApprovalsTab from './ApprovalsTab'
import SettingsTab from './SettingsTab'
import PeopleTab from './PeopleTab'

const TABS = [['overview', 'Overview'], ['approvals', 'Approvals'], ['people', 'People'], ['settings', 'Rules'], ['tools', 'Test tools']] as const

export default function DirectorCoopPage() {
  const nav = useNavigate()
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('overview')
  const { data: ov } = useAdmin('overview', '/coop/admin/overview')
  return (
    <CoopPage title="Cooperative" subtitle="Director console" back="/director/more">
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {TABS.map(([k, l]) => {
          const n = k === 'approvals' ? ov?.awaiting_approval : k === 'settings' ? ov?.settings_pending : 0
          return <button key={k} onClick={() => setTab(k)} className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold ${tab === k ? 'bg-green-700 text-white dark:bg-green-600' : 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100'}`}>{l}{n ? <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-extrabold text-green-950">{n}</span> : null}</button>
        })}
      </div>
      {tab === 'overview' && <Overview ov={ov} go={setTab} />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'people' && <PeopleTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'tools' && <Tools ov={ov} onMember={() => nav('/coop')} />}
    </CoopPage>
  )
}

function Overview({ ov, go }: { ov: any; go: (t: any) => void }) {
  if (!ov) return <div className="space-y-3"><Skel h="h-32" /><Skel /></div>
  const bad = (ov.reconciliation as any[]).filter((c) => !c.ok)
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Card><Stat label="Members" value={ov.members} sub={`${ov.pilot_members} on pilot list`} /></Card>
        <Card><Stat label="Held" value={formatNaira(ov.total_contributions_kobo)} sub={`${formatNaira(ov.locked_kobo)} locked`} /></Card>
        <Card onClick={() => go('approvals')}><Stat label="Waiting for approval" value={ov.awaiting_approval} sub="loans" /></Card>
        <Card><Stat label="Overdue loans" value={ov.overdue_loans} sub={`Dividend pool ${formatNaira(ov.dividend_pool_kobo)}`} /></Card>
      </div>
      <SectionTitle>Loans by stage</SectionTitle>
      <Card><div className="flex flex-wrap gap-2">{Object.entries(ov.loans as Record<string, number>).map(([k, v]) => { const t = loanTone(k); return <Pill key={k} tone={t.tone}>{t.label}: {v}</Pill> })}{!Object.keys(ov.loans).length && <p className="text-sm text-green-700 dark:text-night-200">No loans yet.</p>}</div></Card>
      <SectionTitle right={<Pill tone={bad.length ? 'red' : 'green'}>{bad.length ? `${bad.length} problem` : 'All clear'}</Pill>}>Accountant checks</SectionTitle>
      <div className="space-y-2">{(ov.reconciliation as any[]).map((c) => (
        <Card key={c.name}><div className="flex items-start gap-2">{c.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" /> : <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />}
          <div><p className="text-sm font-bold text-green-900 dark:text-white">{c.name}</p><p className="text-xs text-green-600 dark:text-night-300">{c.detail}</p></div></div></Card>))}</div>
      <SectionTitle>Going live</SectionTitle>
      <Card className="border-amber-300 bg-amber-50 dark:bg-amber-500/10">
        <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" /><div className="text-sm text-amber-900 dark:text-amber-200">
          <p className="font-bold">Preview only. Live money is switched off.</p><p>{ov.live_blocked_reason}</p>
          {ov.accountant ? <p className="mt-1">Accountant duty: {ov.accountant}</p> : <p className="mt-1">No director has accountant duty yet. Set it in Rules.</p>}</div></div>
      </Card>
    </>
  )
}

function Tools({ ov, onMember }: { ov: any; onMember: () => void }) {
  const [days, setDays] = useState(30)
  const [txt, setTxt] = useState('')
  const adv = useCoopAction((d: number) => post('/coop/admin/test/advance', { days: d }), { success: 'Clock moved forward' })
  const reset = useCoopAction(() => post('/coop/admin/test/reset', { confirm: txt }), { success: 'Test data cleared', onSuccess: () => setTxt('') })
  return (
    <div className="space-y-3">
      <Card>
        <p className="font-extrabold text-green-900 dark:text-white">Time travel</p>
        <p className="mt-1 text-sm text-green-700 dark:text-night-200">Move the cooperative's clock forward to test due dates, overdue charges, expiry and the dividend. It affects everyone testing. Today in the cooperative: <b>{ov?.today}</b> ({ov?.clock_offset_days ?? 0} days ahead).</p>
        <div className="mt-3 flex flex-wrap gap-2">{[1, 7, 30, 100, 180].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded-full px-3 py-1.5 text-sm font-bold ${days === d ? 'bg-green-700 text-white' : 'border border-green-200 text-green-800 dark:border-night-400 dark:text-night-100'}`}>+{d}d</button>)}</div>
        <div className="mt-3"><BigButton tone="amber" loading={adv.isPending} onClick={() => adv.mutate(days)}><FastForward className="h-4 w-4" />Move forward {days} day{days > 1 ? 's' : ''}</BigButton></div>
        <p className="mt-2 text-[11px] text-green-600 dark:text-night-300">The clock can only move forward. Use Reset to start over.</p>
      </Card>
      <Card>
        <p className="font-extrabold text-green-900 dark:text-white">Reset test data</p>
        <p className="mt-1 text-sm text-green-700 dark:text-night-200">Deletes every member, loan, guarantee and journal entry of the preview, and puts the clock back to today. Rules and the pilot list are kept.</p>
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Type RESET" className="mt-3 w-full rounded-xl border border-green-200 bg-white px-3 py-3 text-sm dark:border-night-400 dark:bg-night-800 dark:text-white" />
        <div className="mt-2"><BigButton tone="red" disabled={txt !== 'RESET'} loading={reset.isPending} onClick={() => reset.mutate(undefined)}><RotateCcw className="h-4 w-4" />Reset everything</BigButton></div>
      </Card>
      <Card onClick={onMember}><p className="font-bold text-green-900 dark:text-white">Open the member app</p><p className="text-sm text-green-700 dark:text-night-200">Directors cannot join. Test as a member with a customer account on the pilot list.</p></Card>
    </div>
  )
}
