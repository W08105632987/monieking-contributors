import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ChevronRight, FlaskConical, ShieldCheck } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { post, useCoopAction, useCoopStatus } from '../api'
import { BigButton, Card, CoopPage, Field, MoneyInput, Pill, pctText, toKobo } from '../ui'

export default function JoinPage() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user) as any
  const { data: s } = useCoopStatus()
  const r = s?.rules
  const [step, setStep] = useState(0)
  const [amt, setAmt] = useState('')
  const [agree, setAgree] = useState(false)
  const [bypass, setBypass] = useState(false)
  const [done, setDone] = useState<any>(null)
  const join = useCoopAction((v: { amount_kobo: number; nin_bypass: boolean }) => post('/coop/join', v), { onSuccess: (m) => { setDone(m); setStep(4) } })
  if (!r) return <CoopPage title="Join" back="/coop"><div /></CoopPage>
  const ninOk = !!user?.nin_linked || bypass
  const min = r.registration_min_kobo
  const next = () => setStep((x) => x + 1)

  return (
    <CoopPage title="Join the Cooperative" back={step < 4 ? '/coop' : false} subtitle={step < 4 ? `Step ${step + 1} of 4` : undefined}>
      <div className="mb-4 flex gap-1.5">{[0, 1, 2, 3].map((i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= Math.min(step, 3) ? 'bg-green-500' : 'bg-green-100 dark:bg-night-600'}`} />)}</div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.18 }}>
          {step === 0 && (
            <div className="space-y-3">
              <h2 className="text-xl font-extrabold text-green-900 dark:text-white">What you are joining</h2>
              <Card>
                <ul className="space-y-2 text-sm text-green-800 dark:text-night-100">
                  <li>• You save with the cooperative. Everyone can see the daily totals.</li>
                  <li>• You can ask for a loan if guarantors back it and two directors approve it.</li>
                  <li>• You can guarantee other members and earn a share of the interest.</li>
                  <li>• At year end the profit is shared: {r.dividend_contribution_pct}% to contributors, {r.dividend_guarantee_pct}% to guarantors.</li>
                </ul>
              </Card>
              <BigButton onClick={next}>Continue <ChevronRight className="h-4 w-4" /></BigButton>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-3">
              <h2 className="text-xl font-extrabold text-green-900 dark:text-white">The rules, in plain words</h2>
              <Card className="space-y-2 text-sm text-green-800 dark:text-night-100">
                <p>• Loans go up to <b>{formatNaira(r.loan_max_kobo)}</b>, for at most <b>{r.loan_term_months} months</b>, repaid in equal monthly instalments.</p>
                <p>• Interest is <b>{pctText(r.loan_rate_bps)}</b> of the loan and is always paid in full, even if you repay early.</p>
                <p>• If a loan is overdue, a charge of <b>{pctText(r.overdue_daily_bps)} of the original interest</b> is added every day.</p>
                <p>• Withdrawing early costs <b>{pctText(r.early_withdrawal_bps)}</b>, and you do not share that year's dividend.</p>
                <p>• To share a dividend you need at least <b>{formatNaira(r.dividend_min_balance_kobo)}</b> held for <b>{r.dividend_min_months} months</b>.</p>
              </Card>
              <label className="flex items-start gap-3 rounded-xl bg-white p-3 dark:bg-night-700">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 accent-green-600" />
                <span className="text-sm text-green-900 dark:text-white">I have read these rules and I want to join.</span>
              </label>
              <BigButton disabled={!agree} onClick={next}>Continue</BigButton>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-3">
              <h2 className="text-xl font-extrabold text-green-900 dark:text-white">Your identity</h2>
              <Card>
                <div className="flex items-center gap-3">
                  <ShieldCheck className={`h-6 w-6 ${user?.nin_linked ? 'text-green-600' : 'text-amber-500'}`} />
                  <div className="flex-1"><p className="font-bold text-green-900 dark:text-white">{user?.full_name}</p>
                    <p className="text-sm text-green-700 dark:text-night-200">{user?.nin_linked ? 'NIN linked' : 'NIN not linked yet'}</p></div>
                  <Pill tone={user?.nin_linked ? 'green' : 'amber'}>{user?.nin_linked ? 'Verified' : 'Needed'}</Pill>
                </div>
              </Card>
              {!user?.nin_linked && (
                <label className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                  <FlaskConical className="mt-0.5 h-4 w-4 text-amber-700" />
                  <span className="flex-1 text-sm text-amber-900 dark:text-amber-200">Tester option: continue without a linked NIN. This will be marked on your membership so the directors can see it.</span>
                  <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} className="mt-0.5 h-5 w-5 accent-amber-600" />
                </label>
              )}
              <BigButton disabled={!ninOk} onClick={next}>Continue</BigButton>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-3">
              <h2 className="text-xl font-extrabold text-green-900 dark:text-white">Your first contribution</h2>
              <Field label="Amount" hint={`Minimum ${formatNaira(min)}. This becomes your first contribution and stays yours.`}>
                <MoneyInput value={amt} onChange={setAmt} autoFocus />
              </Field>
              <div className="flex gap-2">{[min, 100_000, 500_000, 2_000_000].map((k) => (
                <button key={k} onClick={() => setAmt(String(k / 100))} className="flex-1 rounded-full border border-green-200 py-1.5 text-xs font-bold text-green-800 dark:border-night-400 dark:text-night-100">{formatNaira(k)}</button>))}</div>
              <BigButton loading={join.isPending} disabled={toKobo(amt) < min} onClick={() => join.mutate({ amount_kobo: toKobo(amt), nin_bypass: bypass })}>Join the Cooperative</BigButton>
            </div>
          )}
          {step === 4 && done && (
            <div className="flex flex-col items-center pt-6 text-center">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}><CheckCircle2 className="h-20 w-20 text-green-500" /></motion.div>
              <h2 className="mt-4 text-2xl font-extrabold text-green-900 dark:text-white">Welcome aboard!</h2>
              <p className="mt-1 text-sm text-green-700 dark:text-night-200">Your cooperative card</p>
              <div className="mt-3 w-full rounded-3xl bg-hero-gradient p-5 text-left text-white dark:bg-night-gradient">
                <p className="text-xs uppercase tracking-widest text-green-300">MonieKing Cooperative</p>
                <p className="mt-6 text-2xl font-extrabold tracking-wider">{done.card_no}</p>
                <p className="mt-2 text-sm">{user?.full_name}</p>
              </div>
              <div className="mt-5 w-full"><BigButton onClick={() => nav('/coop', { replace: true })}>Go to my cooperative</BigButton></div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </CoopPage>
  )
}
