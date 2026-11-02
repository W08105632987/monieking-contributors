import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, PhoneCall } from 'lucide-react'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'

interface Cfg { title: string; message: string; button: string; link: string; support_phone: string; support_whatsapp: string; joined_count: number; customer_count: number }
const inputCls = 'w-full rounded-xl border border-green-200 bg-white px-3 py-2.5 text-sm text-green-900 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-night-500 dark:bg-night-700 dark:text-white'

/** Business Settings: what customers see in the one-time WhatsApp pop-up, and the support number used by every "Contact support" button. */
export function CommunitySettings() {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['community-admin'], queryFn: async () => (await api.get<Cfg>('/community/admin')).data })
  const [f, setF] = useState<Cfg | null>(null)
  useEffect(() => { if (data) setF(data) }, [data])
  const save = useMutation({
    mutationFn: () => api.put('/community/admin', { title: f!.title, message: f!.message, button: f!.button, link: f!.link, support_phone: f!.support_phone, support_whatsapp: f!.support_whatsapp }),
    onSuccess: () => { toast.success('Saved. Customers see the new wording immediately.'); qc.invalidateQueries({ queryKey: ['community-admin'] }); qc.invalidateQueries({ queryKey: ['support-contact'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  if (isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-white dark:bg-night-700" />
  if (isError || !f) return <p className="py-6 text-center text-sm text-red-600">Could not load. <button className="font-bold underline" onClick={() => refetch()}>Try again</button></p>
  const set = (k: keyof Cfg) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const dirty = JSON.stringify(f) !== JSON.stringify(data)
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-green-100 bg-white p-4 dark:border-night-500 dark:bg-night-700">
        <div className="mb-3 flex items-center gap-2"><MessageCircle className="h-5 w-5 text-[#25D366]" /><p className="text-sm font-extrabold text-green-900 dark:text-white">WhatsApp community pop-up</p></div>
        <p className="mb-3 text-xs leading-relaxed text-green-600 dark:text-night-200">Every customer sees this once, right after signing in, with confetti. They cannot reach their dashboard until the app has recorded their tap on the button. If the link below is empty, the pop-up is switched off.</p>
        <label className="text-[11px] font-bold uppercase text-green-500 dark:text-night-300">Group link</label>
        <input value={f.link} onChange={set('link')} placeholder="https://chat.whatsapp.com/…" inputMode="url" className={inputCls + ' mb-3'} />
        <label className="text-[11px] font-bold uppercase text-green-500 dark:text-night-300">Heading</label>
        <input value={f.title} onChange={set('title')} maxLength={120} className={inputCls + ' mb-3'} />
        <label className="text-[11px] font-bold uppercase text-green-500 dark:text-night-300">Message</label>
        <textarea value={f.message} onChange={set('message')} rows={5} maxLength={1000} className={inputCls + ' mb-3'} />
        <label className="text-[11px] font-bold uppercase text-green-500 dark:text-night-300">Button text</label>
        <input value={f.button} onChange={set('button')} maxLength={40} className={inputCls} />
        <p className="mt-3 text-xs font-semibold text-green-700 dark:text-night-100">{f.joined_count} of {f.customer_count} customers have joined so far.</p>
      </div>

      <div className="rounded-2xl border border-green-100 bg-white p-4 dark:border-night-500 dark:bg-night-700">
        <div className="mb-3 flex items-center gap-2"><PhoneCall className="h-5 w-5 text-green-700 dark:text-night-100" /><p className="text-sm font-extrabold text-green-900 dark:text-white">Contact support</p></div>
        <p className="mb-3 text-xs leading-relaxed text-green-600 dark:text-night-200">One place for the support number. Every “Contact support” button in the app uses it: expired dispute windows, “Forgot your withdrawal password?”, the profile pages and more.</p>
        <label className="text-[11px] font-bold uppercase text-green-500 dark:text-night-300">Support phone number (calls)</label>
        <input value={f.support_phone} onChange={set('support_phone')} placeholder="e.g. 0803 899 5252" inputMode="tel" className={inputCls + ' mb-3'} />
        <label className="text-[11px] font-bold uppercase text-green-500 dark:text-night-300">Support WhatsApp number (with country code)</label>
        <input value={f.support_whatsapp} onChange={set('support_whatsapp')} placeholder="e.g. 2348038995252" inputMode="numeric" className={inputCls} />
      </div>

      <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="w-full rounded-full bg-green-900 py-3 text-sm font-bold text-white disabled:opacity-40 dark:bg-night-100 dark:text-night-900">{save.isPending ? 'Saving…' : 'Save — applies immediately'}</button>
    </div>
  )
}
