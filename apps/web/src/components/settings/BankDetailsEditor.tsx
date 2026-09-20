import { useState, useEffect } from 'react'
import { Landmark, ShieldCheck, Eye, EyeOff, ChevronRight, X } from 'lucide-react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { BankPickerModal, type Bank } from './BankPickerModal'

interface BankDetailsEditorProps {
  currentBankName: string | null
  currentAccountNumber: string | null
  currentAccountName: string | null
  onUpdated: (details: { bank_name: string; account_number: string; account_name: string }) => void
}

/**
 * The full account-name · bank-name · account-number string used to
 * sit directly in the row and would overflow/wrap awkwardly on
 * narrower phones — looked fine on some devices, visibly broken on
 * others. Same fix pattern as Identity Verification: the row is now
 * just a trigger (bank name only, plus a hint that it's tappable) and
 * everything else — the full details and the edit form — lives in a
 * bottom sheet, same shape as KycSection/KycSheet.
 */
export function BankDetailsEditor({ currentBankName, currentAccountNumber, currentAccountName, onUpdated, isLast = false }: BankDetailsEditorProps & { isLast?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`w-full flex items-center gap-3 py-3.5 active:bg-green-50/50 dark:active:bg-white/5 transition-all text-left ${isLast ? '' : 'border-b border-green-50 dark:border-night-600'}`}
      >
        <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
          <Landmark className="w-4 h-4 text-green-500 dark:text-night-200" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-green-900 dark:text-white text-sm font-semibold">Bank details</p>
          <p className="text-green-400 dark:text-night-300 text-xs mt-0.5 truncate">
            {currentBankName ?? 'Not set'} · <span className="italic">tap to view or edit</span>
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-green-300 dark:text-night-300 flex-shrink-0" />
      </button>

      {open && (
        <BankDetailsSheet
          currentBankName={currentBankName}
          currentAccountNumber={currentAccountNumber}
          currentAccountName={currentAccountName}
          onUpdated={onUpdated}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function BankDetailsSheet({ currentBankName, currentAccountNumber, currentAccountName, onUpdated, onClose }: BankDetailsEditorProps & { onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const [showBankPicker, setShowBankPicker] = useState(false)
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null)
  const [accountNumber, setAccountNumber] = useState('')
  const [resolvedName, setResolvedName] = useState('')
  const [resolving, setResolving] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setResolvedName('')
    if (selectedBank && accountNumber.length === 10) {
      setResolving(true)
      api.get<{ account_name: string }>('/users/resolve-bank-account', { params: { bank_code: selectedBank.code, account_number: accountNumber } })
        .then(({ data }) => setResolvedName(data.account_name))
        .catch(() => toast.error("Couldn't verify this account — check the number and bank"))
        .finally(() => setResolving(false))
    }
  }, [selectedBank, accountNumber])

  const submitWithPassword = async () => {
    if (!resolvedName || !selectedBank) return toast.error('Verify the account first')
    if (!password) return toast.error('Enter your withdrawal password')
    await submit({ withdrawal_password: password })
  }

  const submit = async (authPayload: Record<string, any>) => {
    if (!selectedBank) return
    setSaving(true)
    try {
      await api.patch('/users/me/bank-details', {
        bank_name: selectedBank.name, bank_code: selectedBank.code, account_number: accountNumber,
        ...authPayload,
      })
      toast.success('Bank details updated')
      onUpdated({ bank_name: selectedBank.name, account_number: accountNumber, account_name: resolvedName })
      onClose()
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        <button onClick={onClose} className="absolute top-5 right-5 w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
          <X className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>

        <h2 className="text-green-900 dark:text-white font-extrabold text-xl mb-5 pr-10">Bank details</h2>

        {!editing ? (
          <>
            <div className="bg-green-50 dark:bg-night-600 rounded-2xl p-4 mb-5">
              <p className="text-green-900 dark:text-white text-base font-semibold">{currentAccountName ?? 'Not set'}</p>
              <p className="text-green-500 dark:text-night-300 text-sm mt-0.5">{currentBankName ?? '—'}</p>
              <p className="text-green-400 dark:text-night-300 text-sm">{currentAccountNumber ?? '—'}</p>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-sm rounded-full py-3.5"
            >
              Change bank details
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => setShowBankPicker(true)}
              className="w-full flex items-center justify-between border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm bg-white dark:bg-night-800"
            >
              {selectedBank ? (
                <span className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-green-900 dark:bg-copper-400 flex items-center justify-center font-bold text-amber-400 dark:text-green-950 text-[10px] flex-shrink-0">
                    {selectedBank.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-green-900 dark:text-white font-semibold">{selectedBank.name}</span>
                </span>
              ) : (
                <span className="text-green-400 dark:text-night-300">Choose bank…</span>
              )}
              <ChevronRight className="w-4 h-4 text-green-300 dark:text-night-300 flex-shrink-0" />
            </button>

            <input
              value={accountNumber}
              onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
              placeholder="10-digit account number"
              className="w-full border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 rounded-xl px-4 py-2.5 text-sm text-green-900 dark:text-white"
            />

            {resolving && <p className="text-green-400 dark:text-night-300 text-xs">Verifying account…</p>}
            {resolvedName && (
              <div className="flex items-center gap-2 bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2.5">
                <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-300 flex-shrink-0" />
                <p className="text-green-900 dark:text-white text-sm font-semibold">{resolvedName}</p>
              </div>
            )}

            {resolvedName && (
              <>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Withdrawal password"
                    className="w-full border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 rounded-xl pl-4 pr-10 py-2.5 text-sm text-green-900 dark:text-white"
                  />
                  <button onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  onClick={submitWithPassword}
                  disabled={saving}
                  className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-sm rounded-full py-3 disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Confirm & save'}
                </button>
              </>
            )}
          </div>
        )}

        <BankPickerModal
          open={showBankPicker}
          onClose={() => setShowBankPicker(false)}
          onSelect={bank => { setSelectedBank(bank); setAccountNumber(''); setResolvedName('') }}
          selectedCode={selectedBank?.code}
        />
      </motion.div>
    </div>
  )
}
