import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowDownToLine, BarChart3, ChevronRight, Coins, HeartHandshake, Lock, PiggyBank, Plus, Sparkles, Users } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { useCoopStatus, useLoan } from '../api'
import { Bar, Card, CoopPage, Empty, loanTone, Pill, SectionTitle, Skel, Stat, pctText } from '../ui'
import { TopUpSheet, WithdrawSheet } from '../parts'

export default function CoopHomePage() {
  const nav = useNavigate()
  const { data: s, isLoading } = useCoopStatus()
  const [topUp, setTopUp] = useState(false)
  const [wd, setWd] = useState(false)
  const loanId = s?.active_loan?.id
  const { data: loan } = useLoan(loanId)

  const back = (
    <button onClick={() => nav('/customer/dashboard')} className="rounded-full border border-green-200 bg-white px-3 py-1.5 text-xs font-bold text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100">
      MonieKing
    </button>
  )

  if (isLoading) return <CoopPage title="Cooperative" right={back}><div className="space-y-3"><Skel h="h-40" /><Skel /><Skel /></div></CoopPage>

  if (!s?.access) {
    return (
      <CoopPage title="Cooperative" right={back} noBanner>
        <Empty icon={<Users className="h-7 w-7" />} title="Not open for you yet"
          text="The MonieKing Cooperative is being tested with a small group of members first. You will be told when it opens for you." />
      </CoopPage>
    )
  }

  if (!s.is_member || !s.member || !s.rules) {
    const r = s.rules
    return (
      <CoopPage title="MonieKing Cooperative" subtitle="Save together. Borrow together. Share the profit." right={back}>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-3xl bg-hero-gradient p-5 text-white dark:bg-night-gradient">
          <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-green-600/30" />
          <Sparkles className="relative h-7 w-7 text-amber-300" />
          <h2 className="relative mt-3 text-2xl font-extrabold leading-tight">Be an owner, not just a customer.</h2>
          <p className="relative mt-2 text-sm text-green-100">Join with as little as {r ? formatNaira(r.registration_min_kobo) : '₦50'}. Your money earns a share of the cooperative's profit at the end of the year.</p>
          <button onClick={() => nav('/coop/join')} className="relative mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 py-3.5 text-sm font-extrabold text-green-950 active:scale-[0.98]">
            Join the Cooperative <ChevronRight className="h-4 w-4" />
          </button>
        </motion.div>
        <SectionTitle>How it works</SectionTitle>
        <div className="space-y-2">
          {[
            [PiggyBank, 'Contribute', 'Your contributions are yours. Everyone can see what the cooperative holds, every day.'],
            [HeartHandshake, 'Borrow with guarantors', 'Ask members from the guarantors\' pool to back your loan. Two directors approve every loan.'],
            [Coins, 'Share the profit', r ? `Yearly dividend: ${r.dividend_contribution_pct}% shared by contributors, ${r.dividend_guarantee_pct}% by guarantors.` : 'Yearly dividend for contributors and guarantors.'],
          ].map(([Icon, t, d]: any) => (
            <Card key={t}><div className="flex gap-3"><Icon className="h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" /><div><p className="font-bold text-green-900 dark:text-white">{t}</p><p className="text-sm text-green-700 dark:text-night-200">{d}</p></div></div></Card>
          ))}
        </div>
      </CoopPage>
    )
  }

  const m = s.member
  const r = s.rules
  const lt = loan ? loanTone(loan.status) : null
  const stepIdx = loan ? loan.steps.filter((x) => x.done).length : 0
  return (
    <CoopPage title="Cooperative" subtitle={`Card ${m.card_no}`} right={back}>
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="relative overflow-hidden rounded-3xl bg-hero-gradient p-5 text-white dark:bg-night-gradient">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-green-600/30" />
        <p className="relative text-xs font-semibold uppercase tracking-widest text-green-300">Your contribution</p>
        <p className="relative mt-1 text-4xl font-extrabold tracking-tight">{formatNaira(m.contribution_kobo)}</p>
        <div className="relative mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-green-300">Free to use</p><p className="font-bold">{formatNaira(m.free_kobo)}</p></div>
          <div><p className="flex items-center gap-1 text-green-300"><Lock className="h-3 w-3" />Locked</p><p className="font-bold">{formatNaira(m.locked_kobo)}</p></div>
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setTopUp(true)} className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 py-2.5 text-sm font-extrabold text-green-950"><Plus className="h-4 w-4" />Add money</button>
          <button onClick={() => setWd(true)} className="flex items-center justify-center gap-1.5 rounded-xl bg-white/15 py-2.5 text-sm font-bold text-white"><ArrowDownToLine className="h-4 w-4" />Withdraw</button>
        </div>
      </motion.div>

      {(s.pending_invites ?? 0) > 0 && (
        <Card className="mt-3 border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" onClick={() => nav('/coop/pool')}>
          <div className="flex items-center gap-3"><HeartHandshake className="h-5 w-5 text-amber-700" />
            <p className="flex-1 text-sm font-bold text-amber-900 dark:text-amber-200">{s.pending_invites} guarantor request{s.pending_invites === 1 ? '' : 's'} waiting for you</p>
            <ChevronRight className="h-4 w-4 text-amber-700" /></div>
        </Card>
      )}

      <SectionTitle>My loan</SectionTitle>
      {loan && lt ? (
        <Card onClick={() => nav(`/coop/loans/${loan.id}`)}>
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-semibold text-green-500 dark:text-night-300">{loan.loan_no}</p><p className="text-xl font-extrabold text-green-900 dark:text-white">{formatNaira(loan.principal_kobo)}</p></div>
            <Pill tone={lt.tone}>{lt.label}</Pill>
          </div>
          {loan.status === 'seeking_guarantors' && (
            <div className="mt-3"><Bar value={loan.guaranteed_kobo} max={loan.cover_needed_kobo} tone="amber" />
              <p className="mt-1 text-xs text-green-700 dark:text-night-200">{formatNaira(loan.guaranteed_kobo)} of {formatNaira(loan.cover_needed_kobo)} guaranteed</p></div>
          )}
          {loan.status === 'repaying' && <p className="mt-2 text-sm text-green-700 dark:text-night-200">Still to pay: <b>{formatNaira(loan.total_due_kobo)}</b>{loan.overdue && <span className="ml-2 font-bold text-red-600">Overdue</span>}</p>}
          <div className="mt-3 flex gap-1">{[0, 1, 2, 3].map((i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i < stepIdx ? 'bg-green-500' : 'bg-green-100 dark:bg-night-600'}`} />)}</div>
        </Card>
      ) : (
        <Card onClick={() => nav('/coop/loans/new')}>
          <div className="flex items-center gap-3"><Coins className="h-6 w-6 text-green-600" />
            <div className="flex-1"><p className="font-bold text-green-900 dark:text-white">Need a loan?</p><p className="text-sm text-green-700 dark:text-night-200">Up to {formatNaira(r.loan_max_kobo)} over {r.loan_term_months} months, backed by guarantors.</p></div>
            <ChevronRight className="h-4 w-4 text-green-300" /></div>
        </Card>
      )}

      <SectionTitle>Open to everyone</SectionTitle>
      <Card onClick={() => nav('/coop/transparency')}>
        <div className="flex items-center gap-3"><BarChart3 className="h-6 w-6 text-green-600" />
          <div className="flex-1"><p className="font-bold text-green-900 dark:text-white">Transparency</p><p className="text-sm text-green-700 dark:text-night-200">Daily contributions, loans out, and the profit shared at year end.</p></div>
          <ChevronRight className="h-4 w-4 text-green-300" /></div>
      </Card>

      <SectionTitle>Your track record</SectionTitle>
      <Card><div className="grid grid-cols-3 gap-3">
        <Stat label="Member for" value={`${m.months_member}m`} />
        <Stat label="Loans repaid" value={`${m.loans_repaid}/${m.loans_taken}`} />
        <Stat label="Guaranteeing" value={m.guarantees_active} sub={`max ${r.guarantee_max_active}`} />
      </div></Card>
      <p className="mt-4 text-center text-[11px] text-green-600 dark:text-night-300">Interest {pctText(r.loan_rate_bps)} flat · overdue charge {pctText(r.overdue_daily_bps)} of the original interest per day</p>

      <TopUpSheet open={topUp} onClose={() => setTopUp(false)} />
      <WithdrawSheet open={wd} onClose={() => setWd(false)} member={m} rules={r} />
    </CoopPage>
  )
}
