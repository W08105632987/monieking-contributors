import { useParams } from 'react-router-dom'
import { MessageCircle, Phone, ShieldCheck } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { useProfile } from '../api'
import { Card, CoopPage, Pill, SectionTitle, Skel, Stat, dShort } from '../ui'
import { ReliabilityBadge } from '../parts'

const TYPE: Record<string, string> = { registration: 'Joined', contribution: 'Contribution', withdrawal: 'Withdrawal' }

export default function MemberProfilePage() {
  const { id } = useParams()
  const { data: p, error } = useProfile(id)
  if (error) return <CoopPage title="Profile" back><Card><p className="text-sm font-semibold text-red-600">{(error as any)?.response?.data?.detail ?? 'You cannot view this profile.'}</p></Card></CoopPage>
  if (!p) return <CoopPage title="Profile" back><Skel h="h-48" /></CoopPage>
  const youAre = { self: 'This is how you appear to others', guarantor: 'You can see this because you were asked to guarantee their loan', director: 'Director view', member: '' }[p.you_are]
  return (
    <CoopPage title={p.name} subtitle={p.card_no} back>
      <Card>
        <div className="flex flex-wrap items-center gap-2"><ReliabilityBadge pct={p.reliability_pct} has={p.has_history} />{p.nin_linked && <Pill tone="green"><ShieldCheck className="h-3 w-3" />NIN verified</Pill>}{p.pool_listed && <Pill tone="blue">In guarantors' pool</Pill>}</div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Stat label="Member since" value={dShort(p.member_since)} sub={`${p.months_member} months`} />
          <Stat label="Own loans" value={`${p.loans_repaid}/${p.loans_taken}`} sub="repaid / taken" />
          <Stat label="Guaranteeing now" value={p.guarantees_active} />
          <Stat label="Ever guaranteed" value={p.guarantees_total} />
        </div>
        {p.pool_listed && <p className="mt-3 text-sm text-green-800 dark:text-night-100">Willing to guarantee up to <b>{formatNaira(p.pool_offer_kobo)}</b>.{p.pool_note ? ` "${p.pool_note}"` : ''}</p>}
        {p.whatsapp_link && <a href={p.whatsapp_link} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white"><MessageCircle className="h-4 w-4" />Talk on WhatsApp</a>}
      </Card>
      {youAre && <p className="mt-2 text-xs text-green-600 dark:text-night-300">{youAre}</p>}
      {p.private && (
        <>
          <SectionTitle>Contribution and contact</SectionTitle>
          <Card><div className="grid grid-cols-3 gap-3"><Stat label="Held" value={formatNaira(p.private.contribution_kobo)} /><Stat label="Locked" value={formatNaira(p.private.locked_kobo)} /><Stat label="Free" value={formatNaira(p.private.free_kobo)} /></div>
            <p className="mt-3 flex items-center gap-2 text-sm text-green-800 dark:text-night-100"><Phone className="h-4 w-4" />{p.private.phone}{p.private.state ? ` · ${p.private.state}` : ''}</p></Card>
          <SectionTitle>Contribution history</SectionTitle>
          <div className="space-y-2 pb-2">{p.private.history.map((h, i) => (
            <Card key={i}><div className="flex items-center justify-between"><div><p className="text-sm font-bold text-green-900 dark:text-white">{TYPE[h.type] ?? h.type}</p><p className="text-xs text-green-600 dark:text-night-300">{dShort(h.date)}</p></div>
              <p className={`font-extrabold ${h.delta_kobo < 0 ? 'text-red-600' : 'text-green-700 dark:text-green-300'}`}>{h.delta_kobo < 0 ? '−' : '+'}{formatNaira(Math.abs(h.delta_kobo))}</p></div></Card>))}</div>
        </>
      )}
    </CoopPage>
  )
}
