import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Hash, KeyRound, Landmark, Lock, Mail, MessageCircle, Send, Trash2 } from 'lucide-react'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import { ActionButton, DirectorModal, Notice, PinField } from './DirectorModal'

type Which = null | 'reset' | 'password' | 'pin' | 'wpw' | 'fund' | 'delete'
type PwInfo = { password: string; phone: string; email: string | null }
const waNumber = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.startsWith('234') ? d : `234${d.replace(/^0/, '')}` }
const field = 'mt-1 w-full rounded-xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2.5 text-sm text-green-950 dark:text-white'

/** Director-only powers on one customer. Every action needs the director's PIN and is written to the audit log. */
export function CustomerAdminPanel({ customerId, name, kind = 'customer' }: { customerId: string; name: string; kind?: 'customer' | 'officer' }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [which, setWhich] = useState<Which>(null)
  const [pin, setPin] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [ack, setAck] = useState(false)
  const [risk, setRisk] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [pw, setPw] = useState<PwInfo | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const close = () => { if (busy) return; setWhich(null); setPw(null); setSent(null); setPin(''); setAmount(''); setReason(''); setTyped(''); setAck(false); setMsg(null); setRisk(null) }
  const base = `/customer-admin/${customerId}`
  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg({ kind: 'error', text: getErrorMessage(e) }) } finally { setBusy(false) }
  }

  const openDelete = () => { setWhich('delete'); run(async () => setRisk((await api.get(`${base}/delete-preview`)).data)) }
  const doReset = () => run(async () => {
    const r = (await api.post(`${base}/reset-password`, { pin })).data
    setPw({ password: r.temporary_password, phone: r.phone_number, email: r.email ?? null })
    setSent(null); setWhich('password')
  })
  const copyPw = async () => { try { await navigator.clipboard.writeText(pw!.password); toast.success('Password copied') } catch { toast.error('Could not copy. Select the password and copy it by hand.') } }
  const sendPw = (channel: 'sms' | 'email') => run(async () => {
    await api.post(`${base}/send-password`, { channel, temporary_password: pw!.password, pin })
    setSent(channel === 'sms' ? `Sent to ${name} by SMS.` : `Sent to ${pw!.email}.`)
  })
  const waHref = pw ? `https://wa.me/${waNumber(pw.phone)}?text=${encodeURIComponent(`MonieKing: your password was reset. Temporary password: ${pw.password}. Please log in and change it now.`)}` : '#'
  const doClear = (what: 'reset-payment-pin' | 'reset-withdrawal-password') => run(async () => {
    const r = (await api.post(`${base}/${what}`, { pin })).data
    setResult(r.message)
    close()
  })
  const doFund = () => run(async () => {
    const r = (await api.post(`${base}/fund-wallet`, { amount_naira: Number(amount), reason, pin })).data
    setResult(`Wallet funded. New balance ${formatNaira(r.balance_kobo)}. ${name} was notified.`)
    qc.invalidateQueries(); close()
  })
  const doDelete = () => run(async () => {
    const r = (await api.post(`${base}/delete`, { confirm_name: typed, pin, acknowledge_money: ack })).data
    qc.invalidateQueries(); setWhich(null); nav('/director/customers', { replace: true, state: { notice: r.message } })
  })

  const money = risk ? risk.wallet_balance_kobo + risk.card_balance_kobo : 0
  const needsAck = money > 0 && !risk?.is_test
  const row = 'flex w-full items-center gap-3 border-b border-green-50 py-3 text-left last:border-0 dark:border-night-600'

  return (
    <div className="mb-4 rounded-2xl border border-green-100 bg-white px-4 shadow-card dark:border-night-500 dark:bg-night-700">
      <p className="pb-1 pt-4 text-xs font-bold uppercase tracking-widest text-green-500 dark:text-night-200">Director controls</p>
      {result && <div className="mb-2"><Notice kind="ok">{result}</Notice></div>}
      <button className={row} onClick={() => { setResult(null); setWhich('reset') }}><KeyRound className="h-4 w-4 text-green-700 dark:text-night-100" /><span className="flex-1 text-sm font-semibold text-green-900 dark:text-white">Reset password</span></button>
      <button className={row} onClick={() => { setResult(null); setWhich('pin') }}><Hash className="h-4 w-4 text-green-700 dark:text-night-100" /><span className="flex-1 text-sm font-semibold text-green-900 dark:text-white">Reset payment PIN</span></button>
      <button className={row} onClick={() => { setResult(null); setWhich('wpw') }}><Lock className="h-4 w-4 text-green-700 dark:text-night-100" /><span className="flex-1 text-sm font-semibold text-green-900 dark:text-white">Reset withdrawal password</span></button>
      {kind === 'customer' && (
        <>
          <button className={row} onClick={() => { setResult(null); setWhich('fund') }}><Landmark className="h-4 w-4 text-green-700 dark:text-night-100" /><span className="flex-1 text-sm font-semibold text-green-900 dark:text-white">Fund wallet manually</span></button>
          <button className={row} onClick={() => { setResult(null); openDelete() }}><Trash2 className="h-4 w-4 text-red-500" /><span className="flex-1 text-sm font-semibold text-red-600">Delete customer</span></button>
        </>
      )}

      <DirectorModal open={which === 'reset'} title="Reset password" onClose={close} busy={busy}>
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100">{name}'s password becomes their phone number followed by MK. You will see it next and choose how to send it: copy it, WhatsApp, SMS or email. The app makes them choose their own password every time they log in until they do.</p>
          <PinField value={pin} onChange={setPin} />
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <ActionButton busy={busy} disabled={pin.length < 4} onClick={doReset}>Reset password</ActionButton>
        </div>
      </DirectorModal>

      <DirectorModal open={which === 'password'} title="New temporary password" onClose={close} busy={busy}>
        {pw && (
          <div className="space-y-3">
            <Notice kind="ok">{name}’s password was reset. The old one no longer works.</Notice>
            <div className="rounded-2xl bg-green-50 p-4 text-center dark:bg-night-800">
              <p className="text-[11px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">Default password</p>
              <p className="mt-1 select-all break-all font-mono text-2xl font-extrabold tracking-wider text-green-950 dark:text-white">{pw.password}</p>
            </div>
            <ActionButton tone="ghost" onClick={copyPw}><Copy className="mr-1 inline h-4 w-4" />Copy password</ActionButton>
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-bold text-white"><MessageCircle className="h-4 w-4" />Send on WhatsApp</a>
            <ActionButton tone="ghost" busy={busy} onClick={() => sendPw('sms')}><Send className="mr-1 inline h-4 w-4" />Send by SMS to {pw.phone}</ActionButton>
            {pw.email
              ? <ActionButton tone="ghost" busy={busy} onClick={() => sendPw('email')}><Mail className="mr-1 inline h-4 w-4" />Send to {pw.email}</ActionButton>
              : <p className="text-center text-[11px] text-green-600 dark:text-night-300">No verified email on this account, so email is not available.</p>}
            {sent && <Notice kind="ok">{sent}</Notice>}
            {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
            <p className="text-center text-[11px] text-green-600 dark:text-night-300">This password is only shown now. Close this window and it is gone.</p>
          </div>
        )}
      </DirectorModal>

      <DirectorModal open={which === 'pin'} title="Reset payment PIN" onClose={close} busy={busy}>
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100">Clears {name}'s payment PIN. They are asked to set a new 4-digit PIN in the app before their next payment, and are notified. A PIN lockout is lifted too.</p>
          <PinField value={pin} onChange={setPin} />
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <ActionButton busy={busy} disabled={pin.length < 4} onClick={() => doClear('reset-payment-pin')}>Reset payment PIN</ActionButton>
        </div>
      </DirectorModal>

      <DirectorModal open={which === 'wpw'} title="Reset withdrawal password" onClose={close} busy={busy}>
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100">Clears {name}'s withdrawal password. They set a new one in the app before their next withdrawal, and are notified. A lockout is lifted too.</p>
          <PinField value={pin} onChange={setPin} />
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <ActionButton busy={busy} disabled={pin.length < 4} onClick={() => doClear('reset-withdrawal-password')}>Reset withdrawal password</ActionButton>
        </div>
      </DirectorModal>

      <DirectorModal open={which === 'fund'} title="Fund wallet manually" onClose={close} busy={busy}>
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100">Adds money to {name}'s wallet exactly like a normal deposit. It is recorded in the audit log and they are notified.</p>
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Amount (₦)<input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></label>
          <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Reason (required)<textarea className={field} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bank transfer received, reference 12345" /></label>
          <PinField value={pin} onChange={setPin} />
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <ActionButton busy={busy} disabled={!(Number(amount) > 0) || reason.trim().length < 5 || pin.length < 4} onClick={doFund}>Fund {Number(amount) > 0 ? `₦${Number(amount).toLocaleString()}` : 'wallet'}</ActionButton>
        </div>
      </DirectorModal>

      <DirectorModal open={which === 'delete'} title="Delete customer" onClose={close} busy={busy}>
        {!risk ? <p className="text-sm text-green-700">{msg ? <Notice kind="error">{msg.text}</Notice> : 'Checking what is at stake…'}</p> : (
          <div className="space-y-3">
            <div className="rounded-xl bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200 space-y-1">
              <p className="font-bold">{risk.explain}</p>
              <p>Wallet balance: <b>{formatNaira(risk.wallet_balance_kobo)}</b></p>
              <p>Money on cards: <b>{formatNaira(risk.card_balance_kobo)}</b> · Cards: {risk.cards_active} active of {risk.cards_total}</p>
              <p>Unpaid withdrawals: <b>{risk.unpaid_withdrawals.length}</b>{risk.unpaid_withdrawals.length ? ` (${formatNaira(risk.unpaid_withdrawals.reduce((a: number, w: any) => a + w.amount_kobo, 0))})` : ''}</p>
            </div>
            {risk.blocked && <Notice kind="error">Settle or reject the unpaid withdrawals first. This customer cannot be deleted until then.</Notice>}
            {needsAck && <label className="flex items-start gap-2 text-xs text-green-800 dark:text-night-100"><input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand this customer still holds money and I have dealt with it.</label>}
            <label className="block text-xs font-semibold text-green-700 dark:text-night-200">Type <b>{risk.full_name}</b> to confirm<input className={field} value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
            <PinField value={pin} onChange={setPin} />
            {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
            <ActionButton tone="red" busy={busy} disabled={risk.blocked || typed.trim().toLowerCase() !== risk.full_name.trim().toLowerCase() || pin.length < 4 || (needsAck && !ack)} onClick={doDelete}>
              {risk.mode === 'delete' ? 'Delete for good' : 'Close account and wipe details'}
            </ActionButton>
          </div>
        )}
      </DirectorModal>
    </div>
  )
}
