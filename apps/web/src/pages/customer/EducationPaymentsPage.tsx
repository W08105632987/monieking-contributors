import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from '@/lib/notify'
import { ArrowLeft, GraduationCap, Loader2, Minus, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { formatNaira } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { useBillers, usePayBill } from '@/hooks/useBillPayments'
import { FallbackError } from '@/components/ui/FallbackError'
import { PaymentReceipt, type ReceiptField } from '@/components/receipts/PaymentReceipt'
import { BillerPicker } from '@/components/billers/BillerPicker'
import { BillerLogo } from '@/components/billers/BillerLogo'
import { PlanSheet } from '@/components/billers/PlanSheet'
import { groupByBiller, type BillerGroup } from '@/lib/billCatalog'
import { resolveBrand, brandWash, brandGradient, rgba, type BillerBrand } from '@/lib/billerBrand'
import type { BillPaymentRequest } from '@/types'

const NEUTRAL: BillerBrand = { key: 'neutral', label: 'Education', logo: null, main: '#14532d', deep: '#052e16', on: '#ffffff', initials: 'ED' }

export default function EducationPaymentsPage() {
  const navigate = useNavigate()
  const { customerId } = useParams<{ customerId?: string }>()
  const { wallet } = useWallet()

  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [productId, setProductId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [completedRequest, setCompletedRequest] = useState<BillPaymentRequest | null>(null)

  const { data: rows = [], isLoading, isError, refetch, isFetching } = useBillers('education')
  const groups = useMemo(() => groupByBiller(rows), [rows])
  const group: BillerGroup | undefined = groups.find(g => g.key === groupKey)
  const brand = group ? resolveBrand(group.name) : NEUTRAL
  const products = useMemo(
    () => (group ? [...group.products].sort((a, b) => (a.price_kobo ?? 0) - (b.price_kobo ?? 0) || a.product_name.localeCompare(b.product_name)) : []),
    [group],
  )
  // A provider with a single product needs no second choice.
  const selected = products.length === 1 ? products[0] : products.find(p => p.id === productId)

  const payMutation = usePayBill(customerId)

  // Education PINs don't validate against an account the way a meter does — nothing to confirm before paying.
  const canPay = !!selected && quantity >= 1
  const totalKobo = (selected?.price_kobo ?? 0) * quantity

  function chooseGroup(g: BillerGroup) { setGroupKey(g.key); setProductId(null); setQuantity(1) }

  function handlePay() {
    if (!canPay || !selected) return
    payMutation.mutate(
      {
        biller_id: selected.id,
        customer_reference: customerId ?? 'self',   // no account to validate against — this just tags the purchase
        amount_kobo: undefined,                     // price resolved server-side from the product's own price_kobo × quantity
        quantity,
      },
      {
        onSuccess: (req) => setCompletedRequest(req),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )
  }

  const pins = (completedRequest?.token ?? '').split(',').map(p => p.trim()).filter(Boolean)
  const receiptFields: ReceiptField[] = completedRequest ? [
    { label: 'Exam body', value: group?.name ?? '' },
    { label: 'Product', value: selected?.product_name ?? '' },
    { label: 'Quantity', value: String(quantity) },
    ...pins.map((pin, i) => ({ label: pins.length > 1 ? `PIN ${i + 1}` : 'PIN', value: pin, kind: 'token' as const })),
  ] : []

  return (
    <div className="relative min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <motion.div
        key={brand.key} aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] dark:opacity-80"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
        style={{ background: brandWash(brand) }}
      />
      <header className="relative flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 bg-white/70 dark:bg-night-600 backdrop-blur rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg flex-1">Education Payments</h1>
        {group && <BillerLogo brand={brand} size={36} glow />}
      </header>

      <div className="relative flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(var(--bottom-nav-height, 4.5rem) + 7rem)' }}>
        {customerId && (
          <div className="bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 mt-2 mb-4">
            <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">Buying on this customer's behalf — charged to their wallet, not yours.</p>
          </div>
        )}

        <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 mt-2 block">1 · Exam body / school</label>
        {isError ? (
          <FallbackError title="Couldn't load products" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading ? (
          <div className="grid grid-cols-3 gap-2.5 mb-5">{[1, 2, 3].map(i => <div key={i} className="h-28 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}</div>
        ) : groups.length === 0 ? (
          <p className="text-green-500 dark:text-night-300 text-sm">No education products available right now.</p>
        ) : (
          <div className="mb-5"><BillerPicker groups={groups} selectedKey={groupKey} onSelect={chooseGroup} /></div>
        )}

        <AnimatePresence mode="wait">
          {group && (
            <motion.div key={group.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {products.length > 1 && (
                <div className="mb-5">
                  <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">2 · Choose a package</label>
                  <PlanSheet title={`${brand.label} package`} placeholder="Tap to choose" brand={brand} plans={products} selectedId={productId} onSelect={p => setProductId(p.id)} />
                </div>
              )}

              {selected && (
                <div>
                  <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">{products.length > 1 ? '3' : '2'} · Quantity</label>
                  <div className="flex items-center gap-4 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3">
                    <motion.button whileTap={{ scale: 0.9 }} onClick={() => setQuantity(q => Math.max(1, q - 1))} aria-label="Fewer"
                      className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center">
                      <Minus className="w-4 h-4 text-green-800 dark:text-night-100" />
                    </motion.button>
                    <motion.span key={quantity} initial={{ scale: 1.3, opacity: 0.5 }} animate={{ scale: 1, opacity: 1 }} className="flex-1 text-center font-bold text-green-950 dark:text-white text-lg">{quantity}</motion.span>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={() => setQuantity(q => Math.min(50, q + 1))} aria-label="More"
                      className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center">
                      <Plus className="w-4 h-4 text-green-800 dark:text-night-100" />
                    </motion.button>
                  </div>
                  <p className="text-green-600 dark:text-night-300 text-xs mt-2">Up to 50 PINs in one purchase — useful for schools buying in bulk.</p>

                  <div className="mt-4 flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left" style={{ background: brandGradient(brand), color: brand.on, boxShadow: `0 10px 26px ${rgba(brand.main, 0.4)}` }}>
                    <GraduationCap className="w-6 h-6 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{selected.product_name}</p>
                      <p className="text-[11px] opacity-80">{group.name} · {quantity} PIN{quantity > 1 ? 's' : ''}</p>
                    </div>
                    {selected.price_kobo != null && <p className="text-base font-extrabold shrink-0">{formatNaira(totalKobo)}</p>}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="fixed left-0 right-0 z-30 bg-white/95 dark:bg-night-900/95 backdrop-blur border-t border-green-50 dark:border-night-700 px-4 py-3" style={{ bottom: 'var(--bottom-nav-height, 4.5rem)' }}>
        <div className="flex items-center justify-between mb-2 text-xs text-green-500 dark:text-night-300">
          <span>Wallet balance</span>
          <span className="font-semibold text-green-700 dark:text-night-100">{formatNaira(wallet?.balance_kobo ?? 0)}</span>
        </div>
        <motion.button
          whileTap={{ scale: 0.98 }} onClick={handlePay} disabled={!canPay || payMutation.isPending}
          className="w-full font-bold py-3.5 rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: brand.main, color: brand.on }}
        >
          {payMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {payMutation.isPending ? 'Processing…' : `Buy ${quantity > 1 ? `${quantity} PINs` : 'PIN'}${totalKobo > 0 ? ` · ${formatNaira(totalKobo)}` : ''}`}
        </motion.button>
      </div>

      {completedRequest && (
        <PaymentReceipt
          open={!!completedRequest}
          onClose={() => { setCompletedRequest(null); navigate(-1) }}
          status={completedRequest.status === 'completed' ? 'completed' : completedRequest.status === 'failed' ? 'failed' : 'pending'}
          amountKobo={completedRequest.amount_charged_kobo ?? completedRequest.amount_kobo}
          serviceName={group?.name ?? 'Education payment'}
          reference={completedRequest.monnify_transaction_reference ?? completedRequest.id}
          timestamp={new Date(completedRequest.created_at).toLocaleString()}
          fields={receiptFields}
          failureReason={completedRequest.failure_reason ?? undefined}
          brand={group ? brand : null}
        />
      )}
    </div>
  )
}
