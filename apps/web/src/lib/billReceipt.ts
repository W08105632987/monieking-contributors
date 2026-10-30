import type { BillPaymentRequest } from '@/types'
import type { ReceiptField, ReceiptStatus } from '@/components/receipts/PaymentReceipt'
import { resolveBrand, networkBrand, type BillerBrand } from '@/lib/billerBrand'
import { NETWORK_THEME } from '@/lib/networkTheme'
import { meterKind, METER_LABEL, providerName } from '@/lib/billCatalog'
import type { NetworkName } from '@/components/NetworkBadge'

const NETWORKS: { name: NetworkName; words: string[] }[] = [
  { name: 'MTN', words: ['MTN'] },
  { name: 'Airtel', words: ['AIRTEL'] },
  { name: 'Glo', words: ['GLO'] },
  { name: '9mobile', words: ['9MOBILE', 'ETISALAT'] },
]

function networkOf(name: string): NetworkName | null {
  const up = name.toUpperCase()
  return NETWORKS.find(n => n.words.some(w => up.includes(w)))?.name ?? null
}

export interface BillReceiptView {
  status: ReceiptStatus
  amountKobo: number
  serviceName: string
  reference: string
  timestamp: string
  fields: ReceiptField[]
  failureReason?: string
  brand: BillerBrand | null
}

/**
 * Turns a stored bill payment into the exact receipt shown right after paying.
 * Used by History, so opening a past payment shows the same animated receipt
 * (including the electricity token) as the moment it was bought.
 */
export function buildBillReceipt(req: BillPaymentRequest): BillReceiptView {
  const status: ReceiptStatus = req.status === 'completed' ? 'completed' : req.status === 'failed' || req.status === 'reversed' ? 'failed' : 'pending'
  const common = {
    status,
    amountKobo: req.amount_charged_kobo ?? req.amount_kobo,
    reference: req.monnify_transaction_reference ?? req.id,
    timestamp: new Date(req.created_at).toLocaleString(),
    failureReason: req.failure_reason ?? (req.status === 'reversed' ? 'This payment was reversed' : undefined),
  }
  const product = req.biller_product_name ?? ''

  if (req.biller_category === 'airtime' || req.biller_category === 'data') {
    const network = networkOf(req.biller_name)
    const isData = req.biller_category === 'data'
    const theme = network ? NETWORK_THEME[network] : null
    return {
      ...common,
      serviceName: `${network ?? ''} ${isData ? 'Data' : 'Airtime'}`.trim(),
      fields: [
        ...(network ? [{ label: 'Network', value: network }] : []),
        { label: 'Phone number', value: req.customer_reference },
        ...(isData && product ? [{ label: 'Plan', value: product }] : []),
      ],
      brand: network && theme ? networkBrand(network, theme.main, theme.on) : resolveBrand(req.biller_name),
    }
  }

  const isCable = req.biller_category === 'cable_tv'
  const provider = providerName(req.biller_name)
  const kind = meterKind({ product_id: '', product_name: `${req.biller_name} ${product}` })
  const typeLabel = isCable ? product : (kind !== 'other' ? METER_LABEL[kind] : '')
  return {
    ...common,
    serviceName: `${provider}${!isCable && kind !== 'other' ? ` — ${METER_LABEL[kind]}` : ''}`,
    fields: [
      { label: isCable ? 'Provider' : 'Distribution company', value: provider },
      ...(typeLabel ? [{ label: isCable ? 'Plan' : 'Meter type', value: typeLabel }] : []),
      { label: isCable ? 'Smartcard / IUC number' : 'Meter number', value: req.customer_reference },
      ...(req.validated_account_name ? [{ label: 'Account name', value: req.validated_account_name }] : []),
      ...(req.token ? [{ label: isCable ? 'Reference code' : 'Electricity token', value: req.token, kind: 'token' as const }] : []),
    ],
    brand: resolveBrand(provider),
  }
}
