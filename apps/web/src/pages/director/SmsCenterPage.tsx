import { useEffect, useState } from 'react'
import { ask } from '@/lib/dialog'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, MessageSquare, Send, Users } from 'lucide-react'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, cn } from '@/lib/utils'

interface Cfg { fee_per_sms_kobo: number; provider_cost_per_segment_kobo: number; audiences: { key: string; label: string }[] }
interface Preview {
  recipients: number; sample: string[]; chars: number; encoding: string; segments: number; per_segment: number
  text_sent: string; provider_cost_kobo: number; segments_total: number; extra_segments_avoided: number; too_many: boolean
}

export default function SmsCenterPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['sms-config'], queryFn: async () => (await api.get<Cfg>('/sms/config')).data })
  const [fee, setFee] = useState('')
  const [cost, setCost] = useState('')
  useEffect(() => { if (cfg) { setFee(String(cfg.fee_per_sms_kobo / 100)); setCost(String(cfg.provider_cost_per_segment_kobo / 100)) } }, [cfg])

  const saveFee = useMutation({
    mutationFn: () => api.put('/sms/fee', { fee_per_sms_kobo: Math.round(Number(fee || 0) * 100), provider_cost_per_segment_kobo: Math.round(Number(cost || 0) * 100) }),
    onSuccess: () => { toast.success('SMS fee saved'); qc.invalidateQueries({ queryKey: ['sms-config'] }); qc.invalidateQueries({ queryKey: ['sms-fee'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const [audience, setAudience] = useState('all_customers')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  const [q, setQ] = useState('')

  // personal: find people by name / phone
  const { data: found = [] } = useQuery({
    queryKey: ['sms-find', q], enabled: audience === 'personal' && q.trim().length >= 2,
    queryFn: async () => {
      const { data } = await api.get<any>('/users', { params: { search: q.trim(), page_size: 8 } })
      const list = Array.isArray(data) ? data : (data.data ?? data.items ?? [])
      return list as { id: string; full_name: string; phone_number?: string }[]
    },
  })

  const body = () => ({ audience, message, user_ids: audience === 'personal' ? people.map(p => p.id) : [] })
  useEffect(() => {
    if (!message.trim() || (audience === 'personal' && people.length === 0)) { setPreview(null); return }
    const t = setTimeout(() => {
      api.post<Preview>('/sms/preview', body()).then(r => setPreview(r.data)).catch(() => setPreview(null))
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, audience, people])

  const send = useMutation({
    mutationFn: () => api.post<{ sent: number; failed: number }>('/sms/send', body()),
    onSuccess: (r) => { toast.success(`Sent to ${r.data.sent}${r.data.failed ? ` · ${r.data.failed} failed` : ''}`); setMessage('') },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const segs = preview?.segments ?? 0
  return (
    <div className="flex min-h-dvh flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => nav(-1)} className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center"><ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" /></button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">SMS centre</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav space-y-4">

        <section className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 p-4 space-y-3">
          <p className="font-bold text-green-900 dark:text-white text-sm flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Per-SMS fee</p>
          <p className="text-xs text-green-600 dark:text-night-200 leading-relaxed">
            Customers who turn on SMS alerts pay this for every SMS segment we send them when their card is marked. There is no monthly charge any more.
            Customers managed by an officer have no wallet, so their fees add up on their card and come off at withdrawal.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-green-600 dark:text-night-200">Fee per SMS (₦)
              <input inputMode="decimal" value={fee} onChange={e => setFee(e.target.value.replace(/[^0-9.]/g, ''))} className="mt-1 w-full rounded-lg border-2 border-green-100 dark:border-night-500 bg-transparent px-3 py-2 text-sm text-green-900 dark:text-white" /></label>
            <label className="text-xs font-semibold text-green-600 dark:text-night-200">Our cost per SMS (₦)
              <input inputMode="decimal" value={cost} onChange={e => setCost(e.target.value.replace(/[^0-9.]/g, ''))} className="mt-1 w-full rounded-lg border-2 border-green-100 dark:border-night-500 bg-transparent px-3 py-2 text-sm text-green-900 dark:text-white" /></label>
          </div>
          {cfg && Number(fee) * 100 < Number(cost) * 100 && <p className="text-xs text-red-500 font-semibold">The fee is lower than what the SMS costs us.</p>}
          <button onClick={() => saveFee.mutate()} disabled={saveFee.isPending} className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm py-2.5 rounded-xl disabled:opacity-60">Save fee</button>
        </section>

        <section className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 p-4 space-y-3">
          <p className="font-bold text-green-900 dark:text-white text-sm flex items-center gap-2"><Users className="w-4 h-4" /> Send an SMS</p>
          <p className="text-xs text-green-600 dark:text-night-200">Free for the people who receive it. Customers only get SMS about their card automatically.</p>
          <select value={audience} onChange={e => setAudience(e.target.value)} className="w-full rounded-lg border-2 border-green-100 dark:border-night-500 bg-transparent px-3 py-2.5 text-sm text-green-900 dark:text-white">
            {(cfg?.audiences ?? []).map(a => <option key={a.key} value={a.key} className="text-black">{a.label}</option>)}
          </select>

          {audience === 'personal' && (
            <div className="space-y-2">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a name or phone…" className="w-full rounded-lg border-2 border-green-100 dark:border-night-500 bg-transparent px-3 py-2 text-sm text-green-900 dark:text-white" />
              {found.filter(f => !people.some(p => p.id === f.id)).map(f => (
                <button key={f.id} onClick={() => { setPeople(p => [...p, { id: f.id, full_name: f.full_name }]); setQ('') }} className="block w-full text-left text-sm px-3 py-2 rounded-lg bg-green-50 dark:bg-night-600 text-green-900 dark:text-white">{f.full_name} <span className="text-xs text-green-500">{f.phone_number}</span></button>
              ))}
              <div className="flex flex-wrap gap-1.5">
                {people.map(p => <button key={p.id} onClick={() => setPeople(x => x.filter(y => y.id !== p.id))} className="text-xs font-semibold bg-green-100 dark:bg-night-600 text-green-800 dark:text-night-100 px-2.5 py-1 rounded-full">{p.full_name} ✕</button>)}
              </div>
            </div>
          )}

          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5} placeholder="Type your message…" className="w-full rounded-lg border-2 border-green-100 dark:border-night-500 bg-transparent px-3 py-2 text-sm text-green-900 dark:text-white" />

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-green-50 dark:bg-night-600 p-2"><p className="text-lg font-extrabold text-green-900 dark:text-white">{message.length}</p><p className="text-[10px] text-green-500 dark:text-night-200">characters</p></div>
            <div className={cn('rounded-xl p-2', segs > 1 ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-green-50 dark:bg-night-600')}><p className="text-lg font-extrabold text-green-900 dark:text-white">{segs}</p><p className="text-[10px] text-green-500 dark:text-night-200">SMS each ({preview?.per_segment ?? 160}/SMS)</p></div>
            <div className="rounded-xl bg-green-50 dark:bg-night-600 p-2"><p className="text-lg font-extrabold text-green-900 dark:text-white">{preview?.recipients ?? 0}</p><p className="text-[10px] text-green-500 dark:text-night-200">people</p></div>
          </div>

          {preview && (
            <div className="text-xs text-green-700 dark:text-night-100 space-y-1 bg-green-50 dark:bg-night-600 rounded-xl p-3">
              <p>Total to the provider: <b>{preview.segments_total} SMS</b> ≈ <b>{formatNaira(preview.provider_cost_kobo)}</b></p>
              <p>Encoding: {preview.encoding}{preview.encoding === 'Unicode' ? ' — an emoji or special letter makes each SMS shorter (70 characters) and costs more. Remove it to save money.' : ''}</p>
              {preview.extra_segments_avoided > 0 && <p className="text-green-600 dark:text-green-300 font-semibold">Symbols like ₦ and — are swapped automatically, saving {preview.extra_segments_avoided} SMS.</p>}
              {preview.sample.length > 0 && <p>To: {preview.sample.join(', ')}{preview.recipients > preview.sample.length ? ` and ${preview.recipients - preview.sample.length} more` : ''}</p>}
              {preview.too_many && <p className="text-red-500 font-semibold">Too many people for one send — pick a smaller group.</p>}
            </div>
          )}

          <button
            disabled={send.isPending || !preview || preview.recipients === 0 || preview.too_many}
            onClick={async () => { if (await ask(`It goes to ${preview?.recipients} people and costs about ${formatNaira(preview?.provider_cost_kobo ?? 0)}.`, { title: 'Send this SMS?', confirmLabel: 'Send now' })) send.mutate() }}
            className="w-full flex items-center justify-center gap-2 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm py-3 rounded-xl disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> {send.isPending ? 'Sending…' : 'Send SMS'}
          </button>
        </section>
      </div>
    </div>
  )
}
