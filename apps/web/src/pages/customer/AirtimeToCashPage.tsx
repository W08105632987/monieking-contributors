import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, CheckCircle2, Clock, Info } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { withPin, isPinCancelled } from '@/lib/pin'
import { cn, formatNaira } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { NetworkBadge } from '@/components/NetworkBadge'

type Net = 'MTN' | 'Airtel' | 'Glo' | '9mobile'
interface Config { enabled: boolean; min_naira: number; max_naira: number; daily_max_naira: number; networks: Net[] }
interface Req { id: string; status: string; payout_kobo: number; amount_kobo: number; network: string }
type Step = 'form' | 'otp' | 'pin' | 'done'

const input = 'w-full rounded-2xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-700 px-4 py-3.5 text-base font-bold text-green-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500'

/** Sell airtime from your own line and receive the cash in your wallet. Web only (the Play app never shows this). */
export default function AirtimeToCashPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [step, setStep] = useState<Step>('form')
  const [network, setNetwork] = useState<Net>('MTN')
  const [phone, setPhone] = useState(user?.phone_number ?? '')
  const [amount, setAmount] = useState('')
  const [otp, setOtp] = useState('')
  const [simpin, setSimpin] = useState('')
  const [req, setReq] = useState<Req | null>(null)
  const [payout, setPayout] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: cfg, isLoading, error } = useQuery({ queryKey: ['a2c-config'], retry: 0, queryFn: async () => (await api.get<Config>('/airtime-cash/config')).data })

  // Live quote: always computed by the server, never by the phone.
  const naira = Number(amount)
  useEffect(() => {
    setPayout(null)
    if (!cfg?.enabled || !Number.isInteger(naira) || naira < cfg.min_naira || naira > cfg.max_naira) return
    const t = setTimeout(async () => {
      try { setPayout((await api.post<{ payout_kobo: number }>('/airtime-cash/quote', { network, amount_naira: naira })).data.payout_kobo) } catch { setPayout(null) }
    }, 400)
    return () => clearTimeout(t)
  }, [network, naira, cfg])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { if (!isPinCancelled(e)) toast.error(getErrorMessage(e)) } finally { setBusy(false) }
  }

  const sendCode = () => run(async () => {
    const { data } = await api.post<Req>('/airtime-cash/start', { network, phone, amount_naira: naira })
    setReq(data); setStep('otp')
  })
  const verify = () => run(async () => {
    const { data } = await api.post<Req>(`/airtime-cash/${req!.id}/verify`, { otp })
    setReq(data); setStep('pin')
  })
  const submit = () => run(async () => {
    const { data } = await withPin((pin) => api.post<Req>(`/airtime-cash/${req!.id}/submit`, { simpin, pin }),
      { title: 'Confirm with your PIN', message: `Convert ${formatNaira(naira * 100)} of ${network} airtime to cash.` })
    setSimpin('')
    setReq(data); setStep('done')
    qc.invalidateQueries({ queryKey: ['wallet'] })
  })

  const header = (
    <header className="flex items-center gap-3 px-4 py-3">
      <button onClick={() => nav(-1)} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full border border-green-100 bg-white dark:border-night-500 dark:bg-night-700"><ArrowLeft className="h-4 w-4 text-green-700 dark:text-night-100" /></button>
      <h1 className="text-lg font-extrabold text-green-900 dark:text-white">Airtime to Cash</h1>
    </header>
  )

  if (isLoading) return <div className="min-h-dvh bg-green-50 dark:bg-night-800">{header}<div className="mx-4 h-40 animate-pulse rounded-3xl bg-white dark:bg-night-700" /></div>
  if (error || !cfg?.enabled) {
    return (
      <div className="min-h-dvh bg-green-50 dark:bg-night-800">{header}
        <p className="px-6 py-16 text-center text-sm text-green-700 dark:text-night-200">{error ? getErrorMessage(error) : 'Airtime to Cash is not available right now. Please check back later.'}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-green-50 dark:bg-night-800">
      {header}
      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav space-y-4">
        {step === 'form' && (
          <>
            <div className="flex gap-2 rounded-2xl border border-green-100 bg-white p-3.5 text-xs text-green-800 dark:border-night-500 dark:bg-night-700 dark:text-night-100">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              <p className="leading-relaxed">Sell airtime from <b>your own line</b> and get cash in your wallet. We send a code to that number first. Only use a line that belongs to you.</p>
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Network</p>
              <div className="grid grid-cols-4 gap-2">
                {cfg.networks.map((n) => (
                  <button key={n} onClick={() => setNetwork(n)} className={cn('flex flex-col items-center gap-1 rounded-2xl border-2 py-2.5', network === n ? 'border-green-600 bg-green-50 dark:bg-night-600' : 'border-green-100 bg-white dark:border-night-500 dark:bg-night-700')}>
                    <NetworkBadge network={n} size={30} /><span className="text-[11px] font-bold text-green-900 dark:text-white">{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Phone number (the line with the airtime)</span>
              <input className={input} inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 14))} placeholder="08012345678" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Airtime to sell (₦{cfg.min_naira.toLocaleString()} to ₦{cfg.max_naira.toLocaleString()})</span>
              <input className={input} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="1000" /></label>
            <div className="rounded-2xl bg-green-900 p-4 text-white dark:bg-night-600">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">You will receive</p>
              <p className="text-3xl font-extrabold">{payout != null ? formatNaira(payout) : '—'}</p>
              <p className="text-[11px] text-green-200">Added to your wallet once the airtime is collected.</p>
            </div>
            <button disabled={busy || payout == null || phone.length < 10} onClick={sendCode} className="w-full rounded-full bg-green-900 py-3.5 text-sm font-bold text-white disabled:opacity-40 dark:bg-night-100 dark:text-night-900">{busy ? 'Sending code…' : 'Send me a code'}</button>
          </>
        )}

        {step === 'otp' && (
          <>
            <p className="text-sm text-green-800 dark:text-night-100">We sent a code to <b>{phone}</b>. Enter it to prove the line is yours.</p>
            <input className={cn(input, 'text-center tracking-[0.4em]')} inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="••••••" />
            <button disabled={busy || otp.length < 4} onClick={verify} className="w-full rounded-full bg-green-900 py-3.5 text-sm font-bold text-white disabled:opacity-40 dark:bg-night-100 dark:text-night-900">{busy ? 'Checking…' : 'Verify'}</button>
            <button onClick={() => { setStep('form'); setOtp('') }} className="w-full text-xs font-bold text-green-700 dark:text-night-200">Change number or amount</button>
          </>
        )}

        {step === 'pin' && (
          <>
            <div className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="leading-relaxed">Enter the <b>SIM transfer PIN</b> of {phone} (the 4-digit PIN your network uses for airtime transfers; it is usually 0000 unless you changed it). It is used once to move the airtime and is <b>never saved</b>. Never share it with anyone else.</p>
            </div>
            <input className={cn(input, 'text-center tracking-[0.6em]')} type="password" inputMode="numeric" autoComplete="off" value={simpin} onChange={(e) => setSimpin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" />
            <div className="rounded-2xl bg-white p-4 text-sm dark:bg-night-700"><p className="text-green-700 dark:text-night-200">{formatNaira(naira * 100)} {network} airtime</p><p className="text-lg font-extrabold text-green-950 dark:text-white">You get {payout != null ? formatNaira(payout) : formatNaira(req?.payout_kobo ?? 0)}</p></div>
            <button disabled={busy || simpin.length !== 4} onClick={submit} className="w-full rounded-full bg-green-900 py-3.5 text-sm font-bold text-white disabled:opacity-40 dark:bg-night-100 dark:text-night-900">{busy ? 'Converting…' : 'Convert airtime to cash'}</button>
          </>
        )}

        {step === 'done' && req && (
          <div className="py-10 text-center">
            {req.status === 'completed' ? <CheckCircle2 className="mx-auto h-14 w-14 text-green-600" /> : <Clock className="mx-auto h-14 w-14 text-amber-500" />}
            <p className="mt-3 text-xl font-extrabold text-green-950 dark:text-white">{req.status === 'completed' ? `${formatNaira(req.payout_kobo)} added to your wallet` : 'We are confirming this'}</p>
            <p className="mx-auto mt-2 max-w-xs text-sm text-green-700 dark:text-night-200">{req.status === 'completed' ? 'Your airtime was collected and the cash is in your wallet now.' : 'Our partner has not confirmed yet. You will be credited as soon as it is confirmed. You do not need to do anything.'}</p>
            <button onClick={() => nav('/customer/wallet')} className="mt-6 rounded-full bg-green-900 px-8 py-3 text-sm font-bold text-white dark:bg-night-100 dark:text-night-900">Go to wallet</button>
          </div>
        )}
      </div>
    </div>
  )
}
