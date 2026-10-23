import { ArrowDownToLine } from 'lucide-react'
import { ask } from '@/lib/dialog'
import { formatNaira } from '@/lib/utils'
import { post, useCoopAction, useCoopQ, type WithdrawalRow } from '../api'
import { Card, CoopPage, Empty, Pill, Skel, dShort } from '../ui'
import { ViewAll } from '../lists'

export const WD_TONE: Record<string, { tone: 'amber' | 'green' | 'red' | 'grey'; label: string }> = {
  pending: { tone: 'amber', label: 'Pending' }, paid: { tone: 'green', label: 'Paid' }, rejected: { tone: 'red', label: 'Not paid' }, cancelled: { tone: 'grey', label: 'Cancelled' },
}

/** Every withdrawal request the member made, and where each one stands. */
export default function WithdrawalsPage() {
  const { data } = useCoopQ<{ total: number; items: WithdrawalRow[] }>('withdrawals', '/coop/withdrawals', { limit: 50 })
  const cancel = useCoopAction((id: string) => post(`/coop/withdrawals/${id}/cancel`), { success: 'Request cancelled. The money is back in your contribution.' })
  return (
    <CoopPage title="My withdrawals" subtitle="Requests you sent to the directors" back="/coop/me">
      {!data ? <Skel h="h-40" /> : !data.items.length ? (
        <Empty icon={<ArrowDownToLine className="h-7 w-7" />} title="No withdrawals yet" text="When you withdraw, a director sends the money to your bank account and you can follow it here." />
      ) : (
        <ViewAll items={data.items} startOpen render={(w) => { const t = WD_TONE[w.status]; return (
          <Card key={w.id}>
            <div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-green-500 dark:text-night-300">{dShort(w.created_at)}</p><p className="text-lg font-extrabold text-green-900 dark:text-white">{formatNaira(w.amount_kobo)}</p></div><Pill tone={t.tone}>{t.label}</Pill></div>
            <p className="mt-1 text-xs text-green-700 dark:text-night-200">Charge {formatNaira(w.charge_kobo)} · you receive {formatNaira(w.net_kobo)}</p>
            {w.account && <p className="text-xs text-green-600 dark:text-night-300">To {w.account.account_name} · {w.account.bank_name} {w.account.account_number}</p>}
            {w.status === 'pending' && (<>
              <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Waiting for a director to send the money. It stays set aside for you.</p>
              <button onClick={async () => { if (await ask('The money returns to your contribution.', { title: 'Cancel this request?', tone: 'danger', confirmLabel: 'Yes, cancel it', cancelLabel: 'Keep it' })) cancel.mutate(w.id) }} className="mt-2 text-xs font-bold text-red-600 underline">Cancel request</button></>)}
            {w.status === 'paid' && <p className="mt-2 text-xs font-semibold text-green-700 dark:text-green-300">Paid {w.decided_at ? dShort(w.decided_at) : ''}{w.reference ? ` · ref ${w.reference}` : ''}</p>}
            {w.status === 'rejected' && <p className="mt-2 rounded-xl bg-red-50 p-2 text-xs text-red-800 dark:bg-red-500/10 dark:text-red-300">Not paid: {w.reason}. The money is back in your contribution.</p>}
          </Card>) }} />
      )}
    </CoopPage>
  )
}
