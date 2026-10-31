import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BadgeDollarSign, Banknote } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ActionButton, DirectorModal, Notice, PinField } from './DirectorModal'

export interface TypeTarget { id: string; full_name: string; officer_type?: 'salary' | 'affiliated' | null }
const field = 'mt-1 w-full rounded-xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2.5 text-sm text-green-950 dark:text-white'

/** Choose how one officer is paid: salary (as before) or affiliated (a share of the company's profit). */
export function OfficerTypeModal({ open, officer, onClose }: { open: boolean; officer: TypeTarget | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [type, setType] = useState<'salary' | 'affiliated' | null>(null)
  const [percent, setPercent] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  useEffect(() => { if (open) { setType(officer?.officer_type ?? null); setPercent(''); setPin(''); setMsg(null) } }, [open, officer])

  const { data: global } = useQuery({
    queryKey: ['settings-registry'],
    queryFn: async () => (await api.get('/settings/registry')).data as { settings: { key: string; value: string }[] },
    enabled: open,
  })
  const globalPct = global?.settings.find((s) => s.key === 'affiliated_officer_commission_percent')?.value ?? '30'

  const save = async () => {
    if (!officer || !type) return
    setBusy(true); setMsg(null)
    try {
      await api.patch(`/officer-earnings/officers/${officer.id}/type`, { officer_type: type, commission_percent: type === 'affiliated' && percent !== '' ? Number(percent) : null, pin })
      qc.invalidateQueries()
      setMsg({ kind: 'ok', text: `${officer.full_name} is now ${type === 'affiliated' ? 'an affiliated' : 'a salary'} officer.` })
      setPin('')
      window.setTimeout(onClose, 900)
    } catch (e) { setMsg({ kind: 'error', text: getErrorMessage(e) }) } finally { setBusy(false) }
  }

  const card = (id: 'salary' | 'affiliated', Icon: typeof Banknote, title: string, text: string) => (
    <button type="button" onClick={() => setType(id)}
      className={cn('flex w-full gap-3 rounded-2xl border-2 p-3 text-left transition', type === id ? 'border-green-600 bg-green-50 dark:bg-green-900/30' : 'border-green-100 dark:border-night-500')}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-green-700 dark:text-night-100" />
      <span><span className="block text-sm font-extrabold text-green-950 dark:text-white">{title}</span><span className="block text-xs text-green-700 dark:text-night-200 leading-relaxed">{text}</span></span>
    </button>
  )

  return (
    <DirectorModal open={open} title={officer ? `How is ${officer.full_name} paid?` : 'Officer type'} onClose={onClose} busy={busy}>
      <div className="space-y-3">
        {card('salary', Banknote, 'Salary officer', 'Paid by the company, as officers always were. Sees the normal officer app.')}
        {card('affiliated', BadgeDollarSign, 'Affiliated officer', `Earns a share of the company's profit on the withdrawals of the customers you assign to them. Gets an Earnings page, a payout button and a welcome screen. Same role, slightly different screens.`)}
        {type === 'affiliated' && (
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Their own rate, % (optional)
            <input className={field} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder={`Leave empty to use the company rate (${globalPct}%)`} />
          </label>
        )}
        {officer?.officer_type === 'affiliated' && type === 'salary' && (
          <p className="flex gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" />They stop earning commission. This is refused while they still have unpaid commission or a pending payout.</p>
        )}
        <PinField value={pin} onChange={setPin} />
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <ActionButton busy={busy} disabled={!type || pin.length < 4 || (percent !== '' && Number(percent) > 100)} onClick={save}>Save</ActionButton>
      </div>
    </DirectorModal>
  )
}

/** Shown to a director while any officer has no type yet (every officer that existed before this feature). */
export function OfficerClassifyBanner() {
  const { data = [] } = useQuery({
    queryKey: ['officers-unclassified'],
    queryFn: async () => (await api.get<{ id: string; full_name: string; phone_number: string }[]>('/officer-earnings/unclassified')).data,
  })
  const [list, setList] = useState(false)
  const [target, setTarget] = useState<TypeTarget | null>(null)
  if (data.length === 0) return null
  return (
    <>
      <div className="mb-4 rounded-2xl border border-amber-300 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-500/10 p-4">
        <p className="flex items-center gap-2 text-sm font-extrabold text-amber-900 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />{data.length} officer{data.length === 1 ? '' : 's'} need a decision</p>
        <p className="mt-1 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">Choose whether each existing officer stays a salary officer or becomes an affiliated (commission) officer. Until you choose, they work as before and earn no commission.</p>
        <button onClick={() => setList(true)} className="mt-3 rounded-full bg-amber-500 px-4 py-2 text-xs font-bold text-green-950">Choose now</button>
      </div>
      <DirectorModal open={list && !target} title="Choose for each officer" onClose={() => setList(false)}>
        <div className="space-y-2">
          {data.map((o) => (
            <button key={o.id} onClick={() => setTarget({ id: o.id, full_name: o.full_name, officer_type: null })}
              className="flex w-full items-center justify-between rounded-xl border border-green-100 dark:border-night-500 px-3 py-3 text-left">
              <span><span className="block text-sm font-bold text-green-950 dark:text-white">{o.full_name}</span><span className="block text-xs text-green-600 dark:text-night-300">{o.phone_number}</span></span>
              <span className="text-xs font-bold text-green-700 dark:text-night-100">Choose</span>
            </button>
          ))}
        </div>
      </DirectorModal>
      <OfficerTypeModal open={!!target} officer={target} onClose={() => setTarget(null)} />
    </>
  )
}
