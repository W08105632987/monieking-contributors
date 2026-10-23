import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Smartphone, CheckCircle2, AlertCircle, Loader2, Info } from 'lucide-react'
import { formatNaira, cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { useBillers, usePayBill, useBillsConfig, usePhoneCheck, DEFAULT_BILLS_CONFIG } from '@/hooks/useBillPayments'
import { NETWORK_THEME, NEUTRAL_THEME } from '@/lib/networkTheme'
import { FallbackError } from '@/components/ui/FallbackError'
import { PaymentReceipt, type ReceiptField } from '@/components/receipts/PaymentReceipt'
import { isPinCancelled } from '@/lib/pin'
import { PaymentConfirmSheet } from '@/components/payments/PaymentConfirmSheet'
import { NetworkBadge, ALL_NETWORKS, type NetworkName } from '@/components/NetworkBadge'
import type { BillPaymentRequest } from '@/types'

// Prefix -> network map, used two ways: (1) auto-detect while typing, and
// (2) silently checking a MANUALLY chosen network against the typed
// number, so a mismatch surfaces as a clear error at Pay time instead of
// a confusing provider rejection. Not exhaustive of every recent MVNO
// prefix -- and can't be, since Nigeria has mobile number portability
// (MNP), meaning a number's original prefix stops guaranteeing its
// current network the moment someone ports it. That's the likely reason
// a real MTN number didn't auto-detect earlier -- this list can only ever
// be a best-effort hint, not a certainty. A prefix absent from every list
// below is treated as "unknown" rather than "wrong" -- we don't block on
// it, since it may just be a newer or ported number this table doesn't
// know about; the actual provider vend response remains the final,
// authoritative check either way.
const NETWORK_PREFIXES: Record<NetworkName, string[]> = {
  MTN:      ['0803', '0806', '0813', '0816', '0810', '0814', '0903', '0906', '0913', '0916', '0704', '0703', '0706'],
  Airtel:   ['0802', '0808', '0812', '0708', '0701', '0902', '0907', '0901', '0912', '0904'],
  Glo:      ['0805', '0807', '0815', '0811', '0905', '0915', '0705'],
  '9mobile': ['0809', '0817', '0818', '0908', '0909'],
}

function detectNetwork(phone: string): NetworkName | null {
  const prefix = phone.slice(0, 4)
  for (const [network, prefixes] of Object.entries(NETWORK_PREFIXES) as [NetworkName, string[]][]) {
    if (prefixes.includes(prefix)) return network
  }
  return null
}

/** null = can't tell either way (unrecognized/ported prefix) -- never block on this, only on a confirmed mismatch. */
function checkMismatch(phone: string, chosen: NetworkName): boolean | null {
  if (phone.length < 4) return null
  const detected = detectNetwork(phone)
  if (!detected) return null
  return detected !== chosen
}

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000]

export default function AirtimeDataPage() {
  const navigate = useNavigate()
  const { customerId } = useParams<{ customerId?: string }>()
  const { wallet } = useWallet()

  const [tab, setTab] = useState<'airtime' | 'data'>('airtime')
  const [phone, setPhone] = useState('')
  const [network, setNetwork] = useState<NetworkName | null>(null)
  const [manuallyChosen, setManuallyChosen] = useState(false)
  const [amountNaira, setAmountNaira] = useState<number | ''>('')
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [completedRequest, setCompletedRequest] = useState<BillPaymentRequest | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [dataKind, setDataKind] = useState<'vtu' | 'standard'>('standard')

  const { data: cfgData } = useBillsConfig()
  const cfg = cfgData ?? DEFAULT_BILLS_CONFIG
  const check = usePhoneCheck()
  const [phoneState, setPhoneState] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle')
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)
  const checkSeq = useRef(0)

  const theme = network ? NETWORK_THEME[network] : NEUTRAL_THEME
  const networkOn = (n: NetworkName) => cfg.networks[n] !== false

  // Auto-detect while typing, but only overwrite the network if the
  // customer hasn't manually picked one themselves -- manual choice
  // always wins over a guess.
  useEffect(() => {
    if (manuallyChosen) return
    setNetwork(detectNetwork(phone))
  }, [phone, manuallyChosen])

  // Real check as soon as 11 digits are in: format, network, and Monnify's own
  // MSISDN validation (server-side). A failed *request* (offline etc.) never
  // blocks — only a definite "this number/network is wrong" answer does.
  useEffect(() => {
    if (phone.length < 11) { setPhoneState('idle'); setPhoneMsg(null); setVerified(false); return }
    const seq = ++checkSeq.current
    setPhoneState('checking')
    check.mutate({ phone, network: manuallyChosen ? network : null }, {
      onSuccess: (r) => {
        if (seq !== checkSeq.current) return
        setVerified(r.verified)
        if (r.valid) {
          setPhoneState('ok'); setPhoneMsg(null)
          if (!manuallyChosen && r.network && networkOn(r.network as NetworkName)) setNetwork(r.network as NetworkName)
        } else { setPhoneState('bad'); setPhoneMsg(r.message) }
      },
      onError: () => {
        if (seq !== checkSeq.current) return
        const m = network ? checkMismatch(phone, network) : null
        setVerified(false)
        if (m) { setPhoneState('bad'); setPhoneMsg('Wrong network & phone number combination') } else { setPhoneState('ok'); setPhoneMsg(null) }
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, network, manuallyChosen])

  // Silent check -- no UI reaction here, this just powers the Pay-time
  // error. Recomputed on every phone/network change.
  const mismatch = useMemo(() => (network ? checkMismatch(phone, network) : null), [phone, network])

  const { data: dataPlans = [], isLoading: plansLoading, isError: plansError, refetch: refetchPlans, isFetching: plansFetching } =
    useBillers(tab === 'data' ? 'data' : 'airtime')

  const isVtu = (p: { name: string; product_name: string }) => `${p.name} ${p.product_name}`.toUpperCase().includes('VTU')
  const plansAll = network ? dataPlans.filter(p => p.name.toUpperCase().includes(network === '9mobile' ? '9MOBILE' : network.toUpperCase())) : dataPlans
  const hasVtu = tab === 'data' && plansAll.some(isVtu) && cfg.data_vtu_enabled
  const hasStd = tab === 'data' && plansAll.some(p => !isVtu(p)) && cfg.data_standard_enabled
  const effKind = dataKind === 'vtu' ? (hasVtu ? 'vtu' : 'standard') : (hasStd ? 'standard' : 'vtu')
  const plansForNetwork = tab === 'data'
    ? plansAll.filter(p => (effKind === 'vtu' ? isVtu(p) : !isVtu(p)) && (effKind === 'vtu' ? cfg.data_vtu_enabled : cfg.data_standard_enabled))
    : plansAll
  const selectedPlan = plansForNetwork.find(p => p.id === selectedPlanId)
  const airtimeBiller = dataPlans.find(p => network && p.name.toUpperCase().includes(network === '9mobile' ? '9MOBILE' : network.toUpperCase()))

  const payMutation = usePayBill(customerId)

  const serviceOn = tab === 'airtime' ? cfg.airtime_enabled : cfg.data_enabled
  const amountOk = typeof amountNaira === 'number' && amountNaira >= cfg.min_airtime_naira && amountNaira <= cfg.max_airtime_naira
  const baseOk = serviceOn && phone.length === 11 && phoneState === 'ok' && !!network && networkOn(network)
  const canPay = tab === 'airtime' ? baseOk && amountOk && !!airtimeBiller : baseOk && !!selectedPlan

  function handlePay() {
    if (!canPay) return

    // The one visible consequence of the silent validation -- caught
    // here, before any network call, so the error is instant and
    // specific rather than whatever generic rejection the provider
    // would return.
    if (mismatch) {
      toast.error('Wrong network & phone number combination')
      return
    }

    const biller = tab === 'airtime' ? airtimeBiller : selectedPlan
    if (!biller) {
      toast.error(network ? 'No plan available for this network yet' : 'Choose a network first')
      return
    }
    // Tapping Pay opens the confirmation sheet — the actual charge only
    // fires from handleConfirmPay, once the person has seen exactly
    // what's about to leave their wallet and confirmed it.
    setShowConfirm(true)
  }

  function handleConfirmPay() {
    const biller = tab === 'airtime' ? airtimeBiller : selectedPlan
    if (!biller) return
    payMutation.mutate(
      {
        biller_id: biller.id,
        customer_reference: phone,
        amount_kobo: tab === 'airtime' ? (amountNaira as number) * 100 : undefined,
      },
      {
        onSuccess: (req) => { setShowConfirm(false); setCompletedRequest(req) },
        onError: (e) => { if (!isPinCancelled(e)) toast.error(getErrorMessage(e)) },
      },
    )
  }

  const payAmountKobo = tab === 'airtime'
    ? (typeof amountNaira === 'number' ? amountNaira * 100 : 0)
    : (selectedPlan?.price_kobo ?? 0)

  const receiptFields: ReceiptField[] = completedRequest ? [
    { label: 'Network', value: network ?? '—' },
    { label: 'Phone number', value: phone },
    ...(tab === 'data' && selectedPlan ? [{ label: 'Plan', value: selectedPlan.product_name }] : []),
  ] : []

  const payLabel = payMutation.isPending ? 'Processing…' : `Pay${payAmountKobo > 0 ? ` ${formatNaira(payAmountKobo)}` : ''}`

  return (
    <div className="relative min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      {/* Network-themed wash: fades the whole page into the chosen network's colour */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] opacity-100 dark:opacity-80"
        animate={{ opacity: 1 }}
        key={network ?? 'none'}
        initial={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        style={{ background: theme.wash }}
      />

      <header className="relative flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 bg-white/70 dark:bg-night-600 backdrop-blur rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg flex-1">Airtime & Data</h1>
        <AnimatePresence mode="wait">
          {network && (
            <motion.div key={network} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}
              className="rounded-full p-0.5" style={{ background: theme.main, boxShadow: `0 0 18px ${theme.main}88` }}>
              <NetworkBadge network={network} size={34} />
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <div className="relative flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(var(--bottom-nav-height, 4.5rem) + 6rem)' }}>
        {customerId && (
          <div className="bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 mt-2 mb-4">
            <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">
              Buying on this customer's behalf — charged to their wallet, not yours.
            </p>
          </div>
        )}

        {cfg.notice && (
          <div className="mt-2 mb-3 flex gap-2 rounded-2xl bg-white/80 dark:bg-night-700/80 border border-amber-300/60 px-4 py-3 text-xs font-semibold text-amber-800 dark:text-amber-200">
            <Info className="w-4 h-4 shrink-0" />{cfg.notice}
          </div>
        )}

        {/* Airtime / Data toggle */}
        <div className="relative flex bg-white/80 dark:bg-night-700 backdrop-blur rounded-2xl p-1 mt-2 mb-5 border border-green-100 dark:border-night-500">
          {(['airtime', 'data'] as const).map(t => {
            const on = t === 'airtime' ? cfg.airtime_enabled : cfg.data_enabled
            return (
              <button
                key={t}
                disabled={!on}
                onClick={() => { setTab(t); setSelectedPlanId(null) }}
                className={cn('relative flex-1 py-2.5 rounded-xl text-sm font-bold capitalize', tab === t ? '' : 'text-green-700 dark:text-night-300')}
                style={tab === t ? { color: theme.on } : undefined}
              >
                {tab === t && <motion.span layoutId="ad-tab" className="absolute inset-0 rounded-xl" style={{ background: theme.main }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
                <span className="relative">{t}{!on && ' (off)'}</span>
              </button>
            )
          })}
        </div>

        {!serviceOn && (
          <p className="mb-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-200">
            {tab === 'airtime' ? 'Airtime' : 'Data'} purchases are paused right now. Please check back soon.
          </p>
        )}

        {/* Network — always manually selectable, auto-detect just pre-picks one */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Network</label>
            {network && !manuallyChosen && <span className="text-[11px] text-green-600 dark:text-night-300">Detected from number</span>}
          </div>
          <div className="flex gap-3">
            {ALL_NETWORKS.map(n => {
              const on = networkOn(n)
              const t = NETWORK_THEME[n]
              return (
                <motion.button
                  key={n}
                  type="button"
                  disabled={!on}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => { setNetwork(n); setManuallyChosen(true); setSelectedPlanId(null) }}
                  className="flex flex-col items-center gap-1.5 flex-1"
                >
                  <div className="rounded-full p-0.5 transition-all" style={network === n ? { background: t.main, boxShadow: `0 0 16px ${t.main}99` } : { background: 'transparent' }}>
                    <NetworkBadge network={n} size={46} />
                  </div>
                  <span className={cn('text-[11px] font-semibold', network === n ? 'text-green-900 dark:text-white' : 'text-green-600 dark:text-night-400')}>
                    {on ? n : `${n} · off`}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* Phone number — validated for real */}
        <div className="mb-5">
          <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">Phone number</label>
          <div
            className={cn('flex items-center gap-3 bg-white dark:bg-night-700 border rounded-2xl px-4 py-3.5 transition-colors',
              phoneState === 'bad' ? 'border-red-400' : phoneState === 'ok' ? 'border-green-500' : 'border-green-100 dark:border-night-500')}
          >
            <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-night-600 flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4 text-green-700 dark:text-night-100" />
            </div>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="080XXXXXXXX"
              className="flex-1 bg-transparent outline-none text-green-950 dark:text-white font-semibold tracking-wide"
            />
            <AnimatePresence mode="wait">
              {phoneState === 'checking' && <motion.span key="c" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Loader2 className="w-4 h-4 text-green-600 animate-spin" /></motion.span>}
              {phoneState === 'ok' && <motion.span key="o" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}><CheckCircle2 className="w-5 h-5 text-green-600" /></motion.span>}
              {phoneState === 'bad' && <motion.span key="b" initial={{ scale: 0 }} animate={{ scale: 1 }}><AlertCircle className="w-5 h-5 text-red-500" /></motion.span>}
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {phoneState === 'bad' && phoneMsg && (
              <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-1.5 text-xs font-semibold text-red-600 dark:text-red-300">{phoneMsg}</motion.p>
            )}
            {phoneState === 'ok' && verified && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-1.5 text-xs font-semibold text-green-700 dark:text-green-300">Number verified{network ? ` on ${network}` : ''}</motion.p>
            )}
          </AnimatePresence>
        </div>

        {tab === 'airtime' ? (
          <div>
            <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">Amount</label>
            <div className="grid grid-cols-3 gap-2.5 mb-3">
              {QUICK_AMOUNTS.filter(a => a >= cfg.min_airtime_naira && a <= cfg.max_airtime_naira).map(a => (
                <motion.button
                  key={a}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setAmountNaira(a)}
                  className={cn('py-3 rounded-xl text-sm font-bold border transition-colors',
                    amountNaira === a ? 'border-transparent' : 'bg-white dark:bg-night-700 text-green-800 dark:text-night-100 border-green-100 dark:border-night-500')}
                  style={amountNaira === a ? { background: theme.main, color: theme.on } : undefined}
                >
                  ₦{a.toLocaleString()}
                </motion.button>
              ))}
            </div>
            <input
              type="number"
              inputMode="numeric"
              value={amountNaira}
              onChange={(e) => setAmountNaira(e.target.value ? Number(e.target.value) : '')}
              placeholder="Or enter a custom amount"
              className="w-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3.5 outline-none text-green-950 dark:text-white font-semibold"
            />
            <p className={cn('mt-1.5 text-[11px] font-semibold', typeof amountNaira === 'number' && !amountOk ? 'text-red-600 dark:text-red-300' : 'text-green-600 dark:text-night-300')}>
              Between ₦{cfg.min_airtime_naira.toLocaleString()} and ₦{cfg.max_airtime_naira.toLocaleString()}
            </p>
          </div>
        ) : (
          <div>
            {(hasVtu && hasStd) && (
              <div className="relative flex bg-white/80 dark:bg-night-700 rounded-xl p-1 mb-3 border border-green-100 dark:border-night-500">
                {([['standard', 'Standard data'], ['vtu', 'VTU data']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => { setDataKind(k); setSelectedPlanId(null) }}
                    className={cn('relative flex-1 py-2 rounded-lg text-xs font-bold', effKind === k ? '' : 'text-green-700 dark:text-night-300')}
                    style={effKind === k ? { color: theme.on } : undefined}>
                    {effKind === k && <motion.span layoutId="ad-kind" className="absolute inset-0 rounded-lg" style={{ background: theme.main }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>
            )}
            <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">Choose a plan</label>
            {plansError ? (
              <FallbackError title="Couldn't load data plans" onRetry={() => refetchPlans()} isRetrying={plansFetching} />
            ) : plansLoading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}</div>
            ) : plansForNetwork.length === 0 ? (
              <p className="text-green-600 dark:text-night-300 text-sm">{network ? `No ${network} plans available right now.` : 'Choose a network to see plans.'}</p>
            ) : (
              <div className="space-y-2">
                {plansForNetwork.map((plan, i) => (
                  <motion.button
                    key={plan.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 8) * 0.03 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={cn('w-full flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors',
                      selectedPlanId === plan.id ? 'border-transparent' : 'bg-white dark:bg-night-700 border-green-100 dark:border-night-500')}
                    style={selectedPlanId === plan.id ? { background: theme.main, color: theme.on } : undefined}
                  >
                    <span className={cn('text-sm font-bold', selectedPlanId === plan.id ? '' : 'text-green-900 dark:text-white')}>{plan.product_name}</span>
                    {plan.price_kobo != null && (
                      <span className={cn('text-sm font-extrabold', selectedPlanId === plan.id ? '' : 'text-green-700 dark:text-night-200')}>{formatNaira(plan.price_kobo)}</span>
                    )}
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="fixed left-0 right-0 z-30 bg-white/95 dark:bg-night-900/95 backdrop-blur border-t border-green-50 dark:border-night-700 px-4 py-3" style={{ bottom: 'var(--bottom-nav-height, 4.5rem)' }}>
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handlePay}
          disabled={!canPay || payMutation.isPending}
          className="w-full font-bold py-3.5 rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          style={{ background: theme.main, color: theme.on }}
        >
          {payMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {payLabel}
        </motion.button>
      </div>

      <PaymentConfirmSheet
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmPay}
        isSubmitting={payMutation.isPending}
        title={tab === 'airtime' ? 'Confirm airtime purchase' : 'Confirm data purchase'}
        icon={network && <NetworkBadge network={network} size={28} />}
        amountKobo={payAmountKobo}
        walletBalanceKobo={wallet?.balance_kobo ?? 0}
        detailRows={[
          ...(network ? [{ label: 'Network', value: network }] : []),
          { label: 'Phone number', value: phone },
          ...(tab === 'data' && selectedPlan ? [{ label: 'Plan', value: selectedPlan.product_name }] : []),
        ]}
      />

      {completedRequest && (
        <PaymentReceipt
          open={!!completedRequest}
          onClose={() => { setCompletedRequest(null); navigate(-1) }}
          status={completedRequest.status === 'completed' ? 'completed' : completedRequest.status === 'failed' ? 'failed' : 'pending'}
          amountKobo={completedRequest.amount_charged_kobo ?? completedRequest.amount_kobo}
          serviceName={`${network ?? ''} ${tab === 'airtime' ? 'Airtime' : 'Data'}`.trim()}
          reference={completedRequest.monnify_transaction_reference ?? completedRequest.id}
          timestamp={new Date(completedRequest.created_at).toLocaleString()}
          fields={receiptFields}
          failureReason={completedRequest.failure_reason ?? undefined}
        />
      )}
    </div>
  )
}
