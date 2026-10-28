import type { WalletTransaction } from '@/types'

const CATEGORY_LABEL: Record<string, string> = {
  wallet_funding:       'Wallet funded',
  contribution:         'Contribution',
  withdrawal:           'Withdrawal',
  charge:               'Service charge',
  officer_contribution: 'Cash contribution',
  reversal:             'Reversal',
  sms_fee:              'SMS alerts',
  manual_debit:         'Wallet debit',
}

// Money-in/out kinds whose description is long bookkeeping text — keep the list simple.
const SIMPLE = new Set(['wallet_funding', 'contribution', 'officer_contribution', 'withdrawal', 'reversal'])

/**
 * One label for every transaction list (Recent and full History, customer and officer).
 * Contributions etc. stay short ("Contribution"); service charges show what was bought
 * ("NIN verification", "Airtime — MTN") instead of a generic "Withdrawal charge".
 */
export function txLabel(tx: Pick<WalletTransaction, 'category' | 'description'>): string {
  if (SIMPLE.has(tx.category)) return CATEGORY_LABEL[tx.category]
  return (tx.description || '').trim() || CATEGORY_LABEL[tx.category] || tx.category
}
