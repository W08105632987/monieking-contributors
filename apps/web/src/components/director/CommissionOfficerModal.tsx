import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, getErrorMessage } from '@/lib/api'
import { ActionButton, DirectorModal, Notice, PinField } from './DirectorModal'

interface Info { commission_officer_id: string | null; commission_officer_name: string | null; affiliated_officers: { id: string; full_name: string }[] }

/** The director decides, per customer, which affiliated officer (if any) earns commission on their withdrawals. */
export function CommissionOfficerModal({ open, onClose, customerId, name }: { open: boolean; onClose: () => void; customerId: string; name: string }) {
  const qc = useQueryClient()
  const url = `/officer-earnings/customers/${customerId}/commission-officer`
  const [info, setInfo] = useState<Info | null>(null)
  const [pick, setPick] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setInfo(null); setPin(''); setMsg(null)
    api.get<Info>(url).then(({ data }) => { setInfo(data); setPick(data.commission_officer_id ?? '') }).catch((e) => setMsg({ kind: 'error', text: getErrorMessage(e) }))
  }, [open, url])

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const { data } = await api.put(url, { officer_id: pick || null, pin })
      setMsg({ kind: 'ok', text: data.commission_officer_name ? `${data.commission_officer_name} now earns commission on ${name}'s withdrawals.` : `Nobody earns commission on ${name}'s withdrawals now.` })
      setInfo((i) => (i ? { ...i, commission_officer_id: data.commission_officer_id, commission_officer_name: data.commission_officer_name } : i)); setPin('')
      qc.invalidateQueries()
    } catch (e) { setMsg({ kind: 'error', text: getErrorMessage(e) }) } finally { setBusy(false) }
  }

  return (
    <DirectorModal open={open} title="Commission officer" onClose={onClose} busy={busy}>
      {!info ? <p className="text-sm text-green-700 dark:text-night-200">{msg ? <Notice kind="error">{msg.text}</Notice> : 'Loading…'}</p> : (
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100 leading-relaxed">
            Choose who earns commission when {name} withdraws. When you mark a withdrawal paid, that officer gets their share of the company's profit on it. Only affiliated officers can be chosen. You decide, and you can change it any time; it only affects withdrawals paid after the change.
          </p>
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Officer who earns on {name}
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="mt-1 w-full rounded-xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2.5 text-sm text-green-950 dark:text-white">
              <option value="">Nobody earns commission</option>
              {info.affiliated_officers.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            </select>
          </label>
          {info.affiliated_officers.length === 0 && <Notice kind="info">No affiliated officers yet. Make an officer affiliated from the Staff page first.</Notice>}
          <PinField value={pin} onChange={setPin} />
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <ActionButton busy={busy} disabled={pin.length < 4 || pick === (info.commission_officer_id ?? '')} onClick={save}>Save</ActionButton>
        </div>
      )}
    </DirectorModal>
  )
}
