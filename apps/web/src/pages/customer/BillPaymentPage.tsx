import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from '@/lib/notify'
import { ArrowLeft, Zap, Tv, CheckCircle2, Loader2, ShieldCheck, Building2 } from 'lucide-react'
import { formatNaira, cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { AnimatePresence, motion } from 'framer-motion'
import { isPinCancelled } from '@/lib/pin'
import { useBillsConfig, DEFAULT_BILLS_CONFIG, useBillers, useValidateBill, usePayBill, useBillRequest } from '@/hooks/useBillPayments'
import { FallbackError } from '@/components/ui/FallbackError'
import { PaymentReceipt, type ReceiptField } from '@/components/receipts/PaymentReceipt'
import { PaymentConfirmSheet } from '@/components/payments/PaymentConfirmSheet'
import { ProviderSheet } from '@/components/billers/ProviderSheet'
import { BillerLogo } from '@/components/billers/BillerLogo'
import { PlanSheet } from '@/components/billers/PlanSheet'
import { groupByProvider, meterKind, METER_LABEL, type BillerGroup, type MeterKind } from '@/lib/billCatalog'
import { resolveBrand, brandGradient, brandWash, rgba, type BillerBrand } from '@/lib/billerBrand'
import type { Biller, BillPaymentRequest } from '@/types'

type SubCategory = 'electricity' | 'cable_tv'

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000]
const NEUTRAL: BillerBrand = { key: 'neutral', label: 'Bills', logo: null, main: '#14532d', deep: '#052e16', on: '#ffffff', initials: 'B' }
const KIND_COPY: Record<'prepaid' | 'postpaid', { title: string; hint: string }> = {
  prepaid: { title: 'Prepaid', hint: 'Buy units, get a token' },
  postpaid: { title: 'Postpaid', hint: 'Pay your monthly bill' },
}

export default function BillPaymentPage() {
  const navigate = useNavigate()
  const { customerId } = useParams<{ customerId?: string }>()
  const { wallet } = useWallet()

  const [subCategory, setSubCategory] = useState<SubCategory>('electricity')
  const [meterMode, setMeterMode] = useState<MeterKind>('prepaid')
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [productId, setProductId] = useState<string | null>(null)
  const [customerReference, setCustomerReference] = useState('')
  const [amountNaira, setAmountNaira] = useState<number | ''>('')
  const [completedRequest, setCompletedRequest] = useState<BillPaymentRequest | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const { data: cfgData } = useBillsConfig()
  const cfg = cfgData ?? DEFAULT_BILLS_CONFIG
  const { data: billers = [], isLoading, isError, refetch, isFetching } = useBillers(subCategory)

  const isCable = subCategory === 'cable_tv'
  const allGroups = useMemo(() => groupByProvider(billers), [billers])

  // Prepaid / Postpaid come FIRST for electricity — only the kinds the catalogue really has.
  const kindOptions = useMemo(
    () => (isCable ? [] : (['prepaid', 'postpaid'] as const).filter(k => billers.some(p => meterKind(p) === k))),
    [billers, isCable],
  )
  const activeKind: MeterKind | undefined = kindOptions.includes(meterMode as 'prepaid' | 'postpaid') ? meterMode : kindOptions[0]
  const groups = useMemo(
    () => (kindOptions.length ? allGroups.filter(g => g.products.some(p => meterKind(p) === activeKind)) : allGroups),
    [allGroups, kindOptions, activeKind],
  )

  const group: BillerGroup | undefined = groups.find(g => g.key === groupKey)
  const brand = group ? resolveBrand(group.name) : NEUTRAL

  const candidates: Biller[] = useMemo(() => {
    if (!group) return []
    const list = kindOptions.length ? group.products.filter(p => meterKind(p) === activeKind) : [...group.products]
    return list.sort((a, b) => (a.price_kobo ?? 0) - (b.price_kobo ?? 0) || a.product_name.localeCompare(b.product_name))
  }, [group, kindOptions, activeKind])

  // One product -> it is the product (electricity). Several (TV bouquets) -> the customer picks.
  const selectedBiller: Biller | undefined = candidates.length === 1 && !isCable ? candidates[0] : candidates.find(p => p.id === productId)

  const validateMutation = useValidateBill()
  const payMutation = usePayBill(customerId)
  const resetValidation = () => validateMutation.reset()

  function switchCategory(next: SubCategory) {
    setSubCategory(next); setGroupKey(null); setProductId(null); setCustomerReference(''); setAmountNaira(''); resetValidation()
  }
  function chooseKind(k: MeterKind) {
    setMeterMode(k); setProductId(null); resetValidation()
    const stillValid = allGroups.find(g => g.key === groupKey)?.products.some(p => meterKind(p) === k)
    if (!stillValid) setGroupKey(null)
  }
  function chooseGroup(g: BillerGroup) { setGroupKey(g.key); setProductId(null); setCustomerReference(''); resetValidation() }

  function handleValidate() {
    if (!selectedBiller || customerReference.length < 5) return
    validateMutation.mutate(
      { biller_id: selectedBiller.id, customer_reference: customerReference },
      { onError: (e) => toast.error(getErrorMessage(e)) },
    )
  }

  const validated = validateMutation.data
  const isVerified = validateMutation.isSuccess
  const minNaira = Math.max(1, Math.ceil((selectedBiller?.min_amount_kobo ?? 50_000) / 100))
  const maxNaira = selectedBiller?.max_amount_kobo ? Math.floor(selectedBiller.max_amount_kobo / 100) : null
  const amountOk = typeof amountNaira === 'number' && amountNaira >= minNaira && (maxNaira == null || amountNaira <= maxNaira)
  const canPay = cfg.bills_enabled && !!selectedBiller && customerReference.length >= 5 && isVerified && (isCable || amountOk)

  // What the customer's wallet pays: TV plans carry our price; electricity is the typed amount plus any markup.
  const markup = selectedBiller?.markup_percent ?? 0
  const typedKobo = typeof amountNaira === 'number' ? amountNaira * 100 : 0
  const payAmountKobo = isCable ? (selectedBiller?.price_kobo ?? 0) : Math.round(typedKobo * (1 + markup / 100))
  const refLabel = isCable ? 'Smartcard / IUC number' : 'Meter number'

  function handleConfirmPay() {
    if (!selectedBiller) return
    payMutation.mutate(
      {
        biller_id: selectedBiller.id,
        customer_reference: customerReference,
        amount_kobo: isCable ? undefined : (amountNaira as number) * 100,   // a TV plan's price is resolved server-side
        validation_reference: validated?.validation_reference,
      },
      {
        onSuccess: (req) => { setShowConfirm(false); setCompletedRequest(req) },
        onError: (e) => { if (!isPinCancelled(e)) toast.error(getErrorMessage(e)) },
      },
    )
  }

  // The receipt follows the payment: if the provider was slow it shows "Processing", then flips to the
  // result (with the electricity token) by itself instead of staying stuck on the first answer.
  const { data: liveRequest } = useBillRequest(completedRequest?.id, completedRequest)
  const receiptRequest = liveRequest ?? completedRequest

  const typeLabel = isCable ? selectedBiller?.product_name : (selectedBiller ? METER_LABEL[meterKind(selectedBiller)] : '')
  const receiptFields: ReceiptField[] = receiptRequest ? [
    { label: isCable ? 'Provider' : 'Distribution company', value: group?.name ?? '' },
    ...(typeLabel ? [{ label: isCable ? 'Plan' : 'Meter type', value: typeLabel }] : []),
    { label: refLabel, value: customerReference },
    ...(validated?.validated_account_name ? [{ label: 'Account name', value: validated.validated_account_name }] : []),
    ...(receiptRequest.token ? [{ label: isCable ? 'Reference code' : 'Electricity token', value: receiptRequest.token, kind: 'token' as const }] : []),
  ] : []

  const stepNo = (n: number) => (isCable ? n : n + 1)

  return (
    <div className="relative min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <motion.div key={brand.key} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] dark:opacity-80"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} style={{ background: brandWash(brand) }} />

      <header className="relative flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 bg-white/70 dark:bg-night-600 backdrop-blur rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg flex-1">Bill Payment</h1>
        <AnimatePresence mode="wait">
          {group && (
            <motion.div key={brand.key} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
              <BillerLogo brand={brand} size={36} glow />
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <div className="relative flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(var(--bottom-nav-height, 4.5rem) + 6rem)' }}>
        {customerId && (
          <div className="bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 mt-2 mb-4">
            <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">Paying on this customer's behalf — charged to their wallet, not yours.</p>
          </div>
        )}
        {cfg.notice && <p className="mt-2 mb-3 rounded-2xl bg-white/80 dark:bg-night-700/80 border border-amber-300/60 px-4 py-3 text-xs font-semibold text-amber-800 dark:text-amber-200">{cfg.notice}</p>}
        {!cfg.bills_enabled && <p className="mt-2 mb-3 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-200">Bill payments are paused right now. Please check back soon.</p>}

        {/* Electricity / Cable TV */}
        <div className="relative flex bg-white/80 dark:bg-night-700 backdrop-blur rounded-2xl p-1 mt-2 mb-5 border border-green-100 dark:border-night-500">
          {([{ key: 'electricity' as const, label: 'Electricity', icon: Zap }, { key: 'cable_tv' as const, label: 'Cable TV', icon: Tv }]).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => switchCategory(key)}
              className={cn('relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-colors', subCategory === key ? '' : 'text-green-700 dark:text-night-300')}
              style={subCategory === key ? { color: brand.on } : undefined}>
              {subCategory === key && <motion.span layoutId="bill-tab" className="absolute inset-0 rounded-xl" style={{ background: brandGradient(brand) }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
              <span className="relative flex items-center gap-1.5"><Icon className="w-4 h-4" /> {label}</span>
            </button>
          ))}
        </div>

        {isError ? (
          <FallbackError title="Couldn't load providers" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading ? (
          <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-16 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}</div>
        ) : billers.length === 0 ? (
          <p className="text-green-600 dark:text-night-300 text-sm">No providers are available right now.</p>
        ) : (
          <div className="space-y-5">
            {/* Step 1 (electricity) — prepaid or postpaid, BEFORE choosing the provider */}
            {!isCable && kindOptions.length > 0 && (
              <div>
                <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">1 · Meter type</label>
                <div className="grid grid-cols-2 gap-2.5">
                  {kindOptions.map(k => {
                    const on = activeKind === k
                    return (
                      <motion.button key={k} type="button" whileTap={{ scale: 0.97 }} onClick={() => chooseKind(k)} aria-pressed={on}
                        className={cn('relative rounded-2xl border px-4 py-3.5 text-left overflow-hidden', on ? 'border-transparent' : 'bg-white dark:bg-night-700 border-green-100 dark:border-night-500')}
                        style={on ? { background: brandGradient(brand), color: brand.on, boxShadow: `0 8px 22px ${rgba(brand.main, 0.35)}` } : undefined}>
                        <span className={cn('block text-sm font-extrabold', on ? '' : 'text-green-950 dark:text-white')}>{KIND_COPY[k].title}</span>
                        <span className={cn('block text-[11px] mt-0.5', on ? 'opacity-85' : 'text-green-600 dark:text-night-300')}>{KIND_COPY[k].hint}</span>
                        {on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white flex items-center justify-center"><CheckCircle2 className="w-4 h-4" style={{ color: brand.deep }} /></motion.span>}
                      </motion.button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Provider — one field, list opens in a sheet */}
            <div>
              <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">{stepNo(1)} · {isCable ? 'TV provider' : 'Electricity provider'}</label>
              <ProviderSheet
                title={isCable ? 'Select TV provider' : 'Select provider'} placeholder={isCable ? 'Choose DStv, GOtv…' : 'Choose your electricity company'}
                groups={groups} selectedKey={groupKey} onSelect={chooseGroup} fallbackIcon={isCable ? <Tv className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
                emptyText={`No ${activeKind ?? ''} providers are available right now.`}
              />
            </div>

            <AnimatePresence mode="wait">
              {group && (
                <motion.div key={`${group.key}-${activeKind}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="space-y-5">
                  {(isCable || candidates.length > 1) && (
                    <div>
                      <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">{stepNo(2)} · {isCable ? 'Choose a plan' : 'Choose a product'}</label>
                      <PlanSheet title={isCable ? `${brand.label} plan` : 'Product'} placeholder="Tap to choose" brand={brand} plans={candidates} selectedId={productId} onSelect={p => { setProductId(p.id); resetValidation() }} />
                    </div>
                  )}

                  {selectedBiller && (
                    <div>
                      <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">{stepNo(isCable ? 3 : candidates.length > 1 ? 3 : 2)} · {refLabel}</label>
                      <div className="flex gap-2">
                        <input type="text" inputMode="numeric" value={customerReference}
                          onChange={(e) => { setCustomerReference(e.target.value.replace(/\D/g, '')); resetValidation() }} placeholder="Enter number"
                          className="flex-1 min-w-0 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3.5 outline-none text-green-950 dark:text-white font-semibold tracking-wide" />
                        <motion.button whileTap={{ scale: 0.96 }} onClick={handleValidate} disabled={customerReference.length < 5 || validateMutation.isPending}
                          className="px-5 rounded-2xl font-bold text-sm disabled:opacity-50 flex items-center gap-1.5 shrink-0" style={{ background: brand.main, color: brand.on }}>
                          {validateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                          {validateMutation.isPending ? 'Checking' : 'Verify'}
                        </motion.button>
                      </div>
                      <AnimatePresence>
                        {isVerified && (
                          <motion.div initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
                            className="mt-3 flex items-center gap-3 rounded-2xl px-4 py-3.5 border" style={{ background: rgba(brand.main, 0.1), borderColor: rgba(brand.main, 0.4) }}>
                            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 16 }}>
                              <CheckCircle2 className="w-6 h-6 shrink-0" style={{ color: brand.main }} />
                            </motion.span>
                            <div className="min-w-0">
                              <p className="text-green-600 dark:text-night-300 text-[11px] font-semibold uppercase">Confirm this is correct</p>
                              <p className="text-green-950 dark:text-white font-bold break-words">{validated?.validated_account_name ?? 'Details verified'}</p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {!isCable && selectedBiller && isVerified && (
                    <div>
                      <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">{stepNo(isCable ? 4 : candidates.length > 1 ? 4 : 3)} · Amount</label>
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        {QUICK_AMOUNTS.filter(a => a >= minNaira && (maxNaira == null || a <= maxNaira)).map(a => (
                          <motion.button key={a} whileTap={{ scale: 0.95 }} onClick={() => setAmountNaira(a)}
                            className={cn('py-2.5 rounded-xl text-xs font-bold border', amountNaira === a ? 'border-transparent' : 'bg-white dark:bg-night-700 text-green-800 dark:text-night-100 border-green-100 dark:border-night-500')}
                            style={amountNaira === a ? { background: brand.main, color: brand.on } : undefined}>
                            ₦{a.toLocaleString()}
                          </motion.button>
                        ))}
                      </div>
                      <input type="number" inputMode="numeric" value={amountNaira} onChange={(e) => setAmountNaira(e.target.value ? Number(e.target.value) : '')}
                        placeholder={`Or enter an amount (₦${minNaira.toLocaleString()}${maxNaira ? ` – ₦${maxNaira.toLocaleString()}` : ' minimum'})`}
                        className="w-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3.5 outline-none text-green-950 dark:text-white font-semibold" />
                      {typeof amountNaira === 'number' && !amountOk && (
                        <p className="mt-1.5 text-[11px] font-semibold text-red-600 dark:text-red-300">
                          {amountNaira < minNaira ? `The minimum is ₦${minNaira.toLocaleString()}.` : `The maximum is ₦${maxNaira?.toLocaleString()}.`}
                        </p>
                      )}
                      {markup !== 0 && amountOk && <p className="mt-1.5 text-[11px] text-green-600 dark:text-night-300">You pay {formatNaira(payAmountKobo)} for ₦{amountNaira.toLocaleString()} of units.</p>}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="fixed left-0 right-0 z-30 bg-white/95 dark:bg-night-900/95 backdrop-blur border-t border-green-50 dark:border-night-700 px-4 py-3" style={{ bottom: 'var(--bottom-nav-height, 4.5rem)' }}>
        <motion.button whileTap={{ scale: 0.98 }} onClick={() => canPay && setShowConfirm(true)} disabled={!canPay || payMutation.isPending}
          className="w-full font-bold py-3.5 rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors" style={{ background: brand.main, color: brand.on }}>
          {payMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {payMutation.isPending ? 'Processing…' : `Pay${payAmountKobo > 0 ? ` ${formatNaira(payAmountKobo)}` : ' bill'}`}
        </motion.button>
      </div>

      <PaymentConfirmSheet
        open={showConfirm} onClose={() => setShowConfirm(false)} onConfirm={handleConfirmPay} isSubmitting={payMutation.isPending}
        title={isCable ? 'Confirm cable TV payment' : 'Confirm electricity payment'}
        icon={group ? <BillerLogo brand={brand} size={30} /> : (isCable ? <Tv className="w-6 h-6 text-copper-500" /> : <Zap className="w-6 h-6 text-copper-500" />)}
        amountKobo={payAmountKobo} walletBalanceKobo={wallet?.balance_kobo ?? 0}
        detailRows={[
          { label: isCable ? 'Provider' : 'Distribution company', value: group?.name ?? '' },
          ...(typeLabel ? [{ label: isCable ? 'Plan' : 'Meter type', value: typeLabel }] : []),
          { label: refLabel, value: customerReference },
          ...(validated?.validated_account_name ? [{ label: 'Account name', value: validated.validated_account_name }] : []),
        ]}
      />

      {completedRequest && receiptRequest && (
        <PaymentReceipt
          open={!!completedRequest} onClose={() => { setCompletedRequest(null); navigate(-1) }}
          status={receiptRequest.status === 'completed' ? 'completed' : receiptRequest.status === 'failed' ? 'failed' : 'pending'}
          amountKobo={receiptRequest.amount_charged_kobo ?? receiptRequest.amount_kobo}
          serviceName={`${group?.name ?? 'Bill payment'}${!isCable && selectedBiller ? ` — ${METER_LABEL[meterKind(selectedBiller)]}` : ''}`}
          reference={receiptRequest.monnify_transaction_reference ?? receiptRequest.id}
          timestamp={new Date(receiptRequest.created_at).toLocaleString()}
          fields={receiptFields} failureReason={receiptRequest.failure_reason ?? undefined} brand={group ? brand : null}
        />
      )}
    </div>
  )
}
