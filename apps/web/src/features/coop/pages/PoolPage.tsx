import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HeartHandshake, MessageCircle, Users } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { put, useCoopAction, useCoopStatus, useInvites, usePool, usePoolMe } from '../api'
import { BigButton, Card, CoopPage, Empty, Field, MoneyInput, Pill, Sheet, Skel, dShort, inputCls, toKobo, useCountdown } from '../ui'
import { MemberRow, ReliabilityBadge } from '../parts'

function Countdown({ iso }: { iso: string }) { return <>{useCountdown(iso)}</> }

export default function PoolPage() {
  const nav = useNavigate()
  const [tab, setTab] = useState<'find' | 'me' | 'requests'>('find')
  const { data: invites } = useInvites()
  const { data: pool, isLoading } = usePool()
  const open = invites?.filter((i) => ['invited', 'viewed'].includes(i.status)) ?? []
  useEffect(() => { if (open.length) setTab('requests') }, [open.length])  // eslint-disable-line react-hooks/exhaustive-deps
  const tabs = [['find', 'Find guarantors'], ['requests', `Requests${open.length ? ` (${open.length})` : ''}`], ['me', 'My listing']] as const
  return (
    <CoopPage title="Guarantors" subtitle="Members who back each other's loans">
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-bold ${tab === k ? 'bg-green-700 text-white dark:bg-green-600' : 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100'}`}>{l}</button>)}
      </div>

      {tab === 'find' && (isLoading ? <Skel h="h-40" /> : !pool?.length ? (
        <Empty icon={<Users className="h-7 w-7" />} title="The pool is empty" text="Members who are willing to guarantee loans appear here. You can list yourself too." action={<BigButton onClick={() => setTab('me')}>List myself</BigButton>} />
      ) : (
        <div className="space-y-3">{pool.map((p) => (
          <Card key={p.member_id}>
            <div className="flex items-start justify-between"><button onClick={() => nav(`/coop/members/${p.member_id}`)} className="text-left"><p className="font-extrabold text-green-900 dark:text-white">{p.name}</p><p className="text-xs text-green-600 dark:text-night-300">Member {p.months_member} months · {p.card_no}</p></button>
              <div className="text-right"><p className="text-[10px] font-semibold uppercase text-green-500">Can guarantee</p><p className="font-extrabold text-green-700 dark:text-green-300">{formatNaira(p.available_kobo)}</p></div></div>
            <div className="mt-2 flex flex-wrap gap-1.5"><ReliabilityBadge pct={p.reliability_pct} has={p.has_history} /><Pill>{p.guarantees_total} guaranteed</Pill><Pill>{p.loans_taken} own loans</Pill></div>
            {p.note && <p className="mt-2 text-sm italic text-green-700 dark:text-night-200">"{p.note}"</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => nav(`/coop/members/${p.member_id}`)} className="rounded-xl border border-green-200 py-2 text-sm font-bold text-green-800 dark:border-night-400 dark:text-night-100">View profile</button>
              {p.whatsapp_link && <a href={p.whatsapp_link} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2 text-sm font-bold text-white"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
            </div>
          </Card>))}
          <p className="text-center text-xs text-green-600 dark:text-night-300">Agree the amount on WhatsApp, then invite them from your loan page.</p></div>
      ))}

      {tab === 'requests' && (!invites?.length ? (
        <Empty icon={<HeartHandshake className="h-7 w-7" />} title="No requests" text="When a member asks you to guarantee their loan, it shows up here." />
      ) : (
        <div className="space-y-2">{invites.map((i) => (
          <Card key={i.guarantee_id} onClick={() => nav(`/coop/invites/${i.guarantee_id}`)}>
            <div className="flex items-start justify-between"><div><p className="font-bold text-green-900 dark:text-white">{i.borrower}</p><p className="text-sm text-green-700 dark:text-night-200">{formatNaira(i.amount_kobo)} of {formatNaira(i.principal_kobo)} loan</p></div>
              <Pill tone={i.status === 'signed' ? 'green' : ['invited', 'viewed'].includes(i.status) ? 'amber' : 'grey'}>{i.status === 'signed' ? 'Signed' : ['invited', 'viewed'].includes(i.status) ? 'Needs you' : i.status}</Pill></div>
            <p className="mt-1 text-xs text-green-600 dark:text-night-300">{['invited', 'viewed'].includes(i.status) ? <><Countdown iso={i.expires_at} /> to decide</> : `Sent ${dShort(i.invited_at)}`}</p>
          </Card>))}</div>
      ))}

      {tab === 'me' && <MyListing />}
    </CoopPage>
  )
}

function MyListing() {
  const { data: p } = usePoolMe()
  const { data: s } = useCoopStatus()
  const [listed, setListed] = useState(false)
  const [offer, setOffer] = useState('')
  const [wa, setWa] = useState(false)
  const [note, setNote] = useState('')
  const [sheet, setSheet] = useState(false)
  useEffect(() => { if (p) { setListed(p.listed); setOffer(p.offer_kobo ? String(p.offer_kobo / 100) : ''); setWa(p.whatsapp_ok); setNote(p.note ?? '') } }, [p])
  const save = useCoopAction((v: any) => put('/coop/pool/me', v), { success: 'Saved' })
  if (!p || !s?.rules) return <Skel h="h-40" />
  const r = s.rules
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between"><div><p className="font-extrabold text-green-900 dark:text-white">List me as a guarantor</p><p className="text-sm text-green-700 dark:text-night-200">Borrowers can find you and message you.</p></div>
          <button role="switch" aria-checked={listed} onClick={() => setListed(!listed)} className={`h-7 w-12 rounded-full p-0.5 transition ${listed ? 'bg-green-600' : 'bg-green-200 dark:bg-night-500'}`}><span className={`block h-6 w-6 rounded-full bg-white transition ${listed ? 'translate-x-5' : ''}`} /></button></div>
      </Card>
      {listed && (
        <Card className="space-y-3">
          <Field label="The most I am willing to guarantee" hint={`Between ${formatNaira(p.min_kobo)} and ${formatNaira(p.max_kobo)}. You have ${formatNaira(p.free_kobo)} free.`}><MoneyInput value={offer} onChange={setOffer} /></Field>
          <Field label="A short note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputCls} placeholder="e.g. I only back people I know" /></Field>
          <label className="flex items-start gap-3 text-sm text-green-900 dark:text-white"><input type="checkbox" checked={wa} onChange={(e) => setWa(e.target.checked)} className="mt-0.5 h-5 w-5 accent-green-600" />
            <span>Let borrowers open a WhatsApp chat with me. They get a chat link, not my number on screen.</span></label>
        </Card>)}
      <BigButton loading={save.isPending} onClick={() => save.mutate({ listed, offer_kobo: listed ? toKobo(offer) : 0, whatsapp_ok: wa, note })}>Save my listing</BigButton>
      <button onClick={() => setSheet(true)} className="w-full text-center text-sm font-bold text-green-700 dark:text-night-200">What am I agreeing to?</button>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Being a guarantor">
        <ul className="space-y-2 text-sm text-green-800 dark:text-night-100">
          <li>• You lock your own contribution behind someone's loan, until it is fully repaid.</li>
          <li>• You hold at least {r.guarantor_min_funds_pct}% of the loan in free funds, and back at most {r.guarantee_max_active} loans at once.</li>
          <li>• You earn a share of the guarantors' part ({r.dividend_guarantee_pct}%) of the yearly profit.</li>
          <li>• If a borrower never pays, you can lose the locked money, but only after a full year of recovery and a Board decision.</li>
          <li>• You can see the borrower's contribution history, and they see only your name.</li>
        </ul>
      </Sheet>
    </div>
  )
}

export { MemberRow }
