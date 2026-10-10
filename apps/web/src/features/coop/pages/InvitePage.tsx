import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronRight, FileSignature, Lock } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { post, useCoopAction, useInvite } from '../api'
import { BigButton, Card, CoopPage, Field, Pill, SectionTitle, Skel, inputCls, useCountdown } from '../ui'
import { SafetyNote } from '../parts'

export default function InvitePage() {
  const { id } = useParams()
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { data: d } = useInvite(id)
  const left = useCountdown(d?.expires_at)
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  const [name, setName] = useState('')
  const sign = useCoopAction(() => post(`/coop/invites/${id}/sign`, { ticks, typed_name: name }), { success: 'Signed. Your money is now locked behind this loan.' })
  const decline = useCoopAction(() => post(`/coop/invites/${id}/decline`), { success: 'Declined', onSuccess: () => nav('/coop/pool', { replace: true }) })
  if (!d) return <CoopPage title="Guarantor request" back="/coop/pool"><Skel h="h-48" /></CoopPage>
  const live = ['invited', 'viewed'].includes(d.status)
  const all = d.ticks.every((t) => ticks[t.key])
  return (
    <CoopPage title="Guarantor request" back="/coop/pool" right={live ? <Pill tone="amber">{left}</Pill> : <Pill tone={d.status === 'signed' ? 'green' : 'grey'}>{d.status}</Pill>}>
      <Card>
        <p className="text-xs font-semibold uppercase text-green-500 dark:text-night-300">{d.borrower.name} asks you to guarantee</p>
        <p className="text-3xl font-extrabold text-green-900 dark:text-white">{formatNaira(d.amount_kobo)}</p>
        <p className="text-sm text-green-700 dark:text-night-200">of a {formatNaira(d.loan.principal_kobo)} loan ({d.loan.loan_no}, {d.loan.term_months} months){d.loan.purpose ? ` for "${d.loan.purpose}"` : ''}</p>
        <button onClick={() => nav(`/coop/members/${d.borrower.member_id}`)} className="mt-3 flex w-full items-center justify-between rounded-xl bg-green-100/70 px-3 py-2.5 text-sm font-bold text-green-800 dark:bg-night-600 dark:text-night-100">See {d.borrower.name.split(' ')[0]}'s contribution history and record<ChevronRight className="h-4 w-4" /></button>
      </Card>

      {live && (
        <>
          <Card className={`mt-3 ${d.eligible ? '' : 'border-red-300 bg-red-50 dark:bg-red-500/10'}`}>
            <div className="flex items-center gap-2 text-sm"><Lock className="h-4 w-4" />
              <p className="text-green-900 dark:text-white">{d.eligible ? <>Your free funds <b>{formatNaira(d.free_kobo)}</b> are enough. <b>{formatNaira(d.amount_kobo)}</b> will be locked when you sign.</> : <>You need <b>{formatNaira(d.needs_free_kobo)}</b> free to sign, and have <b>{formatNaira(d.free_kobo)}</b>. Add money first.</>}</p></div>
          </Card>
          <SectionTitle>The agreement</SectionTitle>
          <Card><pre className="max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-green-900 dark:text-night-100">{d.contract_text}</pre></Card>
          <p className="mt-1 text-[11px] text-green-600 dark:text-night-300">Version {d.contract_version}. The exact text you sign is saved permanently.</p>
          <SectionTitle>Please confirm</SectionTitle>
          <div className="space-y-2">{d.ticks.map((t) => (
            <label key={t.key} className="flex items-start gap-3 rounded-xl border border-green-100 bg-white p-3 text-sm text-green-900 dark:border-night-500 dark:bg-night-700 dark:text-white">
              <input type="checkbox" checked={!!ticks[t.key]} onChange={(e) => setTicks({ ...ticks, [t.key]: e.target.checked })} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-green-600" /><span>{t.label}</span></label>))}</div>
          <div className="mt-3"><Field label="Type your full name to sign" hint={`Exactly as on your account: ${user?.full_name}`}><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoComplete="off" /></Field></div>
          <div className="mt-3"><SafetyNote>The preview does not ask for a PIN or code when signing. That step is added before real money is used.</SafetyNote></div>
          <div className="mt-4 space-y-2"><BigButton loading={sign.isPending} disabled={!all || !name.trim() || !d.eligible} onClick={() => sign.mutate(undefined)}><FileSignature className="h-4 w-4" />Sign and lock {formatNaira(d.amount_kobo)}</BigButton>
            <BigButton tone="ghost" loading={decline.isPending} onClick={() => decline.mutate(undefined)}>Decline</BigButton></div>
        </>
      )}
      {d.status === 'signed' && (
        <Card className="mt-3 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-green-500" /><p className="mt-1 font-extrabold text-green-900 dark:text-white">You signed this guarantee</p><p className="text-sm text-green-700 dark:text-night-200">Your {formatNaira(d.amount_kobo)} stays locked until the loan is fully repaid.</p>
          {d.contract_text && <details className="mt-3 text-left"><summary className="cursor-pointer text-sm font-bold text-green-700 dark:text-night-200">See the agreement you signed</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] text-green-900 dark:text-night-100">{d.contract_text}</pre></details>}</Card>
      )}
      {!live && d.status !== 'signed' && <Card className="mt-3"><p className="text-sm text-green-800 dark:text-night-100">This request is {d.status}. Nothing was locked.</p></Card>}
    </CoopPage>
  )
}
