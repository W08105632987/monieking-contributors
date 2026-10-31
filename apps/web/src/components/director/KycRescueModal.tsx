import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, ShieldAlert, ArrowRight } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { ActionButton, DirectorModal, Notice, PinField } from './DirectorModal'

interface Status { full_name: string; kyc_complete: boolean; nin_last4: string | null; account_name: string | null; has_virtual_account: boolean }
interface Lookup { verified_name: string; registered_name: string; name_matches: boolean; id_masked: string; proof: string }
const field = 'mt-1 w-full rounded-xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2.5 text-sm text-green-950 dark:text-white'

/**
 * Help someone who cannot pass identity verification. The usual cause is a nickname on the account, so their name does not
 * match the NIN. The director looks the NIN up, sees both names side by side, corrects the account name if needed, and can
 * finish the verification for them. Changes need the director's PIN and are written to the audit log.
 */
export function KycRescueModal({ open, onClose, personId, name }: { open: boolean; onClose: () => void; personId: string; name: string }) {
  const qc = useQueryClient()
  const base = `/customer-admin/${personId}/kyc`
  const [status, setStatus] = useState<Status | null>(null)
  const [nin, setNin] = useState('')
  const [look, setLook] = useState<Lookup | null>(null)
  const [newName, setNewName] = useState('')
  const [reason, setReason] = useState('The name on the account did not match the NIN')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [nameOnly, setNameOnly] = useState(false)

  useEffect(() => {
    if (!open) return
    setStatus(null); setLook(null); setNin(''); setPin(''); setMsg(null); setNameOnly(false)
    api.get<Status>(base).then(({ data }) => { setStatus(data); setNewName(data.full_name) }).catch((e) => setMsg({ kind: 'error', text: getErrorMessage(e) }))
  }, [open, base])

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg({ kind: 'error', text: getErrorMessage(e) }) } finally { setBusy(false) }
  }
  const lookup = () => run(async () => {
    const { data } = await api.post<Lookup>(`${base}/lookup`, { nin })
    setLook(data); setNewName(data.verified_name)
  })
  const correct = () => run(async () => {
    const { data } = await api.post(`${base}/correct-name`, { new_name: newName, reason, pin })
    setPin('')
    setStatus((s) => (s ? { ...s, full_name: data.full_name } : s))
    setMsg({ kind: 'ok', text: `Name changed to ${data.full_name}. ${data.note ?? ''}`.trim() })
    qc.invalidateQueries()
    if (!nameOnly && nin.length === 11) {   // fresh lookup, so the proof matches the new name
      const r = await api.post<Lookup>(`${base}/lookup`, { nin })
      setLook(r.data)
    } else { setLook(null) }
  })
  const complete = () => run(async () => {
    const { data } = await api.post(`${base}/complete`, { nin, proof: look!.proof, pin })
    setPin(''); setStatus((s) => (s ? { ...s, kyc_complete: true } : s)); setLook(null)
    setMsg({ kind: 'ok', text: `${data.verified_name} is now verified. ${name} was notified.` })
    qc.invalidateQueries()
  })

  return (
    <DirectorModal open={open} title="Help with verification" onClose={onClose} busy={busy}>
      {!status ? <p className="text-sm text-green-700 dark:text-night-200">{msg ? <Notice kind="error">{msg.text}</Notice> : 'Loading…'}</p> : (
        <div className="space-y-3">
          <div className="rounded-xl bg-green-50 dark:bg-night-800 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">Name on the account</p>
            <p className="text-base font-extrabold text-green-950 dark:text-white break-words">{status.full_name}</p>
            <p className="mt-1 text-xs text-green-700 dark:text-night-200">
              {status.kyc_complete ? `Verified${status.nin_last4 ? ` · NIN ending ${status.nin_last4}` : ''}` : 'Not verified yet'}
            </p>
          </div>

          {status.kyc_complete ? (
            <>
              <Notice kind="info">This person is already verified, so their name is locked to the verified name.</Notice>
              {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
            </>
          ) : (
            <>
              <p className="text-xs text-green-800 dark:text-night-100 leading-relaxed">
                Most people fail verification because they signed up with a nickname. Look up their NIN here to see the legal name on it, fix the account name, then complete the verification for them.
              </p>

              <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Their NIN (11 digits)
                <input className={field} inputMode="numeric" value={nin} onChange={(e) => { setNin(e.target.value.replace(/\D/g, '').slice(0, 11)); setLook(null) }} placeholder="12345678901" />
              </label>
              <ActionButton busy={busy} disabled={nin.length !== 11} onClick={lookup}>Look up this NIN</ActionButton>

              {look && (
                <div className="rounded-2xl border border-green-100 dark:border-night-500 p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="font-bold uppercase tracking-wide text-green-600 dark:text-night-300 text-[10px]">On the NIN</p><p className="font-bold text-green-950 dark:text-white break-words">{look.verified_name}</p></div>
                    <div><p className="font-bold uppercase tracking-wide text-green-600 dark:text-night-300 text-[10px]">On the account</p><p className="font-bold text-green-950 dark:text-white break-words">{look.registered_name}</p></div>
                  </div>
                  <p className={`flex items-center gap-1.5 text-xs font-bold ${look.name_matches ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                    {look.name_matches ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                    {look.name_matches ? 'The names match. You can complete the verification.' : 'The names do not match. Correct the account name below.'}
                  </p>
                </div>
              )}

              {(look && !look.name_matches) || nameOnly ? (
                <div className="rounded-2xl border border-amber-200 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 p-3 space-y-2">
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-200">Correct the name on the account</p>
                  <label className="block text-xs font-semibold text-green-700 dark:text-night-200">New full name
                    <input className={field} value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </label>
                  <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Reason
                    <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <PinField value={pin} onChange={setPin} />
                  <ActionButton busy={busy} disabled={newName.trim().length < 3 || reason.trim().length < 5 || pin.length < 4} onClick={correct}>Change the name</ActionButton>
                  <p className="text-[11px] text-amber-700 dark:text-amber-200/90">Their virtual account number was opened in the old name and stays that way. Only the name in the app changes.</p>
                </div>
              ) : null}

              {look?.name_matches && (
                <div className="space-y-2">
                  <PinField value={pin} onChange={setPin} />
                  <ActionButton busy={busy} disabled={pin.length < 4} onClick={complete}>Complete verification for {look.verified_name} <ArrowRight className="ml-1 inline h-4 w-4" /></ActionButton>
                </div>
              )}

              {!look && !nameOnly && (
                <button className="w-full text-center text-xs font-semibold text-green-700 underline underline-offset-2 dark:text-night-200" onClick={() => setNameOnly(true)}>
                  Just fix the name (they will verify themselves)
                </button>
              )}
              {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
            </>
          )}
        </div>
      )}
    </DirectorModal>
  )
}
