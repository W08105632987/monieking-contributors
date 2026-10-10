import { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import { post, useCoopAction } from '../api'
import { BigButton, Card, Field, Pill, SectionTitle, Skel, dShort, inputCls } from '../ui'
import { useAdmin } from './dapi'

export default function PeopleTab() {
  const [sub, setSub] = useState<'pilot' | 'members' | 'dividend'>('pilot')
  return (
    <>
      <div className="mb-3 flex gap-2">{([['pilot', 'Pilot list'], ['members', 'Members'], ['dividend', 'Dividend']] as const).map(([k, l]) => <button key={k} onClick={() => setSub(k)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${sub === k ? 'bg-green-700 text-white' : 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100'}`}>{l}</button>)}</div>
      {sub === 'pilot' && <Pilot />}{sub === 'members' && <Members />}{sub === 'dividend' && <DividendPreview />}
    </>
  )
}

function Pilot() {
  const { data } = useAdmin<any[]>('pilot', '/coop/admin/pilot')
  const [phone, setPhone] = useState('')
  const add = useCoopAction((p: string) => post('/coop/admin/pilot', { phone_number: p }), { success: 'Added to the pilot list', onSuccess: () => setPhone('') })
  const remove = useCoopAction((id: string) => api.delete(`/coop/admin/pilot/${id}`).then((r) => r.data), { success: 'Removed' })
  return (
    <>
      <Card><Field label="Add a customer by phone number" hint="Only customers on this list can see the cooperative while the pilot is on."><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="08012345678" className={inputCls} /></Field>
        <div className="mt-3"><BigButton loading={add.isPending} disabled={phone.length < 7} onClick={() => add.mutate(phone.trim())}><UserPlus className="h-4 w-4" />Add</BigButton></div></Card>
      <SectionTitle>On the list ({data?.length ?? 0})</SectionTitle>
      <div className="space-y-2">{!data ? <Skel /> : data.map((p) => (
        <Card key={p.user_id}><div className="flex items-center justify-between"><div><p className="font-bold text-green-900 dark:text-white">{p.name}</p><p className="text-xs text-green-600 dark:text-night-300">{p.phone} · added {dShort(p.added_at)}</p></div>
          <button onClick={() => remove.mutate(p.user_id)} aria-label="Remove" className="rounded-full p-2 text-red-500"><X className="h-5 w-5" /></button></div></Card>))}</div>
    </>
  )
}

function Members() {
  const { data } = useAdmin<any[]>('members', '/coop/admin/members')
  if (!data) return <Skel h="h-40" />
  if (!data.length) return <p className="text-sm text-green-700 dark:text-night-200">Nobody has joined yet.</p>
  return (
    <div className="space-y-2">{data.map((m) => (
      <Card key={m.member_id}>
        <div className="flex items-start justify-between"><div><p className="font-bold text-green-900 dark:text-white">{m.name}</p><p className="text-xs text-green-600 dark:text-night-300">{m.card_no} · {m.phone}</p></div>
          <div className="flex flex-col items-end gap-1">{m.nin_bypassed && <Pill tone="amber">No NIN (test)</Pill>}{m.pool_listed && <Pill tone="blue">Guarantor</Pill>}</div></div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs"><div><p className="text-green-500">Held</p><b>{formatNaira(m.contribution_kobo)}</b></div><div><p className="text-green-500">Locked</p><b>{formatNaira(m.locked_kobo)}</b></div><div><p className="text-green-500">On time</p><b>{m.reliability_pct === null ? '—' : `${m.reliability_pct}%`}</b></div></div>
      </Card>))}</div>
  )
}

function DividendPreview() {
  const { data } = useAdmin<any>('dividend', '/coop/admin/dividend')
  if (!data) return <Skel h="h-40" />
  return (
    <>
      <Card><p className="text-xs font-semibold uppercase text-green-500">Dividend pool {data.year}</p><p className="text-3xl font-extrabold text-green-900 dark:text-white">{formatNaira(data.pool_kobo)}</p>
        <p className="text-sm text-green-700 dark:text-night-200">{data.contribution_pct}% contributors {formatNaira(data.contribution_pool_kobo)} · {data.guarantee_pct}% guarantors {formatNaira(data.guarantee_pool_kobo)}</p>
        <p className="mt-2 text-xs text-green-600 dark:text-night-300">Share-out check: {formatNaira(data.paid_out_check_kobo)} allocated of {formatNaira(data.pool_kobo)}. {data.basis}</p></Card>
      <SectionTitle>Member by member</SectionTitle>
      <div className="space-y-2">{data.members.map((m: any) => (
        <Card key={m.member_id}><div className="flex items-start justify-between"><div><p className="font-bold text-green-900 dark:text-white">{m.name}</p><p className="text-xs text-green-600 dark:text-night-300">{m.qualifies ? 'Qualifies' : m.reason}</p></div><p className="font-extrabold text-green-700 dark:text-green-300">{formatNaira(m.total_kobo)}</p></div></Card>))}</div>
      <p className="py-3 text-center text-xs text-green-600 dark:text-night-300">Preview only. Paying a dividend is not built yet: it needs the accountant's preparation and the directors' approval.</p>
    </>
  )
}
