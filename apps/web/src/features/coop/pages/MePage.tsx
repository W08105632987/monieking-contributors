import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpRight, BarChart3, ChevronRight, Coins, FileText, Heart, Landmark, LogOut, MessageSquare, Plus } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { useCoopStatus, useMe } from '../api'
import { Card, CoopPage, Pill, SectionTitle, Skel, Stat, pctText } from '../ui'
import { ReliabilityBadge, TopUpSheet, WithdrawSheet } from '../parts'
import { EntryDetailSheet, EntryRow, ViewAll } from '../lists'
import type { LedgerEntry } from '../api'

export default function MePage() {
  const nav = useNavigate()
  const { data: s } = useCoopStatus()
  const { data: m } = useMe()
  const [topUp, setTopUp] = useState(false)
  const [wd, setWd] = useState(false)
  const [entry, setEntry] = useState<LedgerEntry | null>(null)
  if (!m || !s?.rules) return <CoopPage title="Me"><Skel h="h-48" /></CoopPage>
  const r = s.rules
  return (
    <CoopPage title="Me" subtitle={m.card_no}>
      <Card>
        <div className="flex items-start justify-between"><Stat label="Total contribution" value={formatNaira(m.contribution_kobo)} />
          <ReliabilityBadge pct={m.reliability_pct} has={m.has_history} /></div>
        <div className="mt-3 grid grid-cols-2 gap-3"><Stat label="Free" value={formatNaira(m.free_kobo)} /><Stat label="Locked behind guarantees" value={formatNaira(m.locked_kobo)} /></div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setTopUp(true)} className="flex items-center justify-center gap-1.5 rounded-xl bg-green-700 py-2.5 text-sm font-bold text-white dark:bg-green-600"><Plus className="h-4 w-4" />Add money</button>
          <button onClick={() => setWd(true)} className="flex items-center justify-center gap-1.5 rounded-xl border border-green-200 py-2.5 text-sm font-bold text-green-800 dark:border-night-400 dark:text-night-100"><ArrowDownToLine className="h-4 w-4" />Withdraw</button>
        </div>
        {m.disqualified_this_year && <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">You withdrew early this year, so you will not share this year's dividend.</p>}
        {m.nin_bypassed && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Test note: you joined without a linked NIN.</p>}
      </Card>

      <SectionTitle>My account</SectionTitle>
      <div className="space-y-2">
        {([['/coop/bank', Landmark, 'Bank details', m.has_bank ? 'Where your loan is paid' : 'Add the account for your loan'],
          ['/coop/next-of-kin', Heart, 'Next of kin', m.next_of_kin ? m.next_of_kin.name : 'Not added yet'],
          ['/coop/withdrawals', ArrowUpRight, 'My withdrawals', 'Requests and where they stand'],
          ['/coop/dividends', Coins, 'My dividends', 'Yearly share and disputes'],
          ['/coop/statement', FileText, 'Statement', 'Entries and PDF download'],
          ['/coop/complaints', MessageSquare, 'Complaints', 'Tell the directors'],
          ['/coop/close', LogOut, 'Close my membership', 'Take out your contribution']] as any[]).map(([to, Icon, t, sub]) => (
          <Card key={to} onClick={() => nav(to)}><div className="flex items-center gap-3"><Icon className="h-5 w-5 text-green-600" /><div className="min-w-0 flex-1"><p className="font-bold text-green-900 dark:text-white">{t}</p><p className="truncate text-xs text-green-600 dark:text-night-300">{sub}</p></div><ChevronRight className="h-4 w-4 text-green-300" /></div></Card>))}
      </div>

      <SectionTitle>Quick links</SectionTitle>
      <div className="space-y-2">
        <Card onClick={() => nav('/coop/transparency')}><div className="flex items-center gap-3"><BarChart3 className="h-5 w-5 text-green-600" /><p className="flex-1 font-bold text-green-900 dark:text-white">Transparency</p><ChevronRight className="h-4 w-4 text-green-300" /></div></Card>
        <Card onClick={() => nav(`/coop/members/${m.member_id}`)}><div className="flex items-center gap-3"><p className="flex-1 font-bold text-green-900 dark:text-white">How others see my profile</p><ChevronRight className="h-4 w-4 text-green-300" /></div></Card>
      </div>

      <SectionTitle>Rules in force <Pill tone="amber" className="ml-1">preview</Pill></SectionTitle>
      <Card className="space-y-1.5 text-sm text-green-800 dark:text-night-100">
        <p>Interest: <b>{pctText(r.loan_rate_bps)}</b> {r.provisional.includes('loan_rate_bps') && <Pill tone="amber">example rate</Pill>}</p>
        <p>Loan size: {formatNaira(r.loan_min_kobo)} to {formatNaira(r.loan_max_kobo)}, up to {r.loan_term_months} months</p>
        <p>Guarantee: {formatNaira(r.guarantee_min_kobo)} to {formatNaira(r.guarantee_max_kobo)}, up to {r.guarantee_max_active} at once</p>
        <p>Overdue: {pctText(r.overdue_daily_bps)} of original interest per day</p>
        <p>Early withdrawal: {pctText(r.early_withdrawal_bps)}</p>
        <p>Dividend: {r.dividend_contribution_pct}% contributors, {r.dividend_guarantee_pct}% guarantors</p>
        <p className="pt-1 text-xs text-green-600 dark:text-night-300">Rules marked "preview" are placeholders until the Board decides.</p>
      </Card>

      <SectionTitle>My history</SectionTitle>
      <div className="pb-2"><ViewAll items={m.history ?? []} label="View all history" render={(h) => <EntryRow key={h.id} e={h} onClick={() => setEntry(h)} />}
        empty={<p className="text-sm text-green-700 dark:text-night-200">Nothing yet. Your contributions and withdrawals will show here.</p>} /></div>
      <EntryDetailSheet e={entry} onClose={() => setEntry(null)} />
      <TopUpSheet open={topUp} onClose={() => setTopUp(false)} />
      <WithdrawSheet open={wd} onClose={() => setWd(false)} member={m} rules={r} />
    </CoopPage>
  )
}
