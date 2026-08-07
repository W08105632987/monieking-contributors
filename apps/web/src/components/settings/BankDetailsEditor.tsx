import { useState, useEffect, useRef } from 'react'
import { Landmark, ShieldCheck, Eye, EyeOff, ChevronRight, Fingerprint } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { isBiometricAvailable, getStepUpAssertion } from '@/lib/webauthn'
import { BankPickerModal, type Bank } from './BankPickerModal'

interface BankDetailsEditorProps {
  currentBankName: string | null
  currentAccountNumber: string | null
  currentAccountName: string | null
  onUpdated: (details: { bank_name: string; account_number: string; account_name: string }) => void
}

export function BankDetailsEditor({ currentBankName, currentAccountNumber, currentAccountName, onUpdated }: BankDetailsEditorProps) {
  const [open, setOpen] = useState(false)
  const [showBankPicker, setShowBankPicker] = useState(false)
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null)
  const [accountNumber, setAccountNumber] = useState('')
  const [resolvedName, setResolvedName] = useState('')
  const [resolving, setResolving] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioLoading, setBioLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const autoPromptedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    isBiometricAvailable().then(setBioAvailable)
  }, [open])

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
    await submit({ withdrawal_password: password, auth_method: 'password' })
  }

  const submitWithBiometric = async (silent = false) => {
    if (!resolvedName || !selectedBank) return
    setBioLoading(true)
    try {
      const assertion = await getStepUpAssertion()
      await submit({ webauthn_assertion: assertion, auth_method: 'biometric' })
    } catch (err) {
      // Silent = auto-triggered the moment the password field was
      // focused. A dismissed/failed prompt there just means "let them
      // type their password instead" — no error toast. Only the
      // explicit fingerprint-icon tap shows one.
      if (!silent) toast.error(getErrorMessage(err))
    } finally {
      setBioLoading(false)
    }
  }

  const handlePasswordFocus = () => {
    if (autoPromptedRef.current) return
    if (!bioAvailable) return
    autoPromptedRef.current = true
    submitWithBiometric(true)
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
      setOpen(false); setPassword(''); setSelectedBank(null); setAccountNumber(''); setResolvedName('')
      autoPromptedRef.current = false
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-green-100 shadow-card p-4">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Landmark className="w-4 h-4 text-green-600" />
          <p className="text-green-900 font-bold text-sm">Bank details</p>
        </div>
        <span className="text-green-400 text-xs">{open ? 'Close' : 'Edit'}</span>
      </button>

      {!open && (
        <div className="mt-2">
          <p className="text-green-900 text-sm font-semibold">{currentAccountName ?? 'Not set'}</p>
          <p className="text-green-400 text-xs">{currentBankName} · {currentAccountNumber}</p>
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <button
            onClick={() => setShowBankPicker(true)}
            className="w-full flex items-center justify-between border border-green-200 rounded-xl px-4 py-3 text-sm bg-white"
          >
            {selectedBank ? (
              <span className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-full bg-green-900 flex items-center justify-center font-bold text-amber-400 text-[10px] flex-shrink-0">
                  {selectedBank.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="text-green-900 font-semibold">{selectedBank.name}</span>
              </span>
            ) : (
              <span className="text-green-400">Choose bank…</span>
            )}
            <ChevronRight className="w-4 h-4 text-green-300 flex-shrink-0" />
          </button>

          <input
            value={accountNumber}
            onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
            inputMode="numeric"
            placeholder="10-digit account number"
            className="w-full border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-900"
          />

          {resolving && <p className="text-green-400 text-xs">Verifying account…</p>}
          {resolvedName && (
            <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2.5">
              <ShieldCheck className="w-4 h-4 text-green-600 flex-shrink-0" />
              <p className="text-green-900 text-sm font-semibold">{resolvedName}</p>
            </div>
          )}

          {resolvedName && (
            <>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={handlePasswordFocus}
                  placeholder="Withdrawal password"
                  className="w-full border border-green-200 rounded-xl pl-4 pr-16 py-2.5 text-sm text-green-900"
                />
                {bioAvailable && (
                  <button
                    type="button"
                    onClick={() => submitWithBiometric(false)}
                    disabled={bioLoading}
                    aria-label="Confirm with fingerprint"
                    className="absolute right-9 top-1/2 -translate-y-1/2 text-green-600 disabled:opacity-40"
                  >
                    <Fingerprint className={`w-4 h-4 ${bioLoading ? 'animate-pulse' : ''}`} />
                  </button>
                )}
                <button onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                onClick={submitWithPassword}
                disabled={saving || bioLoading}
                className="w-full bg-green-900 text-white font-bold text-sm rounded-full py-3 disabled:opacity-40"
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
    </div>
  )
}
